import { test, expect, type Page } from '@playwright/test'

/**
 * Hardened Salon-X P0 e2e.
 * When API is down → skip (no stack). When API is up but seed/login missing → FAIL.
 */
const api = process.env.VITE_API_BASE_URL ?? 'http://localhost:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'
const requireSeed = process.env.E2E_REQUIRE_SEED !== '0'

async function apiHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${api}/healthz`, { signal: AbortSignal.timeout(4000) })
    return res.ok
  } catch {
    return false
  }
}

async function requireApi() {
  if (!(await apiHealthy())) {
    test.skip(true, `API unhealthy at ${api} — start docker stack to run these tests`)
  }
}

async function loginUI(page: Page, email: string) {
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

test.describe('Salon-X P0 flows (seeded stack)', () => {
  test.beforeEach(async () => {
    await requireApi()
  })

  test('supplier products + analytics + warehouse', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1920', 'two viewports')
    await loginUI(page, 'supplier1@demo.local')
    await page.goto('/supplier/products')
    await expect(page.getByRole('heading', { name: 'Товары' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.product-card, .list-item, a[href*="/supplier/products/"]').first()).toBeVisible({ timeout: 15_000 })
    await page.goto('/supplier/analytics')
    await expect(page.getByRole('heading', { name: 'Аналитика' })).toBeVisible({ timeout: 15_000 })
    await page.goto('/warehouse')
    await expect(page.getByRole('heading', { name: 'Склад', exact: true })).toBeVisible({ timeout: 15_000 })
  })

  test('master knowledge filters + favorite', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/knowledge')
    await expect(page.getByRole('heading', { name: 'База знаний' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Для окрашивания' }).click()
    const article = page.locator('a[href*="/knowledge/"]').first()
    await expect(article).toBeVisible({ timeout: 15_000 })
    await article.click()
    await expect(page.getByRole('button', { name: /избранное/i })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /избранное/i }).click()
  })

  test('representative route and tasks', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'rep1@demo.local')
    await page.goto('/rep')
    await expect(page.getByRole('heading', { name: 'Кабинет представителя' })).toBeVisible({ timeout: 15_000 })
    await page.goto('/rep/map')
    await expect(page.getByRole('heading', { name: 'Карта маршрута' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 15_000 })
  })

  test('salon owner staff + contact policy', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/staff')
    await expect(page.getByRole('heading', { name: /команда/i })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/контактн/i)).toBeVisible()
  })

  test('professional-only hidden from client shop API', async () => {
    const { access_token } = await apiLogin('client1@demo.local')
    const res = await fetch(`${api}/v1/commerce/shop/products`, {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    expect(res.ok).toBeTruthy()
    const data = await res.json() as { items?: Array<{ name: string }> }
    expect((data.items ?? []).some((p) => /Pro Fiber/i.test(p.name))).toBeFalsy()
  })

  test('subscription snapshot exists', async () => {
    const { access_token } = await apiLogin('master1@demo.local')
    const res = await fetch(`${api}/v1/me/subscription`, {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    expect(res.ok).toBeTruthy()
    const snap = await res.json() as { effective_plan?: string; status?: string }
    expect(snap.effective_plan || snap.status).toBeTruthy()
  })

  test('seeded recurring supply is visible to buyer', async () => {
    const { access_token } = await apiLogin('master1@demo.local')
    const orgsRes = await fetch(`${api}/v1/organizations/mine`, {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    expect(orgsRes.ok).toBeTruthy()
    const orgs = await orgsRes.json() as { items?: Array<{ organization: { id: string; type: string } }> }
    const buyer = (orgs.items ?? []).find((item) => item.organization.type !== 'supplier')
    expect(buyer?.organization.id).toBeTruthy()
    const recurring = await fetch(
      `${api}/v1/commerce/recurring?organization_id=${buyer!.organization.id}&role=buyer`,
      { headers: { Authorization: `Bearer ${access_token}` } },
    )
    expect(recurring.ok).toBeTruthy()
    const data = await recurring.json() as { items?: unknown[] }
    expect((data.items ?? []).length).toBeGreaterThan(0)
  })

  test('planner block controls and blacklist status are available', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await expect(page.getByRole('heading', { name: 'Новый блок', exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Добавить блок', exact: true })).toBeVisible()

    const client = await apiLogin('client1@demo.local')
    const master = await apiLogin('master1@demo.local')
    const clientMe = await fetch(`${api}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const clientUser = await clientMe.json() as { id?: string; user?: { id?: string } }
    const clientId = clientUser.id ?? clientUser.user?.id
    expect(clientId).toBeTruthy()
    const status = await fetch(`${api}/v1/me/clients/${clientId}/blacklist`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(status.ok).toBeTruthy()
    const body = await status.json() as { blocked?: boolean; no_show_count?: number }
    expect(typeof body.blocked).toBe('boolean')
    expect(typeof body.no_show_count).toBe('number')
  })

  test('client shop catalog is in navigation', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'client1@demo.local')
    await page.goto('/shop')
    await expect(page.getByRole('heading', { name: 'Магазин' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Каталог' })).toBeVisible()
  })

  test('master dashboard and calendar modes', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible({ timeout: 15_000 })
    await page.goto('/calendar')
    await expect(page.getByRole('button', { name: 'Неделя' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'День' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Месяц' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Список' })).toBeVisible()
  })

  test('subscription page shows trial or plan', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/profile/subscription')
    await expect(page.getByRole('heading', { name: 'Подписка' })).toBeVisible({ timeout: 15_000 })
  })

  test('seed accounts exist when E2E_REQUIRE_SEED', async () => {
    if (!requireSeed) return
    for (const email of [
      'client1@demo.local',
      'client2@demo.local',
      'client3@demo.local',
      'master1@demo.local',
      'master2@demo.local',
      'master3@demo.local',
      'master4@demo.local',
      'chain1@demo.local',
      'mobile1@demo.local',
      'admin1@demo.local',
      'expired1@demo.local',
      'supplier1@demo.local',
      'supplier2@demo.local',
      'rep1@demo.local',
      'rep2@demo.local',
    ]) {
      await apiLogin(email)
    }
  })

  test('blacklisted client is blocked for master1 and has no-show count', async () => {
    const client3 = await apiLogin('client3@demo.local')
    const master = await apiLogin('master1@demo.local')
    const me = await fetch(`${api}/v1/auth/me`, { headers: { Authorization: `Bearer ${client3.access_token}` } })
    const body = await me.json() as { id?: string; user?: { id?: string } }
    const clientId = body.id ?? body.user?.id
    expect(clientId).toBeTruthy()
    const status = await fetch(`${api}/v1/me/clients/${clientId}/blacklist`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(status.ok).toBeTruthy()
    const bl = await status.json() as { blocked?: boolean; no_show_count?: number }
    expect(bl.blocked).toBe(true)
    expect((bl.no_show_count ?? 0)).toBeGreaterThanOrEqual(2)
  })
})
