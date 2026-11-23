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

async function apiLogin(email: string) {
  const res = await fetch(`${api}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(res.ok, `login ${email} → ${res.status}`).toBeTruthy()
  return (await res.json()) as { access_token: string; refresh_token?: string; user: { id: string; display_name?: string } }
}

async function loginViaStorage(page: Page, email: string, path = '/') {
  const session = await apiLogin(email)
  await page.addInitScript((auth) => {
    localStorage.setItem(
      'zb.auth',
      JSON.stringify({
        accessToken: auth.access_token,
        refreshToken: auth.refresh_token ?? '',
      }),
    )
  }, session)
  await page.goto(path)
}

const VIEWPORTS = ['phone-360', 'phone-390', 'phone-430', 'desktop-1280'] as const

test.describe('Group 5 invites history + counters', () => {
  test('client QR one-time + history + referral progress', async ({ page }, info) => {
    test.skip(!VIEWPORTS.includes(info.project.name as typeof VIEWPORTS[number]), 'target viewports')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    await loginViaStorage(page, 'master1@demo.local', '/clients/invite')
    await expect(page.getByTestId('invite-client-page')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('referral-progress-card')).toBeVisible()
    await expect(page.getByTestId('referral-progress-value')).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('invite-client-create').click()
    const urlEl = page.getByTestId('invite-client-url')
    await expect(urlEl).toBeVisible({ timeout: 15_000 })
    const inviteUrl = (await urlEl.textContent())?.trim() ?? ''
    expect(inviteUrl).toMatch(/\/invite\/client\/[a-f0-9]{32,}/i)

    const master = await apiLogin('master1@demo.local')
    const listRes = await fetch(`${api}/v1/clients/invites`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(listRes.ok).toBeTruthy()
    const list = await listRes.json() as { items: Array<{ max_uses: number; status: string }> }
    expect(list.items.some((i) => i.max_uses === 1 && i.status === 'active')).toBeTruthy()

    await expect(page.getByTestId('invite-client-history')).toBeVisible()
  })

  test('account settings user counters', async ({ page }, info) => {
    test.skip(!VIEWPORTS.includes(info.project.name as typeof VIEWPORTS[number]), 'target viewports')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    await loginViaStorage(page, 'client1@demo.local', '/settings/account')
    await expect(page.getByTestId('settings-account-page')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('settings-account-counters')).toBeVisible()
    await expect(page.getByTestId('settings-account-counters-list')).toBeVisible({ timeout: 15_000 })
    const text = await page.getByTestId('settings-account-counters-list').innerText()
    expect(text).toMatch(/Клиенты:\s*\d+/)
    expect(text).toMatch(/Мастера:\s*\d+/)
    expect(text).toMatch(/Поставщики:\s*\d+/)
    expect(text).toMatch(/Владельцы:\s*\d+/)

    const session = await apiLogin('client1@demo.local')
    const counters = await fetch(`${api}/v1/me/user-counters`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    expect(counters.ok).toBeTruthy()
    const body = await counters.json() as Record<string, number>
    expect(typeof body.clients).toBe('number')
    expect(typeof body.masters).toBe('number')
    expect(typeof body.suppliers).toBe('number')
    expect(typeof body.owners).toBe('number')
    // No PII fields
    expect(body).not.toHaveProperty('items')
    expect(body).not.toHaveProperty('users')
  })

  test('salon invite create is one-time', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'primary mobile')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    const owner = await apiLogin('admin1@demo.local')
    const orgsRes = await fetch(`${api}/v1/organizations/mine`, {
      headers: { Authorization: `Bearer ${owner.access_token}` },
    })
    if (!orgsRes.ok) test.skip(true, 'no orgs for admin1')
    const orgs = await orgsRes.json() as { items?: Array<{ organization?: { id: string; type?: string }; id?: string }> }
    const salon = (orgs.items ?? []).find((o) => (o.organization?.type ?? 'salon') !== 'supplier')
    const orgID = salon?.organization?.id || salon?.id
    if (!orgID) test.skip(true, 'no salon org')

    const create = await fetch(`${api}/v1/organizations/${orgID}/invites`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${owner.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'master', hours: 72, max_uses: 50 }),
    })
    expect(create.ok, `create invite ${create.status}`).toBeTruthy()
    const created = await create.json() as { invite?: { max_uses: number }; token?: string }
    expect(created.invite?.max_uses).toBe(1)

    await loginViaStorage(page, 'admin1@demo.local', '/staff/invite')
    await expect(page.getByTestId('invite-master-page')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('invite-master-history')).toBeVisible()
  })
})

