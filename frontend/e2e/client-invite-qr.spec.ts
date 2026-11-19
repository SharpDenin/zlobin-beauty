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
  const body = await res.json() as { access_token: string; user: { id: string; display_name?: string } }
  expect(body.user?.id).toBeTruthy()
  return { access_token: body.access_token, user: body.user }
}

test.describe('Stage 5 client QR invite', () => {
  test('master creates QR; client accepts; contacts linked; re-open is idempotent', async ({ page, context }, info) => {
    test.skip(info.project.name !== 'phone-390', 'mobile primary')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    const master = await apiLogin('master1@demo.local')
    const client = await apiLogin('client2@demo.local')

    await loginUI(page, 'master1@demo.local')

    // Mobile More menu: top-level groups ≤ 10; Settings/Profile in account header.
    await page.getByRole('button', { name: 'Открыть меню' }).click()
    const menu = page.locator('.more-menu-panel')
    await expect(menu.getByRole('heading', { name: 'Меню' })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Настройки', exact: true })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Профиль', exact: true })).toBeVisible()
    const topLevel = menu.locator('.more-nav-list > a, .more-nav-list > .nav-group > .nav-group-toggle')
    await expect.poll(async () => topLevel.count()).toBeLessThanOrEqual(10)
    await page.getByRole('button', { name: 'Закрыть' }).click()

    await page.goto('/clients/invite')
    await expect(page.getByTestId('invite-client-page')).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('invite-client-create').click()
    const urlEl = page.getByTestId('invite-client-url')
    await expect(urlEl).toBeVisible({ timeout: 15_000 })
    const inviteUrl = (await urlEl.textContent())?.trim() ?? ''
    expect(inviteUrl).toMatch(/\/invite\/client\/[a-f0-9]{32,}/i)

    const qr = page.locator('img[alt="QR для приглашения клиента"]')
    await expect(qr).toBeVisible()
    const qrSrc = await qr.getAttribute('src')
    expect(qrSrc).toContain(encodeURIComponent(inviteUrl))

    // Clipboard may be unavailable on plain http://frontend; stub + Share cover the UX contract.
    await page.evaluate(() => {
      ;(window as unknown as { __copied?: string | null; __shared?: ShareData | null }).__copied = null
      ;(window as unknown as { __shared?: ShareData | null }).__shared = null
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (t: string) => {
            ;(window as unknown as { __copied?: string }).__copied = t
          },
          readText: async () => (window as unknown as { __copied?: string }).__copied ?? '',
        },
      })
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data: ShareData) => {
          ;(window as unknown as { __shared?: ShareData }).__shared = data
        },
      })
    })
    await page.getByRole('button', { name: 'Скопировать ссылку' }).click()
    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { __copied?: string | null }).__copied),
    ).toBe(inviteUrl)
    await expect(page.getByRole('status')).toContainText(/скопир/i)

    await page.getByRole('button', { name: 'Поделиться' }).click()
    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { __shared?: ShareData | null }).__shared?.url ?? null),
    ).toBe(inviteUrl)

    const token = inviteUrl.split('/invite/client/')[1]
    expect(token).toBeTruthy()

    // Fresh context so master session cookies do not skip the client login form.
    const clientCtx = await context.browser()!.newContext({
      ...info.project.use,
      storageState: undefined,
    })
    const clientPage = await clientCtx.newPage()
    await loginUI(clientPage, 'client2@demo.local')
    await clientPage.goto(`/invite/client/${token}`)
    await expect(clientPage.getByTestId('invite-client-accept')).toBeVisible({ timeout: 15_000 })
    await clientPage.getByTestId('invite-client-accept-btn').click()
    await expect(clientPage).toHaveURL(/\/contacts/, { timeout: 20_000 })

    const contactsRes = await fetch(`${api}/v1/contacts?limit=100`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    expect(contactsRes.ok).toBeTruthy()
    const contacts = (await contactsRes.json()) as {
      items?: Array<{ user_id?: string }>
      total?: number
    }
    const linked = (contacts.items ?? []).filter((c) => c.user_id === master.user.id)
    expect(linked.length).toBe(1)

    // Re-open exhausted/already-used invite must not create a duplicate contact.
    await clientPage.goto(`/invite/client/${token}`)
    await clientPage.waitForTimeout(600)
    const acceptAgain = clientPage.getByTestId('invite-client-accept-btn')
    if (await acceptAgain.isVisible().catch(() => false)) {
      await acceptAgain.click()
      await clientPage.waitForTimeout(800)
    }
    const contacts2 = await fetch(`${api}/v1/contacts?limit=100`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const data2 = (await contacts2.json()) as { items?: Array<{ user_id?: string }> }
    const linked2 = (data2.items ?? []).filter((c) => c.user_id === master.user.id)
    expect(linked2.length).toBe(1)

    await clientCtx.close()
  })
})
