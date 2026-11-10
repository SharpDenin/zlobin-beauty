import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

async function loginUI(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

test.describe('Settings hub appearance', () => {
  test.beforeEach(async () => {
    if (!(await apiHealthy())) {
      test.skip(true, `API unhealthy at ${api}`)
    }
  })

  test('theme and system wallpaper round-trip from settings', async ({ page }) => {
    await loginUI(page, 'client1@demo.local')
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/settings\/appearance/)
    await expect(page.getByTestId('settings-page')).toBeVisible()
    await expect(page.getByTestId('settings-appearance')).toBeVisible()

    await page.getByRole('radio', { name: 'Светлая тема' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    await Promise.all([
      page.waitForResponse((res) =>
        res.url().includes('/v1/me/preferences/') && res.request().method() === 'PUT' && res.ok(),
      ),
      page.getByTestId('settings-bg-mist-canyon').click(),
    ])
    await expect(page.getByText('Системный фон сохранён')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('settings-bg-mist-canyon')).toHaveAttribute('aria-pressed', 'true')

    // Wallpaper accent cache is written (curated or extracted) and survives reload.
    await expect.poll(async () => page.evaluate(() => localStorage.getItem('zb.home-bg-accent'))).toContain('mist-canyon')
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim(),
    )
    expect(primary).toMatch(/^#?[0-9a-fA-F]{3,8}$|^rgb/i)

    await page.getByRole('radio', { name: 'Тёмная тема' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const primaryDark = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim(),
    )
    expect(primaryDark).toBeTruthy()
  })

  test('custom wallpaper upload delete and ownership', async ({ page, request }) => {
    await loginUI(page, 'client1@demo.local')
    await page.goto('/settings/appearance')

    const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/backgrounds/pebble-shore.jpg')
    await page.getByTestId('settings-bg-upload').setInputFiles(fixture)
    const crop = page.getByTestId('image-crop-editor')
    await expect(crop).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('image-crop-confirm').click()
    await expect(page.getByText('Свой фон загружен')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('settings-bg-delete')).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('settings-bg-delete')).toBeVisible({ timeout: 15_000 })

    const token = await page.evaluate(() => {
      const raw = localStorage.getItem('zb.auth')
      if (!raw) return null
      try {
        return (JSON.parse(raw) as { accessToken?: string }).accessToken ?? null
      } catch {
        return null
      }
    })
    expect(token).toBeTruthy()

    const mediaId = await page.evaluate(() => localStorage.getItem('zb.home-bg-media'))
    expect(mediaId).toBeTruthy()

    const other = await request.post(`${api}/v1/auth/login`, {
      data: { email: 'client2@demo.local', password },
    })
    if (other.ok()) {
      const body = await other.json() as { access_token: string }
      const del = await request.delete(`${api}/v1/media/${mediaId}`, {
        headers: { Authorization: `Bearer ${body.access_token}` },
      })
      expect([403, 404]).toContain(del.status())
    }

    await page.getByTestId('settings-bg-delete').click()
    await expect(page.getByText(/фон удалён|фон по умолчанию/i)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('settings-bg-delete')).toHaveCount(0)
  })
})

test.describe('Settings account deletion', () => {
  test.beforeEach(async () => {
    if (!(await apiHealthy())) {
      test.skip(true, `API unhealthy at ${api}`)
    }
  })

  test('confirm modal requires password and owner cannot self-delete', async ({ page, browserName }, info) => {
    // Mobile + desktop confirmation UX
    await page.setViewportSize(info.project.name.includes('mobile') || browserName === 'webkit'
      ? { width: 390, height: 844 }
      : { width: 1280, height: 800 })

    await loginUI(page, 'master1@demo.local')
    await page.goto('/settings/account')
    await expect(page.getByTestId('settings-account-page')).toBeVisible()
    await page.getByTestId('settings-account-delete-open').click()
    await expect(page.getByTestId('settings-account-delete-password')).toBeVisible()
    await expect(page.getByTestId('settings-account-delete-confirm')).toBeDisabled()

    await page.getByTestId('settings-account-delete-password').fill(password)
    await expect(page.getByTestId('settings-account-delete-confirm')).toBeEnabled()
    await page.getByTestId('settings-account-delete-confirm').click()
    await expect(page.getByRole('alert')).toContainText(/владел|организац/i, { timeout: 15_000 })
    await expect(page).toHaveURL(/\/settings\/account/)
  })

  test('client can delete own account and cannot reuse session', async ({ page, request }) => {
    const email = `delete-me-${Date.now()}@demo.local`
    const reg = await request.post(`${api}/v1/auth/register`, {
      data: { email, password, display_name: 'Delete Me' },
    })
    expect(reg.ok()).toBeTruthy()

    await loginUI(page, email)
    const refreshToken = await page.evaluate(() => {
      const raw = localStorage.getItem('zb.auth')
      if (!raw) return null
      try {
        return (JSON.parse(raw) as { refreshToken?: string }).refreshToken ?? null
      } catch {
        return null
      }
    })
    expect(refreshToken).toBeTruthy()

    await page.goto('/settings/account')
    await page.getByTestId('settings-account-delete-open').click()
    await page.getByTestId('settings-account-delete-password').fill(password)
    await Promise.all([
      page.waitForURL(/\/login/, { timeout: 20_000 }),
      page.getByTestId('settings-account-delete-confirm').click(),
    ])
    await expect(page).toHaveURL(/\/login/)

    const refresh = await request.post(`${api}/v1/auth/refresh`, {
      data: { refresh_token: refreshToken },
    })
    expect(refresh.status()).toBeGreaterThanOrEqual(400)

    const login = await request.post(`${api}/v1/auth/login`, {
      data: { email, password },
    })
    expect(login.status()).toBeGreaterThanOrEqual(400)

    await page.goto('/settings/account')
    await expect(page).toHaveURL(/\/login/)
  })
})
