import { test, expect, type Page } from '@playwright/test'

const api = process.env.E2E_API_BASE_URL
  ?? (process.env.VITE_API_BASE_URL?.startsWith('http') ? process.env.VITE_API_BASE_URL : null)
  ?? 'http://127.0.0.1:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1280, height: 800 },
] as const

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

async function logoutUI(page: Page) {
  // Prefer topbar logout when visible; fall back to profile.
  const topbar = page.locator('.topbar-logout')
  if (await topbar.isVisible().catch(() => false)) {
    await topbar.click()
  } else {
    await page.goto('/profile')
    await page.getByRole('button', { name: 'Выйти' }).click()
  }
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
}

test.describe('Account switch / Push / Search regressions', () => {
  test('master → logout → client login on one device', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'run once')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    await page.setViewportSize({ width: 390, height: 844 })
    await loginUI(page, 'master1@demo.local')
    await expect(page.getByText(/Мастер|Salon|Salon-X|Главная/i).first()).toBeVisible({ timeout: 15_000 })

    await logoutUI(page)
    await loginUI(page, 'client1@demo.local')

    await page.goto('/profile')
    await expect(page.getByText(/client1|Клиент/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/master1@demo\.local/i)).toHaveCount(0)
  })

  test('Push status leaves checking within a finite timeout', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'run once')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    await loginUI(page, 'client1@demo.local')
    await page.goto('/settings/notifications')
    await expect(page.getByTestId('device-push-card')).toBeVisible()
    await expect
      .poll(async () => page.getByTestId('device-push-status').textContent(), { timeout: 15_000 })
      .not.toMatch(/Проверяем/)
  })

  test('public search API returns published active masters', async ({ request }, info) => {
    test.skip(info.project.name !== 'phone-390', 'API once')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    const res = await request.get(`${api}/v1/masters?city=${encodeURIComponent('Красноярск')}&limit=20&include_other_cities=true`)
    expect(res.ok(), await res.text()).toBeTruthy()
    const body = await res.json() as { items: Array<{ id: string; display_name: string; published?: boolean }> }
    expect(Array.isArray(body.items)).toBeTruthy()
    expect(body.items.length, 'expected at least one published master in seed').toBeGreaterThan(0)
  })

  test('search page shows master cards from API', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'run once')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    await loginUI(page, 'client1@demo.local')
    for (const vp of viewports) {
      await page.setViewportSize(vp)
      await page.goto('/search')
      await page.locator('#include_other_cities').check().catch(() => undefined)
      await page.getByRole('button', { name: 'Искать' }).click()
      await expect
        .poll(
          async () =>
            (await page.getByTestId('search-master-card').count())
            + (await page.getByTestId('search-master-self').count()),
          { timeout: 20_000 },
        )
        .toBeGreaterThan(0)
    }
  })
})
