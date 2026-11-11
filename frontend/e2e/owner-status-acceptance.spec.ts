import { test, expect, type Page } from '@playwright/test'

/**
 * Server acceptance for owner_status search + account switch + Push finite states.
 * Set E2E_REQUIRE_API=1 on the server so unhealthy API fails the run instead of skip.
 */
const api = process.env.E2E_API_BASE_URL
  ?? (process.env.VITE_API_BASE_URL?.startsWith('http') ? process.env.VITE_API_BASE_URL : null)
  ?? 'http://127.0.0.1:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'
const requireAPI = process.env.E2E_REQUIRE_API === '1'

async function apiHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${api}/healthz`, { signal: AbortSignal.timeout(4000) })
    return res.ok
  } catch {
    return false
  }
}

async function ensureAPI(info: { project: { name: string } }) {
  test.skip(info.project.name !== 'phone-390', 'run once')
  if (await apiHealthy()) return
  if (requireAPI) {
    throw new Error(`API unhealthy at ${api} (E2E_REQUIRE_API=1)`)
  }
  test.skip(true, `API unhealthy at ${api}`)
}

async function loginUI(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 })
}

async function logoutUI(page: Page) {
  const topbar = page.locator('.topbar-logout')
  if (await topbar.isVisible().catch(() => false)) {
    await topbar.click()
  } else {
    await page.goto('/profile')
    await page.getByRole('button', { name: 'Выйти' }).click()
  }
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
}

async function searchMasters(includeOther = true) {
  const q = new URLSearchParams({
    city: 'Красноярск',
    limit: '50',
  })
  if (includeOther) q.set('include_other_cities', 'true')
  const res = await fetch(`${api}/v1/masters?${q}`)
  const body = await res.json() as { items: Array<{ id: string; user_id: string; display_name: string; service_names?: string[] }> }
  expect(res.ok, JSON.stringify(body)).toBeTruthy()
  return body.items
}

test.describe('owner_status server acceptance', () => {
  test('search API returns published masters with services', async ({}, info) => {
    await ensureAPI(info)
    const items = await searchMasters(true)
    expect(items.length, 'seed/staging must have at least one searchable master').toBeGreaterThan(0)
    const withServices = items.filter((m) => (m.service_names?.length ?? 0) > 0)
    expect(withServices.length, 'expected masters with published services').toBeGreaterThan(0)
  })

  test('account switch master → client clears prior identity', async ({ page }, info) => {
    await ensureAPI(info)
    await page.setViewportSize({ width: 390, height: 844 })
    await loginUI(page, 'master1@demo.local')
    await logoutUI(page)
    await loginUI(page, 'client1@demo.local')
    await page.goto('/profile')
    await expect(page.getByText(/master1@demo\.local/i)).toHaveCount(0)
  })

  test('Push leaves checking within 15s', async ({ page }, info) => {
    await ensureAPI(info)
    await loginUI(page, 'client1@demo.local')
    await page.goto('/settings/notifications')
    await expect(page.getByTestId('device-push-card')).toBeVisible()
    await expect
      .poll(async () => page.getByTestId('device-push-status').textContent(), { timeout: 15_000 })
      .not.toMatch(/Проверяем/)
  })

  test('client → master switch and search still works', async ({ page }, info) => {
    await ensureAPI(info)
    await loginUI(page, 'client1@demo.local')
    await logoutUI(page)
    await loginUI(page, 'master1@demo.local')
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
  })
})
