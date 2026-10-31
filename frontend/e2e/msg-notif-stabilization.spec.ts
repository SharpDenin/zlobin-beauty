import { test, expect, type Page } from '@playwright/test'

const api = process.env.VITE_API_BASE_URL ?? 'http://localhost:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'
const WIDTHS = [360, 390, 768, 1024, 1440] as const
const PROFESSION = '11111111-1111-4111-8111-111111111003'

async function apiHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${api}/healthz`, { signal: AbortSignal.timeout(4000) })
    return res.ok
  } catch {
    return false
  }
}

async function login(email: string) {
  const res = await fetch(`${api}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`login ${email} ${res.status}`)
  return res.json() as Promise<{ access_token: string; user: { id: string; display_name: string } }>
}

async function loginUI(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

async function registerMaster(displayName: string, published = false) {
  const email = `stab.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@test.local`
  const reg = await fetch(`${api}/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, display_name: displayName, as_master: true }),
  })
  if (!reg.ok) throw new Error(`register ${await reg.text()}`)
  const body = await reg.json() as { access_token: string; user: { id: string } }
  const put = await fetch(`${api}/v1/me/master`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${body.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      display_name: displayName,
      city: 'Москва',
      work_type: 'private_practice',
      work_types: ['private_practice'],
      published,
      profession_type_ids: [PROFESSION],
    }),
  })
  if (!put.ok) throw new Error(`master profile ${await put.text()}`)
  return { ...body, email, displayName }
}

async function createNotification(userId: string, title: string, entityType: string, entityId: string | null) {
  // Gateway does not expose /v1/internal/* — seed directly into communications DB.
  const { execSync } = await import('node:child_process')
  const id = crypto.randomUUID()
  const eid = entityId ? `'${entityId}'::uuid` : 'NULL'
  const safeTitle = title.replace(/'/g, "''")
  const sql = `INSERT INTO notifications(id,user_id,type,title,body,entity_type,entity_id,created_at) VALUES ('${id}'::uuid,'${userId}'::uuid,'info','${safeTitle}','body ${safeTitle}','${entityType}',${eid},now());`
  const repoRoot = process.cwd().endsWith('frontend') ? `${process.cwd()}/..` : process.cwd()
  execSync(`docker compose exec -T postgres psql -U communications -d communications -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`, {
    cwd: repoRoot,
    stdio: 'pipe',
    shell: true,
  })
}

test.describe('MSG-03 concurrent rate limits', () => {
  test('parallel conversation creates respect 10/hour and reopen is free', async ({}, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) test.skip(true, 'API down')

    const email = `rl.client.${Date.now()}@test.local`
    const reg = await fetch(`${api}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name: 'RL Concurrent Client' }),
    })
    expect(reg.ok).toBeTruthy()
    const client = await reg.json() as { access_token: string; user: { id: string } }
    const token = client.access_token

    const masters = await Promise.all(
      Array.from({ length: 16 }, (_, i) => registerMaster(`RL Peer ${Date.now()}-${i}`)),
    )

    const results = await Promise.all(
      masters.map(async (m) => {
        const res = await fetch(`${api}/v1/conversations`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'client_master', master_user_id: m.user.id }),
        })
        const retry = res.headers.get('Retry-After')
        const body = await res.json().catch(() => ({})) as { id?: string; error?: { code?: string } }
        return { status: res.status, retry, id: body.id, code: body.error?.code }
      }),
    )

    const ok = results.filter((r) => r.status === 201 || r.status === 200)
    const limited = results.filter((r) => r.status === 429)
    expect(ok.length).toBeLessThanOrEqual(10)
    expect(ok.length).toBeGreaterThan(0)
    expect(limited.length).toBeGreaterThan(0)
    for (const r of limited) {
      expect(r.code).toBe('rate_limited')
      expect(Number(r.retry)).toBeGreaterThan(0)
    }
    const uniqueIds = new Set(ok.map((r) => r.id).filter(Boolean))
    expect(uniqueIds.size).toBe(ok.length)

    // Reopen first successful dialog must not 429.
    const firstMaster = masters[results.findIndex((r) => r.status === 201 || r.status === 200)]
    const reopen = await fetch(`${api}/v1/conversations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client_master', master_user_id: firstMaster.user.id }),
    })
    expect(reopen.status).toBeLessThan(300)
  })

  test('parallel first messages respect 5/10min; established chat still works', async ({}, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) test.skip(true, 'API down')

    const email = `fm.client.${Date.now()}@test.local`
    const reg = await fetch(`${api}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name: 'FM Concurrent Client' }),
    })
    const client = await reg.json() as { access_token: string }
    const token = client.access_token

    const masters = await Promise.all(Array.from({ length: 8 }, (_, i) => registerMaster(`FM Peer ${Date.now()}-${i}`)))
    const convs = []
    for (const m of masters) {
      const res = await fetch(`${api}/v1/conversations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client_master', master_user_id: m.user.id }),
      })
      expect(res.ok).toBeTruthy()
      convs.push(await res.json() as { id: string })
    }

    const firstWave = await Promise.all(
      convs.map(async (c) => {
        const res = await fetch(`${api}/v1/conversations/${c.id}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: `hello ${c.id.slice(0, 8)}` }),
        })
        return { status: res.status, code: (await res.json().catch(() => ({})) as { error?: { code?: string } }).error?.code }
      }),
    )
    const ok = firstWave.filter((r) => r.status === 201 || r.status === 200)
    const limited = firstWave.filter((r) => r.status === 429)
    expect(ok.length).toBeLessThanOrEqual(5)
    expect(ok.length).toBe(5)
    expect(limited.length).toBeGreaterThan(0)
    for (const r of limited) expect(r.code).toBe('rate_limited')

    const establishedIdx = firstWave.findIndex((r) => r.status === 201 || r.status === 200)
    const follow = await fetch(`${api}/v1/conversations/${convs[establishedIdx].id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'follow-up in established' }),
    })
    expect(follow.status).toBeLessThan(300)
  })
})

test.describe('MSG-02 search beyond recent page', () => {
  test('finds peer by name with type+unread and denies strangers', async ({}, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) test.skip(true, 'API down')

    const email = `search.client.${Date.now()}@test.local`
    const reg = await fetch(`${api}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name: 'Search Client' }),
    })
    const client = await reg.json() as { access_token: string; user: { id: string } }
    const token = client.access_token
    const clientId = client.user.id
    const marker = `ЗевсПоиск${Date.now().toString().slice(-6)}`
    const deep = await registerMaster(marker)
    const target = await fetch(`${api}/v1/conversations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client_master', master_user_id: deep.user.id }),
    })
    const conv = await target.json() as { id: string }
    expect(target.ok).toBeTruthy()

    // Seed >500 newer conversations so a former 500-cap skim would miss the aged target.
    const { execSync } = await import('node:child_process')
    const repoRoot = process.cwd().endsWith('frontend') ? `${process.cwd()}/..` : process.cwd()
    const seedSQL = `DO $$ DECLARE i int; cid uuid; pid uuid; BEGIN FOR i IN 1..510 LOOP cid := gen_random_uuid(); pid := gen_random_uuid(); INSERT INTO conversations(id,type,context_key,context_type,created_at,updated_at) VALUES (cid,'client_master','seed_'||cid::text,'seed', now(), now() + (i || ' seconds')::interval); INSERT INTO conversation_participants(conversation_id,user_id,participant_role,joined_at) VALUES (cid,'${clientId}'::uuid,'client',now()), (cid,pid,'master',now()); END LOOP; UPDATE conversations SET updated_at = now() - interval '1 day' WHERE id='${conv.id}'::uuid; END $$;`
    execSync(`docker compose exec -T postgres psql -U communications -d communications -v ON_ERROR_STOP=1 -c ${JSON.stringify(seedSQL)}`, {
      cwd: repoRoot,
      stdio: 'pipe',
      shell: true,
    })

    // Make it unread for the client by sending as master.
    const masterLogin = await fetch(`${api}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: deep.email, password }),
    })
    const mTok = (await masterLogin.json() as { access_token: string }).access_token
    await fetch(`${api}/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mTok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'ping unread' }),
    })

    const found = await fetch(
      `${api}/v1/conversations?q=${encodeURIComponent(marker)}&type=client_master&unread=1&limit=20`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const body = await found.json() as { items: Array<{ id: string; peer_name: string }> }
    expect(found.ok).toBeTruthy()
    expect(body.items.some((i) => i.id === conv.id && i.peer_name.includes('ЗевсПоиск'))).toBeTruthy()

    const empty = await fetch(`${api}/v1/conversations?q=неттакогоимениxyz&limit=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect((await empty.json() as { items: unknown[] }).items).toEqual([])

    const stranger = await login('client1@demo.local')
    const leak = await fetch(
      `${api}/v1/conversations?q=${encodeURIComponent(marker)}&limit=20`,
      { headers: { Authorization: `Bearer ${stranger.access_token}` } },
    )
    const leakBody = await leak.json() as { items: Array<{ id: string }> }
    expect(leakBody.items.some((i) => i.id === conv.id)).toBeFalsy()
  })
})

test.describe('NOTIF-02 E2E bubbles hide/delete/nav', () => {
  test('bubble open, hide stays in feed, delete removes, stale target fallback', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) test.skip(true, 'API down')

    const session = await login('client1@demo.local')
    const title = `Bubble E2E ${Date.now()}`
    const staleTitle = `Stale E2E ${Date.now()}`
    await createNotification(session.user.id, title, 'appointment', '00000000-0000-4000-8000-000000000099')
    await createNotification(session.user.id, staleTitle, 'unknown_thing', null)

    await loginUI(page, 'client1@demo.local')
    await page.goto('/')
    await expect(page.getByTestId('notification-bubbles')).toBeVisible({ timeout: 20_000 })
    const bubble = page.getByTestId('notification-bubbles').locator('article').filter({ hasText: title }).first()
    await expect(bubble).toBeVisible()

    await bubble.getByRole('link').click()
    await expect(page).toHaveURL(/\/(appointments\/|notifications)/, { timeout: 15_000 })
    await page.goBack()
    await expect(page.getByTestId('owner-start-page').or(page.getByTestId('dashboard-page')).or(page.locator('main'))).toBeVisible()

    await page.goto('/')
    await expect(page.getByTestId('notification-bubbles')).toBeVisible({ timeout: 20_000 })
    const bubble2 = page.getByTestId('notification-bubbles').locator('article').filter({ hasText: title }).first()
    await bubble2.getByLabel('Скрыть уведомление').click()
    await expect(page.getByTestId('notification-bubbles').locator('article').filter({ hasText: title })).toHaveCount(0, {
      timeout: 10_000,
    })

    await page.goto('/notifications')
    const feedItem = page.locator('main article').filter({ hasText: title }).first()
    await expect(feedItem).toBeVisible({ timeout: 15_000 })

    const notes = await fetch(`${api}/v1/notifications`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const items = (await notes.json() as { items: Array<{ id: string; title: string; read_at: string | null; hidden_at?: string | null }> }).items
    const row = items.find((n) => n.title === title)
    expect(row).toBeTruthy()
    expect(row!.hidden_at).toBeTruthy()

    await feedItem.getByRole('button', { name: 'Удалить' }).click()
    await expect(page.locator('main article').filter({ hasText: title })).toHaveCount(0, { timeout: 10_000 })

    const after = await fetch(`${api}/v1/notifications`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const afterItems = (await after.json() as { items: Array<{ title: string }> }).items
    expect(afterItems.some((n) => n.title === title)).toBeFalsy()

    await page.goto('/')
    const stale = page.getByTestId('notification-bubbles').locator('article').filter({ hasText: staleTitle }).first()
    if (await stale.count()) {
      await stale.getByRole('link').click()
      await expect(page).toHaveURL(/\/notifications/, { timeout: 15_000 })
      await expect(page.locator('body')).not.toContainText('Something went wrong')
    }
  })
})

test.describe('adaptive MSG/NOTIF surfaces', () => {
  for (const width of WIDTHS) {
    test(`width ${width}: messenger filters + homes + notifications`, async ({ page }, info) => {
      const project = info.project.name
      const mapped =
        (width === 360 && project === 'phone-360') ||
        (width === 390 && project === 'phone-390') ||
        (width === 768 && project === 'tablet-768') ||
        (width === 1024 && project === 'laptop-1366') ||
        (width === 1440 && project === 'desktop-1920')
      test.skip(!mapped, 'one project per width')
      if (!(await apiHealthy())) test.skip(true, 'API down')

      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 })
      await loginUI(page, 'master1@demo.local')

      await page.goto('/messages')
      await expect(page.getByTestId('messenger-filters')).toBeVisible({ timeout: 20_000 })
      const search = page.getByPlaceholder('Поиск по имени')
      await expect(search).toBeVisible()
      const box = await search.boundingBox()
      expect(box && box.height >= 24).toBeTruthy()
      await page.getByRole('button', { name: 'Непрочитанные' }).click()

      await page.goto('/')
      await expect(page.getByTestId('owner-start-page').or(page.locator('main')).first()).toBeVisible()

      await page.goto('/dashboard')
      await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 20_000 })

      await page.goto('/notifications')
      await expect(page.getByRole('heading', { name: 'Уведомления' })).toBeVisible()
      const notifOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
      expect(notifOverflow).toBe(false)

      await page.goto('/messages')
      const msgOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
      expect(msgOverflow).toBe(false)

      // Supplier + admin homes (best-effort if role allows)
      await page.goto('/supplier')
      await page.goto('/admin')
    })
  }
})

test.describe('identity status dependency', () => {
  test('missing and blocked users are rejected; active master allowed', async ({}, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) test.skip(true, 'API down')

    const client = await login('client1@demo.local')
    const missing = await fetch(`${api}/v1/conversations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client_master', master_user_id: '00000000-0000-4000-8000-000000000001' }),
    })
    expect([404, 403]).toContain(missing.status)

    const { execSync } = await import('node:child_process')
    const repoRoot = process.cwd().endsWith('frontend') ? `${process.cwd()}/..` : process.cwd()
    const blockedId = execSync(
      'docker compose exec -T postgres psql -U identity -d identity -tAc "SELECT id FROM users WHERE status = \'blocked\' LIMIT 1"',
      { cwd: repoRoot, encoding: 'utf8', shell: true },
    ).trim()
    expect(blockedId).toMatch(/[0-9a-f-]{36}/i)
    const blocked = await fetch(`${api}/v1/conversations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client_master', master_user_id: blockedId }),
    })
    expect([403, 404]).toContain(blocked.status)

    const master = await login('master1@demo.local')
    const ok = await fetch(`${api}/v1/conversations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client_master', master_user_id: master.user.id }),
    })
    expect(ok.status).toBeLessThan(300)

    // Operational: communications must see status from live identity (not a stale local cache).
    const statusJSON = execSync(
      `docker compose exec -T communications wget -qO- --header=X-Internal-Token:dev-internal-token http://identity:8080/v1/internal/users/${master.user.id}`,
      { cwd: repoRoot, encoding: 'utf8' },
    )
    expect(JSON.parse(statusJSON).status).toBe('active')
  })
})
