import { test, expect, type Page } from '@playwright/test'

const api = process.env.E2E_API_BASE_URL
  ?? (process.env.VITE_API_BASE_URL?.startsWith('http') ? process.env.VITE_API_BASE_URL : null)
  ?? 'http://127.0.0.1:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'

async function apiHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${api}/healthz`, { signal: AbortSignal.timeout(4000) })
    return res.ok
  } catch {
    return false
  }
}

async function loginUI(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 })
}

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const

test.describe('PUSH-01 settings UX', () => {
  test('settings notifications card is usable across viewports', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'viewport loop once')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    await loginUI(page, 'client1@demo.local')

    for (const vp of viewports) {
      await page.setViewportSize(vp)
      await page.goto('/settings/notifications')
      await expect(page.getByTestId('settings-notifications-page')).toBeVisible()
      await expect(page.getByTestId('device-push-card')).toBeVisible()
      await expect(page.getByTestId('device-push-status')).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
      expect(overflow, `overflow @ ${vp.width}`).toBe(false)
    }

    await page.goto('/notifications')
    await expect(page.getByTestId('device-push-card')).toBeVisible()
  })
})
