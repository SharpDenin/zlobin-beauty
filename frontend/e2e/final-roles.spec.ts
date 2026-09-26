import { test, expect, type Page } from '@playwright/test'

const api = process.env.VITE_API_BASE_URL ?? 'http://localhost:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@example.com'
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? 'ChangeMeAdmin1!'

async function apiHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${api}/healthz`, { signal: AbortSignal.timeout(4000) })
    return res.ok
  } catch {
    return false
  }
}

async function loginUI(page: Page, email: string, pass = password) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(pass)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

async function requireApi() {
  if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
}

test.describe('final role smokes', () => {
  test('client reaches home, shop, knowledge and profile', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await requireApi()
    await loginUI(page, 'client1@demo.local')
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
    await page.goto('/shop')
    await expect(page.getByRole('heading', { name: 'Магазин' })).toBeVisible({ timeout: 15_000 })
    await page.goto('/knowledge')
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 })
    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: /Профиль/i })).toBeVisible({ timeout: 15_000 })
  })

  test('master reaches calendar, services and knowledge', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await requireApi()
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await expect(page.getByRole('heading', { name: /Календарь/i })).toBeVisible({ timeout: 15_000 })
    await page.goto('/services')
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 })
    await page.goto('/knowledge')
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 })
  })

  test('supplier reaches catalog, knowledge, orders and warehouse', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await requireApi()
    await loginUI(page, 'supplier1@demo.local')
    await page.goto('/supplier/products')
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 })
    await page.goto('/knowledge')
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 })
    await page.goto('/supplier/orders')
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 })
    await page.goto('/warehouse')
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 })
  })

  test('admin reaches users, products, knowledge, disputes and audit', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await requireApi()
    const login = await fetch(`${api}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    })
    if (!login.ok) test.skip(true, 'bootstrap-admin login unavailable')
    await loginUI(page, adminEmail, adminPassword)
    await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 })
    for (const [path, heading] of [
      ['/admin/users', 'Пользователи'],
      ['/admin/products', 'Товары'],
      ['/admin/knowledge', 'База знаний'],
      ['/admin/disputes', 'Споры'],
      ['/admin/audit', 'Журнал аудита'],
    ] as const) {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 15_000 })
    }
  })

  test('client cannot open admin', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await requireApi()
    await loginUI(page, 'client1@demo.local')
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Этот раздел доступен только системным администраторам.')).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
  })
})
