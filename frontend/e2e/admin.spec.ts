import { test, expect } from '@playwright/test'

const api = process.env.VITE_API_BASE_URL ?? 'http://localhost:8090'
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

async function adminLoginAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${api}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function loginUI(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(adminEmail)
  await page.getByLabel('Пароль').fill(adminPassword)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

function visibleAdminLink(page: import('@playwright/test').Page) {
  return page.locator('.admin-card-link, .admin-table-desktop tbody a').locator('visible=true')
}

test.describe('platform admin', () => {
  test('bootstrap admin reaches dashboard', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    if (!(await adminLoginAvailable())) test.skip(true, 'bootstrap-admin login unavailable')
    await loginUI(page)
    await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Администрирование' })).toBeVisible()
  })

  test('user moderation confirmation', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    if (!(await adminLoginAvailable())) test.skip(true, 'bootstrap-admin login unavailable')
    await loginUI(page)
    await page.goto('/admin/users?role=client')
    await expect(page.getByRole('heading', { name: 'Пользователи' })).toBeVisible()
    const first = visibleAdminLink(page).filter({ hasNotText: 'System Admin' }).first()
    await expect(first).toBeVisible({ timeout: 15_000 })
    await first.click()
    const block = page.getByRole('button', { name: 'Заблокировать' })
    const unblock = page.getByRole('button', { name: 'Разблокировать' })
    await expect(block.or(unblock)).toBeVisible({ timeout: 15_000 })
    if (await unblock.isVisible()) {
      await unblock.click()
      await page.getByRole('dialog').getByRole('button', { name: 'Разблокировать' }).click()
      await expect(block).toBeVisible({ timeout: 15_000 })
    }
    await block.click()
    await expect(page.getByText('Заблокировать пользователя')).toBeVisible()
    await page.getByLabel('Причина').fill('проверка модерации')
    await page.getByRole('dialog').getByRole('button', { name: 'Заблокировать' }).click()
    await expect(page.getByText('Заблокирован')).toBeVisible({ timeout: 15_000 })
    await page.goto('/admin/audit')
    await expect(page.getByRole('heading', { name: 'Журнал аудита' })).toBeVisible()
    await expect(page.getByText('Заблокирован пользователь').locator('visible=true').first()).toBeVisible({ timeout: 15_000 })
  })

  test('products and knowledge filters open details', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    if (!(await adminLoginAvailable())) test.skip(true, 'bootstrap-admin login unavailable')
    await loginUI(page)
    await page.goto('/admin/products')
    await expect(page.getByRole('heading', { name: 'Товары' })).toBeVisible()
    const product = visibleAdminLink(page).first()
    if (await product.count()) {
      await product.click()
      await expect(page.getByRole('heading').first()).toBeVisible()
    }
    await page.goto('/admin/knowledge?audience_kind=professional')
    await expect(page.getByRole('heading', { name: 'База знаний' })).toBeVisible()
    const article = visibleAdminLink(page).first()
    if (await article.count()) {
      await article.click()
      await expect(page.getByRole('heading').first()).toBeVisible()
    }
  })
})
