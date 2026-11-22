import { test, expect } from '@playwright/test'

const api = process.env.VITE_API_BASE_URL ?? 'http://localhost:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'

test.describe('Stage 6 EPICA shop brand', () => {
  test('phone-390: EPICA products filter and product card', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'mobile primary')
    const login = await fetch(`${api}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'client1@demo.local', password }),
    })
    expect(login.ok).toBeTruthy()
    const body = await login.json() as { access_token: string }
    const shop = await fetch(`${api}/v1/commerce/shop/products?brand=${encodeURIComponent('EPICA Professional')}&limit=50`, {
      headers: { Authorization: `Bearer ${body.access_token}` },
    })
    expect(shop.ok).toBeTruthy()
    const catalog = await shop.json() as { items?: Array<{ id: string; brand: string; name: string; price_minor: number }> }
    expect((catalog.items ?? []).length).toBeGreaterThan(0)
    for (const it of catalog.items ?? []) {
      expect(it.brand).toBe('EPICA Professional')
      expect(it.price_minor).toBeGreaterThan(0)
    }

    await page.goto('/login')
    await page.getByLabel('Email').fill('client1@demo.local')
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })

    await page.goto('/shop')
    await expect(page.getByRole('heading', { name: /магазин|косметик/i }).or(page.locator('h1')).first()).toBeVisible({ timeout: 15_000 })
    const first = catalog.items![0]
    await page.goto(`/shop/${first.id}`)
    await expect(page.getByText(/EPICA Professional/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(first.name.slice(0, 24), { exact: false }).first()).toBeVisible()
  })
})
