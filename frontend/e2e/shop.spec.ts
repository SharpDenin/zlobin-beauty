import { test, expect } from '@playwright/test'

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

async function loginUI(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

async function apiLogin(email: string) {
  const res = await fetch(`${api}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(res.ok, `login ${email} → ${res.status}`).toBeTruthy()
  return res.json() as Promise<{ access_token: string }>
}

async function clearClientCart(token: string) {
  const cart = await fetch(`${api}/v1/commerce/shop/cart`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!cart.ok) return
  const data = await cart.json() as { items?: Array<{ product_id: string }> }
  for (const it of data.items ?? []) {
    await fetch(`${api}/v1/commerce/shop/cart/items/${it.product_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
  }
}

async function assertNoPageOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  expect(overflow).toBe(false)
}

test.describe('production shop', () => {
  test('client shop catalog → product → cart → checkout → order', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1920', 'key viewports')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    const client = await apiLogin('client1@demo.local')
    await clearClientCart(client.access_token)
    await loginUI(page, 'client1@demo.local')
    await page.goto('/shop')
    await expect(page.getByRole('heading', { name: 'Магазин' })).toBeVisible({ timeout: 15_000 })
    await assertNoPageOverflow(page)

    const productCard = page.locator('.shop-product-card').filter({
      has: page.getByRole('button', { name: 'В корзину', disabled: false }),
    }).first()
    await expect(productCard).toBeVisible({ timeout: 15_000 })
    await expect(productCard.getByRole('link', { name: 'Подробнее' })).toBeVisible()
    await expect(page.getByText(/Pro Fiber/i)).toHaveCount(0)
    await expect(page.getByText('Только для салонов')).toHaveCount(0)

    if (info.project.name === 'phone-390') {
      await page.getByRole('button', { name: /Фильтры/ }).click()
      await expect(page.getByRole('dialog', { name: 'Фильтры' })).toBeVisible()
      await page.getByRole('button', { name: 'Закрыть' }).click()
    }

    await productCard.getByRole('link', { name: 'Подробнее' }).click()
    await expect(page.getByRole('button', { name: 'Добавить в корзину' })).toBeVisible({ timeout: 15_000 })
    await assertNoPageOverflow(page)
    await page.getByRole('button', { name: 'Добавить в корзину' }).click()
    await expect(page.getByText('Добавлено в корзину')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('link', { name: /Корзина/ }).first().click()
    await expect(page.getByRole('heading', { name: 'Корзина' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Оформить заказ' })).toBeEnabled()
    await assertNoPageOverflow(page)
    await page.getByRole('button', { name: 'Оформить заказ' }).click()

    await expect(page.getByRole('heading', { name: 'Оформление заказа' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /Далее · оплата/i }).click()
    await page.getByRole('button', { name: /Далее · сводка/i }).click()
    await page.getByRole('button', { name: 'Подтвердить' }).click()
    await page.getByRole('button', { name: 'Подтвердить заказ' }).click()
    await expect(page.locator('.success-panel').getByText('Готово')).toBeVisible({ timeout: 20_000 })
    await page.locator('.success-panel').getByRole('link', { name: 'Мои заказы' }).click()
    await expect(page.getByRole('heading', { name: 'Мои заказы' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.shop-order').first()).toBeVisible()
    await assertNoPageOverflow(page)
  })
})
