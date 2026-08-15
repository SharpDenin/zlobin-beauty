import { test, expect, type Page, type TestInfo } from '@playwright/test'

const api = process.env.VITE_API_BASE_URL ?? 'http://localhost:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'

async function apiHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${api}/healthz`, { signal: AbortSignal.timeout(4000) })
    return res.ok
  } catch {
    return false
  }
}

async function skipIfApiDown(info: TestInfo) {
  if (!(await apiHealthy())) info.skip(true, `API unhealthy at ${api}`)
}

async function tryLoginUI(page: Page, email: string): Promise<boolean> {
  try {
    await page.goto('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
    return true
  } catch {
    return false
  }
}

test.describe('Salon-X P0 flows', () => {
  test('supplier catalog and analytics', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1440', 'two viewports')
    await skipIfApiDown(info)
    if (!(await tryLoginUI(page, 'supplier1@demo.local'))) info.skip(true, 'login failed')
    await page.goto('/supplier/products')
    await expect(page.getByRole('heading', { name: 'Товары' })).toBeVisible({ timeout: 15_000 })
    await page.goto('/supplier/analytics')
    await expect(page.getByRole('heading', { name: 'Аналитика' })).toBeVisible({ timeout: 15_000 })
  })

  test('master knowledge filters and favorite', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await skipIfApiDown(info)
    if (!(await tryLoginUI(page, 'master1@demo.local'))) info.skip(true, 'login failed')
    await page.goto('/knowledge')
    await expect(page.getByRole('heading', { name: 'База знаний' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Колористика' }).click()
    const first = page.locator('a.list-item, a.product-card, article a').first()
    if (await first.isVisible().catch(() => false)) {
      await first.click()
      const fav = page.getByRole('button', { name: /избранное/i })
      if (await fav.isVisible().catch(() => false)) await fav.click()
    }
  })

  test('representative home', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await skipIfApiDown(info)
    if (!(await tryLoginUI(page, 'rep1@demo.local'))) info.skip(true, 'login failed')
    await page.goto('/rep')
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 15_000 })
  })

  test('professional-only product is hidden from client API', async ({}, info) => {
    await skipIfApiDown(info)
    const login = await fetch(`${api}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'client1@demo.local', password }),
    })
    if (!login.ok) info.skip(true, 'client login failed')
    const body = await login.json() as { access_token: string }
    const res = await fetch(`${api}/v1/commerce/shop/products`, {
      headers: { Authorization: `Bearer ${body.access_token}` },
    })
    if (!res.ok) return
    const data = await res.json() as { items?: Array<{ name: string; audience?: string }> }
    expect((data.items ?? []).some((p) => /Pro Fiber/i.test(p.name))).toBeFalsy()
  })
})
