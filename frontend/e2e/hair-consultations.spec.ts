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

async function requireApi() {
  if (!(await apiHealthy())) {
    test.skip(true, `API unhealthy at ${api}`)
  }
}

async function apiLogin(email: string) {
  const res = await fetch(`${api}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  expect(res.ok, `login ${email} → ${res.status} ${JSON.stringify(body)}`).toBeTruthy()
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

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { res, body, text }
}

// API flow once (viewport projects would multiply otherwise).
test.describe('DIAG hair consultations API', () => {
  test.describe.configure({ mode: 'serial' })

  test('create → submit → start → send → approve + ACL/immutability', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-360', 'API once')
    await requireApi()
    const client = await apiLogin('client1@demo.local')
    const master = await apiLogin('master1@demo.local')

    const created = await jsonFetch(`${api}/v1/hair-consultations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ master_user_id: master.user.id }),
    })
    expect(created.res.status, created.text).toBe(201)
    const id = (created.body as { id: string; status: string }).id
    expect((created.body as { status: string }).status).toBe('draft')

    const patchQ = await jsonFetch(`${api}/v1/hair-consultations/${id}/questionnaire`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionnaire: { hair_type: 'colored', desired_result: 'Холодный блонд', salon_coloring: true },
      }),
    })
    expect(patchQ.res.ok, patchQ.text).toBeTruthy()

    const mediaId = await uploadHairPhoto(client.access_token)
    const attach = await jsonFetch(`${api}/v1/hair-consultations/${id}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_id: mediaId, slot: 'overview' }),
    })
    expect(attach.res.ok, attach.text).toBeTruthy()

    const submit = await jsonFetch(`${api}/v1/hair-consultations/${id}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(submit.res.ok, submit.text).toBeTruthy()
    expect((submit.body as { status: string }).status).toBe('awaiting_master')

    const badSubmit = await jsonFetch(`${api}/v1/hair-consultations/${id}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(badSubmit.res.status).toBe(403)

    const start = await jsonFetch(`${api}/v1/hair-consultations/${id}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(start.res.ok, start.text).toBeTruthy()

    const assessment = await jsonFetch(`${api}/v1/hair-consultations/${id}/assessment`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ assessment: { natural_level_roots: '6', gray_percent: '10', porosity_roots: 'medium' } }),
    })
    expect(assessment.res.ok, assessment.text).toBeTruthy()

    const plan = await jsonFetch(`${api}/v1/hair-consultations/${id}/plan`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: {
          desired_result: 'Холодный блонд',
          technique: 'airtouch',
          formula: '9.1 + 9.2 1:1 ox 6%',
          brand_line: 'Demo Color',
          strand_test: 'по инструкции бренда',
          allergy_test: 'отдельно, по инструкции',
        },
      }),
    })
    expect(plan.res.ok, plan.text).toBeTruthy()

    const conv = await jsonFetch(`${api}/v1/conversations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client_master', client_user_id: client.user.id }),
    })
    expect(conv.res.ok, conv.text).toBeTruthy()
    const conversationId = (conv.body as { id: string }).id

    const send = await jsonFetch(`${api}/v1/hair-consultations/${id}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId }),
    })
    expect(send.res.ok, send.text).toBeTruthy()
    expect((send.body as { status: string }).status).toBe('awaiting_client')

    const send2 = await jsonFetch(`${api}/v1/hair-consultations/${id}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId }),
    })
    expect(send2.res.ok, send2.text).toBeTruthy()

    const view = await jsonFetch(`${api}/v1/hair-consultations/${id}`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const viewed = view.body as {
      current_version: { plan: { formula: string }; status: string }
      conversation_id: string
    }
    expect(viewed.current_version.plan.formula).toContain('9.1')
    expect(viewed.conversation_id).toBe(conversationId)

    const approve = await jsonFetch(`${api}/v1/hair-consultations/${id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(approve.res.ok, approve.text).toBeTruthy()
    const approved = approve.body as {
      status: string
      current_version: { status: string; immutable_at: string | null }
    }
    expect(approved.status).toBe('approved')
    expect(approved.current_version.status).toBe('approved')
    expect(approved.current_version.immutable_at).toBeTruthy()

    const badPatch = await jsonFetch(`${api}/v1/hair-consultations/${id}/plan`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: { formula: 'hack' } }),
    })
    expect(badPatch.res.status).toBe(409)
  })

  test('return with comment creates new version', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-360', 'API once')
    await requireApi()
    const client = await apiLogin('client2@demo.local')
    const master = await apiLogin('master2@demo.local')

    const created = await jsonFetch(`${api}/v1/hair-consultations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ master_user_id: master.user.id }),
    })
    const id = (created.body as { id: string }).id

    await jsonFetch(`${api}/v1/hair-consultations/${id}/questionnaire`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionnaire: { hair_type: 'natural', desired_result: 'мягкий каштан' } }),
    })
    const mediaId = await uploadHairPhoto(client.access_token)
    await jsonFetch(`${api}/v1/hair-consultations/${id}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_id: mediaId, slot: 'overview' }),
    })
    await jsonFetch(`${api}/v1/hair-consultations/${id}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    await jsonFetch(`${api}/v1/hair-consultations/${id}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    await jsonFetch(`${api}/v1/hair-consultations/${id}/plan`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: { desired_result: 'каштан', technique: 'allover', formula: '5N' },
      }),
    })
    await jsonFetch(`${api}/v1/hair-consultations/${id}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })

    const ret = await jsonFetch(`${api}/v1/hair-consultations/${id}/request-changes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Хочу теплее на 1 тон' }),
    })
    expect(ret.res.ok, ret.text).toBeTruthy()
    const body = ret.body as {
      status: string
      versions: Array<{ version_no: number; status: string; client_comment: string }>
      current_version: { version_no: number; status: string }
    }
    expect(body.status).toBe('in_progress')
    expect(body.current_version.version_no).toBe(2)
    expect(body.current_version.status).toBe('draft')
    const v1 = body.versions.find((v) => v.version_no === 1)
    expect(v1?.status).toBe('changes_requested')
    expect(v1?.client_comment).toContain('теплее')
  })
})

test.describe('DIAG hair consultations UI', () => {
  test('client creates draft; adaptive widths; master list', async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-360', 'UI once + internal viewport loop')
    await requireApi()
    const master = await apiLogin('master1@demo.local')

    await loginUI(page, 'client1@demo.local')
    await page.goto('/consultations')
    await expect(page.getByTestId('hair-consultations-page')).toBeVisible()
    await page.getByTestId('consult-master-id').fill(master.user.id)
    await page.getByTestId('consult-create-btn').click()
    await expect(page.getByTestId('hair-consultation-detail')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('q-hair-type').selectOption('colored')
    await page.getByTestId('q-desired').fill('Пепельный блонд')
    await page.getByTestId('consult-save-draft').click()
    await expect(page.locator('.ok-banner')).toContainText('Черновик анкеты сохранён', { timeout: 10_000 })

    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 800 })
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(scroll, `width ${width}`).toBeLessThanOrEqual(1)
    }

    const masterCtx = await browser.newContext()
    const masterPage = await masterCtx.newPage()
    await loginUI(masterPage, 'master1@demo.local')
    await masterPage.goto('/consultations')
    await expect(masterPage.getByTestId('hair-consultations-page')).toBeVisible()
    await masterCtx.close()
  })
})
