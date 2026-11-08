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
  const body = await res.json()
  expect(res.ok, `login ${email}: ${JSON.stringify(body)}`).toBeTruthy()
  return body as { access_token: string; user: { id: string } }
}

async function loginUI(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

function tinyJpeg(): Buffer {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
    'base64',
  )
}

async function uploadHairPhoto(token: string) {
  const form = new FormData()
  form.append('purpose', 'hair_consultation')
  form.append('file', new Blob([tinyJpeg()], { type: 'image/jpeg' }), 'overview.jpg')
  const res = await fetch(`${api}/v1/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const body = await res.json()
  expect(res.ok, `media upload ${res.status} ${JSON.stringify(body)}`).toBeTruthy()
  return (body as { id: string }).id
}

type Card = {
  id: string
  user_id: string
  display_name?: string
  skin_type?: string
  skin_features?: string
  loyalty_status?: string
  general_notes?: string
  preferences?: string
  birth_date?: string | null
}

/** Ensure master1 has served client1 so ACL allows clinical PATCH (visit on card). */
async function ensureSharedCard(): Promise<{ master: Awaited<ReturnType<typeof apiLogin>>; client: Awaited<ReturnType<typeof apiLogin>>; card: Card }> {
  const master = await apiLogin('master1@demo.local')
  const client = await apiLogin('client1@demo.local')

  const mine = await fetch(`${api}/v1/clients/mine`, {
    headers: { Authorization: `Bearer ${master.access_token}` },
  })
  const mineText = await mine.text()
  expect(mine.ok, mineText).toBeTruthy()
  const list = JSON.parse(mineText) as { items: Card[] }
  let card = list.items?.find((c) => c.user_id === client.user.id)

  if (!card) {
    const profile = await fetch(`${api}/v1/me/master`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(profile.ok, await profile.text()).toBeTruthy()
    const prof = (await profile.json()) as {
      master?: { id: string }
      services?: Array<{ id: string; name: string; duration_minutes?: number }>
    }
    const service = (prof.services ?? [])[0]
    expect(service?.id, 'master1 needs at least one service').toBeTruthy()

    let slotStarts: string | undefined
    for (let d = 1; d <= 14 && !slotStarts; d++) {
      const day = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)
      const slotsRes = await fetch(
        `${api}/v1/masters/${master.user.id}/slots?date=${day}&duration_minutes=${service!.duration_minutes ?? 60}`,
      )
      if (!slotsRes.ok) continue
      const slots = (await slotsRes.json()) as { items?: Array<{ starts_at: string }> }
      slotStarts = slots.items?.[0]?.starts_at
    }
    expect(slotStarts, 'no free slot for master1').toBeTruthy()

    const create = await fetch(`${api}/v1/appointments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        master_id: prof.master!.id,
        service_id: service!.id,
        starts_at: slotStarts,
      }),
    })
    expect(create.ok, await create.text()).toBeTruthy()
    const appt = (await create.json()) as { id: string; status: string }
    if (appt.status === 'pending_confirmation' || appt.status === 'pending') {
      const conf = await fetch(`${api}/v1/appointments/${appt.id}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${master.access_token}` },
      })
      expect(conf.ok, await conf.text()).toBeTruthy()
    }
    const started = await fetch(`${api}/v1/appointments/${appt.id}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(started.ok, await started.text()).toBeTruthy()

    const byAppt = await fetch(`${api}/v1/clients/appointment/${appt.id}`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(byAppt.ok, await byAppt.text()).toBeTruthy()
    card = (await byAppt.json()) as Card
  }

  expect(card?.id).toBeTruthy()
  expect(card!.user_id).toBe(client.user.id)
  return { master, client, card: card! }
}

test.describe('client card master↔client sync + ACL + diagnostics pricing', () => {
  test.beforeEach(async () => {
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
  })

  test('dual-session UI sync after master PATCH (phone + desktop)', async ({ page, browser }, info) => {
    test.skip(
      info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280',
      'phone-390 and desktop-1280 only',
    )

    const { master, client, card } = await ensureSharedCard()
    const marker = `E2E-SYNC-${Date.now()}`
    const skinType = 'комбинированная'
    const skinFeatures = `поры ${marker}`
    const notes = `Реакция на ретинол — ${marker}`
    const loyalty = 'loyal'
    const birth = '1993-06-12'
    const prefs = `предпочтения ${marker}`

    // Master edits via real PATCH (canonical SoT).
    const patch = await fetch(`${api}/v1/clients/id/${card.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${master.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        skin_type: skinType,
        skin_features: skinFeatures,
        loyalty_status: loyalty,
        general_notes: notes,
        birth_date: birth,
        preferences: prefs,
      }),
    })
    const patched = (await patch.json()) as Card
    expect(patch.ok, JSON.stringify(patched)).toBeTruthy()
    expect(patched.skin_type).toBe(skinType)
    expect(patched.general_notes).toContain(marker)
    expect(patched.id).toBe(card.id)

    // Master UI — refetch after PATCH (invalidate / network).
    await loginUI(page, 'master1@demo.local')
    const masterGet = page.waitForResponse(
      (r) => r.url().includes(`/v1/clients/id/${card.id}`) && r.request().method() === 'GET' && r.ok(),
    )
    await page.goto(`/clients/${card.id}`)
    await masterGet
    await expect(page.getByTestId('client-card-page')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('client-card-role')).toHaveText('Мастер')
    await expect(page.getByTestId('client-skin-section')).toContainText(skinType)
    await expect(page.getByTestId('client-skin-section')).toContainText(marker)
    await expect(page.getByTestId('client-loyalty')).toContainText('Постоянный')
    await expect(page.getByTestId('client-general-notes')).toContainText(marker)
    await expect(page.getByTestId('client-preferences')).toContainText(marker)

    // Independent client session (separate browser context) — same card id, same SoT.
    const clientCtx = await browser.newContext({
      viewport: page.viewportSize() ?? { width: 390, height: 844 },
    })
    const clientPage = await clientCtx.newPage()
    await loginUI(clientPage, 'client1@demo.local')
    const clientGet = clientPage.waitForResponse(
      (r) => r.url().includes(`/v1/clients/id/${card.id}`) && r.request().method() === 'GET' && r.ok(),
    )
    await clientPage.goto(`/clients/${card.id}`)
    await clientGet
    await expect(clientPage.getByTestId('client-card-page')).toBeVisible({ timeout: 15_000 })
    await expect(clientPage.getByTestId('client-card-role')).toHaveText('Клиент')
    await expect(clientPage.getByTestId('client-skin-section')).toContainText(skinType)
    await expect(clientPage.getByTestId('client-skin-section')).toContainText(marker)
    await expect(clientPage.getByTestId('client-loyalty')).toContainText('Постоянный')
    await expect(clientPage.getByTestId('client-general-notes')).toContainText(marker)
    await expect(clientPage.getByTestId('client-preferences')).toContainText(marker)
    // Client must not get clinical edit controls.
    await expect(clientPage.getByTestId('edit-skin-type')).toHaveCount(0)

    // Reload both — persistence.
    await page.reload()
    await expect(page.getByTestId('client-general-notes')).toContainText(marker, { timeout: 15_000 })
    await clientPage.reload()
    await expect(clientPage.getByTestId('client-general-notes')).toContainText(marker, { timeout: 15_000 })

    // Client-owned personal field update must land on the same card (no fork).
    const clientPatch = await fetch(`${api}/v1/clients/id/${card.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${client.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ preferences: `client-side ${marker}` }),
    })
    const clientPatched = (await clientPatch.json()) as Card
    expect(clientPatch.ok, JSON.stringify(clientPatched)).toBeTruthy()
    expect(clientPatched.id).toBe(card.id)
    expect(clientPatched.skin_type).toBe(skinType)

    await page.reload()
    await expect(page.getByTestId('client-preferences')).toContainText(`client-side ${marker}`, {
      timeout: 15_000,
    })
    await expect(page.getByTestId('client-skin-section')).toContainText(skinType)

    await clientCtx.close()
  })

  test('ACL: client cannot patch clinical; stranger master forbidden; assigned master ok', async ({}, info) => {
    test.skip(info.project.name !== 'phone-390', 'API ACL once')
    const { master, client, card } = await ensureSharedCard()
    const stranger = await apiLogin('master2@demo.local')

    const clientClinical = await fetch(`${api}/v1/clients/id/${card.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${client.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ skin_type: 'hack', general_notes: 'nope', loyalty_status: 'vip' }),
    })
    expect(clientClinical.status).toBe(403)

    const strangerPatch = await fetch(`${api}/v1/clients/id/${card.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${stranger.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ skin_type: 'hack' }),
    })
    expect([403, 404]).toContain(strangerPatch.status)

    const strangerGet = await fetch(`${api}/v1/clients/id/${card.id}`, {
      headers: { Authorization: `Bearer ${stranger.access_token}` },
    })
    expect([403, 404]).toContain(strangerGet.status)

    const ok = await fetch(`${api}/v1/clients/id/${card.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${master.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ skin_type: 'нормальная', general_notes: 'ACL master ok' }),
    })
    expect(ok.ok, await ok.text()).toBeTruthy()
  })

  test('diagnostics price_total_minor is server-normalized from catalog', async ({}, info) => {
    test.skip(info.project.name !== 'phone-390', 'API pricing once')
    const client = await apiLogin('client1@demo.local')
    const master = await apiLogin('master1@demo.local')

    const meMaster = await fetch(`${api}/v1/me/master`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    const meMasterText = await meMaster.text()
    expect(meMaster.ok, meMasterText).toBeTruthy()
    const prof = JSON.parse(meMasterText) as {
      master?: { organization_id?: string }
      services?: Array<{ id: string; price_minor: number; name: string }>
    }
    const services = (prof.services ?? []).filter((s) => typeof s.price_minor === 'number')
    expect(services.length, 'master1 needs catalog services').toBeGreaterThan(0)
    const picked = services.slice(0, Math.min(2, services.length))
    const expectedTotal = picked.reduce((sum, s) => sum + s.price_minor, 0)

    const created = await fetch(`${api}/v1/hair-consultations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        master_user_id: master.user.id,
        organization_id: prof.master?.organization_id,
      }),
    })
    const createdBody = await created.json()
    expect(created.ok, JSON.stringify(createdBody)).toBeTruthy()
    const id = (createdBody as { id: string }).id

    const q = await fetch(`${api}/v1/hair-consultations/${id}/questionnaire`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${client.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        questionnaire: { hair_type: 'colored', desired_result: 'Пепельный блонд', salon_coloring: true },
      }),
    })
    expect(q.ok, await q.text()).toBeTruthy()

    const mediaId = await uploadHairPhoto(client.access_token)
    const attach = await fetch(`${api}/v1/hair-consultations/${id}/media`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ media_id: mediaId, slot: 'overview' }),
    })
    expect(attach.ok, await attach.text()).toBeTruthy()

    const submit = await fetch(`${api}/v1/hair-consultations/${id}/submit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.access_token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    expect(submit.ok, await submit.text()).toBeTruthy()

    const start = await fetch(`${api}/v1/hair-consultations/${id}/start`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${master.access_token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    expect(start.ok, await start.text()).toBeTruthy()

    const spoof = 1
    const plan = await fetch(`${api}/v1/hair-consultations/${id}/plan`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${master.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan: {
          desired_result: 'Холодный блонд',
          technique: 'airtouch',
          formula: '9.1 + 9.2',
          selected_service_ids: picked.map((s) => s.id),
          price_total_minor: spoof,
        },
      }),
    })
    const planBody = await plan.json()
    expect(plan.ok, JSON.stringify(planBody)).toBeTruthy()
    const savedPlan = (
      planBody as { current_version: { plan: { price_total_minor: number; selected_service_ids: string[] } } }
    ).current_version.plan
    expect(savedPlan.price_total_minor).toBe(expectedTotal)
    expect(savedPlan.price_total_minor).not.toBe(spoof)
    expect(savedPlan.selected_service_ids).toEqual(picked.map((s) => s.id))

    const reopen = await fetch(`${api}/v1/hair-consultations/${id}`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const reopened = await reopen.json()
    expect(reopen.ok).toBeTruthy()
    expect(
      (reopened as { current_version: { plan: { price_total_minor: number } } }).current_version.plan
        .price_total_minor,
    ).toBe(expectedTotal)
  })

  test('diagnostics detail shows client params and master extras (desktop)', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1280', 'desktop sample')
    await loginUI(page, 'client1@demo.local')
    await page.goto('/consultations')
    await expect(page.getByTestId('hair-consultations-page')).toBeVisible({ timeout: 15_000 })
    const first = page.locator('[data-testid^="consult-item-"]').first()
    if (await first.count()) {
      await first.click()
      await expect(page.getByTestId('hair-consultation-detail')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('consult-questionnaire')).toBeVisible()
      await expect(page.getByTestId('consult-price')).toBeVisible()
      await expect(page.getByTestId('consult-role-badge')).toHaveText('Клиент')
    } else {
      await expect(page.getByTestId('consult-create')).toBeVisible()
    }
  })
})
