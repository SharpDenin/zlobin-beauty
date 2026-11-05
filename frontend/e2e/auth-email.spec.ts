import { test, expect, type Page } from '@playwright/test'

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

async function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    return doc.scrollWidth > doc.clientWidth + 1
  })
}

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const

test.describe('AUTH email recovery UI', () => {
  test('login links to forgot-password; forms usable across viewports', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'viewport loop once')

    await page.goto('/login')
    await expect(page.getByRole('link', { name: 'Забыли пароль?' })).toBeVisible()
    await page.getByRole('link', { name: 'Забыли пароль?' }).click()
    await expect(page.getByTestId('forgot-password-page')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Восстановление пароля' })).toBeVisible()

    for (const vp of viewports) {
      await page.setViewportSize(vp)
      await page.goto('/forgot-password')
      await expect(page.getByTestId('forgot-password-page')).toBeVisible()
      await expect(page.getByLabel('Email')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Отправить ссылку' })).toBeVisible()
      expect(await noHorizontalOverflow(page), `overflow @ ${vp.width}`).toBe(false)

      await page.goto('/reset-password')
      await expect(page.getByRole('heading', { name: 'Ссылка недействительна' })).toBeVisible()
      expect(await noHorizontalOverflow(page), `reset overflow @ ${vp.width}`).toBe(false)

      await page.goto('/reset-password?token=demo-token-for-layout')
      await expect(page.getByTestId('reset-password-page')).toBeVisible()
      await expect(page.getByLabel('Новый пароль')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Сохранить пароль' })).toBeVisible()
      expect(await noHorizontalOverflow(page), `reset form overflow @ ${vp.width}`).toBe(false)

      await page.goto('/verify-email')
      await expect(page.getByTestId('verify-email-page')).toBeVisible()
      expect(await noHorizontalOverflow(page), `verify overflow @ ${vp.width}`).toBe(false)
    }
  })

  test('password-reset request returns enumeration-safe message', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    await page.goto('/forgot-password')
    await page.getByLabel('Email').fill(`missing.${Date.now()}@example.com`)
    await page.getByRole('button', { name: 'Отправить ссылку' }).click()
    await expect(page.getByText(/Если аккаунт с таким email существует/i)).toBeVisible({ timeout: 15_000 })
  })

  test('unverified email does not block login; profile shows soft status', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    const email = `auth.ui.${Date.now()}@example.com`
    const reg = await fetch(`${api}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name: 'Auth UI' }),
    })
    expect(reg.ok, `register ${reg.status}`).toBeTruthy()
    const body = await reg.json() as { user?: { email_verified?: boolean }; access_token: string }
    expect(body.user?.email_verified ?? false).toBe(false)

    await page.goto('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 })

    await page.goto('/profile')
    await expect(page.getByTestId('email-verify-status')).toContainText(/не подтверждён/i)
    await expect(page.getByTestId('email-verify-card')).toBeVisible()
    await expect(page.getByTestId('email-verify-resend')).toBeVisible()
  })
})
