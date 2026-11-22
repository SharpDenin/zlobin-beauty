import { test, expect, type Page, type Route } from '@playwright/test'

const api = process.env.VITE_API_BASE_URL ?? 'http://localhost:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'

const FIXTURE_ORG_ID = 'e2e-close-org'
const FIXTURE_BRANCH_ID = 'e2e-close-branch'
const FIXTURE_BRANCH_NAME = 'Филиал Мок с длинным названием для переноса на узком экране'

async function apiHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${api}/healthz`, { signal: AbortSignal.timeout(4000) })
    return res.ok
  } catch {
    return false
  }
}

async function loginApi(email: string): Promise<{ access_token: string; refresh_token?: string } | null> {
  try {
    const res = await fetch(`${api}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    return (await res.json()) as { access_token: string; refresh_token?: string }
  } catch {
    return null
  }
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

/** Isolate salon list + readiness from live seed so runs do not interfere. */
async function installSalonFixtureRoutes(page: Page) {
  await page.route(/\/v1\/organizations\/mine(?:\?|$)/, async (route) => {
    await fulfillJson(route, {
      items: [
        {
          organization: {
            id: FIXTURE_ORG_ID,
            name: 'E2E Close Salon',
            type: 'salon',
            published: true,
            city: 'Красноярск',
            address_line: 'ул. Тестовая, 1',
            status: 'active',
          },
          roles: ['owner'],
          branches: [
            {
              id: FIXTURE_BRANCH_ID,
              name: FIXTURE_BRANCH_NAME,
              city: 'Красноярск',
              address_line: 'ул. Тестовая, 1',
              phone: '+79001112233',
              published: true,
              active: true,
              organization_id: FIXTURE_ORG_ID,
            },
          ],
        },
      ],
    })
  })

  await page.route(/\/v1\/organizations\/[^/]+\/readiness/, async (route) => {
    await fulfillJson(route, { ready: true, missing: [], checks: [] })
  })

  await page.route(/\/v1\/branches\/[^/]+\/readiness/, async (route) => {
    await fulfillJson(route, { ready: true, missing: [], checks: [] })
  })
}

async function loginViaStorage(page: Page, email: string) {
  const session = await loginApi(email)
  if (!session?.access_token) {
    test.skip(true, `cannot login ${email}`)
  }
  await page.addInitScript((auth) => {
    sessionStorage.removeItem('zb.settings-manage-org')
    localStorage.setItem(
      'zb.auth',
      JSON.stringify({
        accessToken: auth.access_token,
        refreshToken: auth.refresh_token ?? '',
      }),
    )
  }, session!)
  await page.goto('/settings/salons')
  await expect(page.getByTestId('settings-salons')).toBeVisible({ timeout: 15_000 })
}

async function openCloseModal(page: Page) {
  const card = page.getByTestId('settings-salon-card').filter({ hasText: 'E2E Close Salon' })
  await expect(card).toBeVisible()
  await card.getByTestId('settings-manage-salon').click()

  const panel = page.getByTestId('settings-salon-manage')
  await expect(panel).toBeVisible()
  const row = panel.getByTestId('settings-branch-row')
  await expect(row).toBeVisible()

  const closeBtn = row.getByTestId('settings-close-branch')
  await expect(closeBtn).toBeVisible()
  await expect(closeBtn).toHaveAttribute('aria-label', /Закрыть филиал/)
  const box = await closeBtn.boundingBox()
  expect(box, 'close control must have a layout box').not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)

  await closeBtn.click()
  // Modal content testids — avoid brittle accessible-name matching on portaled dialog.
  await expect(page.getByTestId('branch-close-preflight')).toBeVisible()
}

async function assertNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
}

test.describe('Branch close modal', () => {
  test.beforeEach(async ({ page }) => {
    if (!(await apiHealthy())) {
      test.skip(true, `API unhealthy at ${api}`)
    }
    // Block service-worker control so Workbox cannot reload mid-test.
    await page.addInitScript(() => {
      const sw = navigator.serviceWorker
      if (!sw) return
      sw.register = () => Promise.reject(new Error('service worker disabled in e2e'))
      void sw.getRegistrations?.().then((regs) => regs.forEach((r) => void r.unregister()))
    })
    await installSalonFixtureRoutes(page)
  })

  test('preflight confirm and result', async ({ page }) => {
    await page.route(/\/v1\/branches\/[^/]+\/close\/preflight/, async (route) => {
      await fulfillJson(route, {
        branch_id: FIXTURE_BRANCH_ID,
        branch_name: FIXTURE_BRANCH_NAME,
        organization_name: 'E2E Close Salon',
        active: true,
        already_closed: false,
        future_appointments: 3,
        masters_affected: 2,
        last_active_branch: true,
        will_unpublish_org: true,
        contact_phone: '+79001112233',
        contact_source: 'admin',
        contact_display: '+79001112233',
        can_close: true,
        blockers: [],
        latest_job_status: '',
      })
    })
    await page.route(/\/v1\/branches\/[^/]+\/close$/, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      await fulfillJson(route, {
        id: 'job-mock',
        status: 'completed',
        org_unpublished: true,
        result: { cancelled_appointments: 3 },
      })
    })

    await loginViaStorage(page, 'master1@demo.local')
    await expect(page.getByTestId('settings-salon-card')).toHaveCount(1)

    await openCloseModal(page)
    await expect(page.getByTestId('branch-close-future-count')).toHaveText(/Будущих записей к отмене:\s*3/)
    await expect(page.getByTestId('branch-close-masters-count')).toHaveText(/Затронутых мастеров:\s*2/)
    await expect(page.getByTestId('branch-close-last-branch')).toBeVisible()
    await assertNoHorizontalOverflow(page)

    const submit = page.getByTestId('branch-close-submit')
    await expect(submit).toBeDisabled()
    await page.getByTestId('branch-close-confirm').check()
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect(page.getByTestId('branch-close-result')).toContainText(/Филиал закрыт/)
    await expect(page.getByTestId('branch-close-result')).toContainText(/Отменено записей:\s*3/)
    await assertNoHorizontalOverflow(page)
  })

  test('shows blockers and no submit', async ({ page }) => {
    await page.route(/\/v1\/branches\/[^/]+\/close\/preflight/, async (route) => {
      await fulfillJson(route, {
        branch_id: FIXTURE_BRANCH_ID,
        branch_name: FIXTURE_BRANCH_NAME,
        organization_name: 'E2E Close Salon',
        active: true,
        already_closed: false,
        future_appointments: 0,
        masters_affected: 0,
        last_active_branch: false,
        will_unpublish_org: false,
        contact_phone: '',
        contact_source: 'none',
        contact_display: 'Свяжитесь с салоном через приложение',
        can_close: false,
        blockers: [
          { code: 'open_client_pickups', label: 'Клиентские заказы с самовывозом', count: 2, href: '/shop/orders' },
          { code: 'active_chair_leases', label: 'Активные аренды кресел', count: 1 },
        ],
        latest_job_status: '',
      })
    })

    await loginViaStorage(page, 'master1@demo.local')
    await openCloseModal(page)

    const blockers = page.getByTestId('branch-close-blockers')
    await expect(blockers).toBeVisible()
    await expect(blockers).toContainText(/Клиентские заказы с самовывозом:\s*2/)
    await expect(blockers).toContainText(/Активные аренды кресел:\s*1/)
    await expect(page.getByTestId('branch-close-submit')).toHaveCount(0)
    await assertNoHorizontalOverflow(page)
  })
})

test.describe('Branch close auth', () => {
  test.beforeEach(async () => {
    if (!(await apiHealthy())) {
      test.skip(true, `API unhealthy at ${api}`)
    }
  })

  test('unauthenticated close preflight is rejected', async ({ request }) => {
    const res = await request.get(`${api}/v1/branches/00000000-0000-0000-0000-000000000001/close/preflight`)
    expect([401, 403]).toContain(res.status())
  })
})
