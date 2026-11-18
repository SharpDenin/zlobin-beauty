import { test, expect } from '@playwright/test'

const api = process.env.VITE_API_BASE_URL ?? 'http://localhost:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'

async function apiHealthy(): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${api}/healthz`, { signal: AbortSignal.timeout(4000) })
      if (res.ok) return true
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

async function loginUI(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

test.describe('production messenger', () => {
  test('client opens master chat and sends a message', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) {
      test.skip(true, `API unhealthy at ${api} — start docker stack to run this test`)
    }
    const master = await fetch(`${api}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'master1@demo.local', password }),
    })
    if (!master.ok) test.skip(true, 'seed login unavailable')
    const masterSession = await master.json() as { access_token: string }
    const profile = await fetch(`${api}/v1/me/master`, { headers: { Authorization: `Bearer ${masterSession.access_token}` } })
    const prof = await profile.json() as { master?: { id: string } }
    expect(prof.master?.id).toBeTruthy()

    await loginUI(page, 'client1@demo.local')
    await page.goto(`/masters/${prof.master!.id}`)
    await expect(page.getByTestId('write-master')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('write-master').click()
    await expect(page).toHaveURL(/\/messages\//, { timeout: 15_000 })
    const hello = `Уточнение по тонированию ${Date.now()}`
    await page.getByTestId('message-composer').fill(hello)
    await page.getByTestId('send-message').click()
    await expect(page.getByTestId('message-history').getByText(hello)).toBeVisible({ timeout: 10_000 })
  })

  test('master opens supplier chat and sends a message', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) {
      test.skip(true, `API unhealthy at ${api} — start docker stack to run this test`)
    }
    const suppliers = await fetch(`${api}/v1/suppliers`)
    if (!suppliers.ok) test.skip(true, 'suppliers unavailable')
    const body = await suppliers.json() as { items?: Array<{ id: string; name: string }> }
    const supplier = (body.items ?? []).find((s) => /профи/i.test(s.name)) ?? body.items?.[0]
    expect(supplier?.id).toBeTruthy()

    await loginUI(page, 'master1@demo.local')
    await page.goto(`/cosmetics/${supplier!.id}`)
    await expect(page.getByTestId('write-supplier')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('write-supplier').click()
    await expect(page).toHaveURL(/\/messages\//, { timeout: 15_000 })
    const ask = `Наличие Olaplex ${Date.now()}`
    await page.getByTestId('message-composer').fill(ask)
    await page.getByTestId('send-message').click()
    await expect(page.getByTestId('message-history').getByText(ask)).toBeVisible({ timeout: 10_000 })
  })

  test('two users: delivery latency, order, reconnect, no duplicates', async ({ browser }, info) => {
    test.skip(!['phone-390', 'desktop-1280'].includes(info.project.name), 'mobile + desktop pair')
    test.setTimeout(360_000)
    if (!(await apiHealthy())) {
      test.skip(true, `API unhealthy at ${api} — start docker stack to run this test`)
    }

    type AuthSession = {
      access_token: string
      refresh_token: string
      user: { id: string; email?: string; display_name?: string; roles?: string[]; status?: string; city?: string; phone?: string | null }
    }

    async function loginApi(email: string) {
      const res = await fetch(`${api}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) throw new Error(`login ${email}: ${res.status}`)
      return res.json() as Promise<AuthSession>
    }

    async function dismissOverlays(page: import('@playwright/test').Page) {
      for (let i = 0; i < 6; i++) {
        if ((await page.locator('[data-overlay="true"]').count()) === 0) break
        const gotIt = page.getByRole('button', { name: 'Понятно' })
        if (await gotIt.isVisible().catch(() => false)) {
          await gotIt.click()
          await page.waitForTimeout(120)
          continue
        }
        const close = page.getByRole('button', { name: 'Закрыть' })
        if (await close.isVisible().catch(() => false)) {
          await close.click()
          await page.waitForTimeout(120)
          continue
        }
        await page.keyboard.press('Escape')
        await page.waitForTimeout(120)
      }
    }

    async function openAuthedThread(page: import('@playwright/test').Page, session: AuthSession, threadUrl: string) {
      await page.addInitScript((payload) => {
        localStorage.setItem('zb.auth', JSON.stringify({
          accessToken: payload.access_token,
          refreshToken: payload.refresh_token,
          user: payload.user,
        }))
      }, session)
      await page.goto(threadUrl)
      await dismissOverlays(page)
      await expect(page.getByTestId('message-history')).toBeVisible({ timeout: 20_000 })
      await dismissOverlays(page)
    }

    let masterSession: AuthSession
    let clientSession: AuthSession
    try {
      masterSession = await loginApi('master1@demo.local')
      clientSession = await loginApi('client1@demo.local')
    } catch (e) {
      test.skip(true, `seed login unavailable: ${String(e)}`)
      return
    }

    let conversationId = ''
    const created = await fetch(`${api}/v1/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clientSession.access_token}`,
      },
      body: JSON.stringify({ type: 'client_master', master_user_id: masterSession.user.id }),
    })
    if (created.ok) {
      conversationId = ((await created.json()) as { id: string }).id
    } else {
      const listed = await fetch(`${api}/v1/conversations?limit=50`, {
        headers: { Authorization: `Bearer ${clientSession.access_token}` },
      })
      expect(listed.ok, `list conversations after create ${created.status}`).toBeTruthy()
      const body = await listed.json() as { items: Array<{ id: string; participants?: Array<{ user_id: string }> }> }
      const found = (body.items ?? []).find((c) =>
        (c.participants ?? []).some((p) => p.user_id === masterSession.user.id),
      )
      expect(found?.id, `no existing client-master conversation (create=${created.status})`).toBeTruthy()
      conversationId = found!.id
    }
    expect(conversationId).toBeTruthy()
    const threadUrl = `/messages/${conversationId}`

    const clientCtx = await browser.newContext()
    const masterCtx = await browser.newContext()
    const clientPage = await clientCtx.newPage()
    const masterPage = await masterCtx.newPage()

    await openAuthedThread(clientPage, clientSession, threadUrl)
    await openAuthedThread(masterPage, masterSession, threadUrl)

    const stamp = Date.now()
    const steadyRounds = Number(process.env.MESSENGER_LATENCY_ROUNDS ?? '5')

    async function measureDelivery(label: string): Promise<number> {
      const body = `${label} ${stamp} ${Date.now()}`
      await dismissOverlays(clientPage)
      const t0 = Date.now()
      await clientPage.getByTestId('message-composer').fill(body)
      await clientPage.getByTestId('send-message').click({ force: true })
      await expect(masterPage.getByTestId('message-history').getByText(body, { exact: true })).toBeVisible({
        timeout: 20_000,
      })
      return Date.now() - t0
    }

    await dismissOverlays(clientPage)
    await dismissOverlays(masterPage)

    // Cold-start: first send→peer visibility right after thread open (polls not warmed).
    const coldMs = await measureDelivery('cold')

    // Let React Query settle one poll interval before steady samples.
    await clientPage.waitForTimeout(1800)
    await masterPage.waitForTimeout(200)

    const steadySamples: number[] = []
    for (let i = 0; i < steadyRounds; i++) {
      steadySamples.push(await measureDelivery(`steady-${i}`))
    }
    const sorted = [...steadySamples].sort((a, b) => a - b)
    const medianMs = sorted[Math.floor(sorted.length / 2)] ?? 0
    const maxMs = sorted[sorted.length - 1] ?? 0
    const minMs = sorted[0] ?? 0

    const msgs = [
      `ping-a ${stamp} emoji 🙂`,
      `ping-b ${stamp}\nвторая строка`,
      `ping-c ${stamp} ${'оченьдлинноесловобезпробелов'.repeat(4)}`,
    ]
    for (const body of msgs) {
      await clientPage.getByTestId('message-composer').fill(body)
      await clientPage.getByTestId('send-message').click({ force: true })
      await expect(clientPage.getByTestId('message-history').getByText(body, { exact: true })).toBeVisible({ timeout: 10_000 })
    }
    for (const body of msgs) {
      await expect(masterPage.getByTestId('message-history').getByText(body, { exact: true })).toBeVisible({ timeout: 12_000 })
    }

    const reply = `ack ${stamp}`
    await masterPage.getByTestId('message-composer').fill(reply)
    await masterPage.getByTestId('send-message').click({ force: true })
    await expect(clientPage.getByTestId('message-history').getByText(reply, { exact: true })).toBeVisible({ timeout: 12_000 })

    const masterTexts = await masterPage.getByTestId('message-history').locator('.chat-bubble-text').allTextContents()
    const idx = msgs.map((m) => masterTexts.findIndex((t) => t === m))
    expect(idx.every((i) => i >= 0)).toBeTruthy()
    expect(idx[0]).toBeLessThan(idx[1])
    expect(idx[1]).toBeLessThan(idx[2])

    await clientPage.goto('/appointments')
    await dismissOverlays(clientPage)
    const offline = `while-away ${stamp}`
    await masterPage.getByTestId('message-composer').fill(offline)
    await masterPage.getByTestId('send-message').click({ force: true })
    await expect(masterPage.getByTestId('message-history').getByText(offline, { exact: true })).toBeVisible({ timeout: 10_000 })
    await clientPage.goto(threadUrl)
    await dismissOverlays(clientPage)
    await expect(clientPage.getByTestId('message-history').getByText(offline, { exact: true })).toBeVisible({ timeout: 12_000 })

    await clientPage.context().setOffline(true)
    await clientPage.context().setOffline(false)
    await clientPage.evaluate(() => window.dispatchEvent(new Event('online')))
    await clientPage.waitForTimeout(2000)
    expect(await clientPage.getByTestId('message-history').getByText(offline, { exact: true }).count()).toBe(1)

    await clientPage.reload()
    await dismissOverlays(clientPage)
    await expect(clientPage.getByTestId('message-history').getByText(msgs[0], { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(clientPage.getByTestId('message-history').getByText(offline, { exact: true })).toBeVisible()
    expect(await clientPage.getByTestId('message-history').getByText(offline, { exact: true }).count()).toBe(1)

    // Machine-readable latency block for scripts/test-docker.ps1
    console.log(
      `[messenger-e2e-latency] ${JSON.stringify({
        viewport: info.project.name,
        coldMs,
        steadySamples,
        medianMs,
        maxMs,
        minMs,
        pollVisibleMs: 1500,
        note: 'send-click → peer bubble visible; includes POST + poll',
      })}`,
    )
    expect(coldMs, `cold delivery ${coldMs}ms`).toBeLessThan(20_000)
    expect(maxMs, `steady max ${maxMs}ms`).toBeLessThan(20_000)

    await clientCtx.close()
    await masterCtx.close()
  })
})
