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

async function closeMoreDrawer(page: Page) {
  const close = page.getByRole('button', { name: 'Закрыть' })
  if (await close.isVisible().catch(() => false)) await close.click()
}

async function pickBookableSlot(page: Page, masterUserId: string, duration: number) {
  if (await page.locator('#date').count() === 0) {
    await page.getByRole('button', { name: 'Назад' }).click()
  }
  for (let d = 1; d <= 28; d++) {
    const day = new Date(Date.now() + d * 86400000)
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue
    const date = day.toISOString().slice(0, 10)
    const slotsRes = await fetch(`${api}/v1/masters/${masterUserId}/slots?date=${date}&duration_minutes=${duration}`)
    if (!slotsRes.ok) continue
    const slots = await slotsRes.json() as { items?: Array<{ starts_at: string }> }
    if (!slots.items?.[0]?.starts_at) continue
    await expect(page.locator('#date')).toBeVisible({ timeout: 10_000 })
    await page.locator('#date').fill(date)
    await page.getByRole('button', { name: 'К времени' }).click()
    const slot = page.locator('.slot:not(.empty)').first()
    await expect(slot).toBeVisible({ timeout: 15_000 })
    await slot.click()
    return
  }
  throw new Error('no UI bookable slot')
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

async function clearClientCart(token: string) {
  const cart = await fetch(`${api}/v1/commerce/shop/cart`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!cart.ok) return
  const data = await cart.json() as { items?: Array<{ product_id: string }> }
  for (const it of data.items ?? []) {
    await fetch(`${api}/v1/commerce/shop/cart/items/${it.product_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
  }
}
async function shopProductInStock(token: string, opts?: { skuPrefix?: string; excludeRace?: boolean }) {
  const res = await fetch(`${api}/v1/commerce/shop/products?limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.ok).toBeTruthy()
  const { items } = await res.json() as { items?: Array<{ id: string; sku?: string; available?: number }> }
  return (items ?? []).find((p) => {
    if ((p.available ?? 0) <= 0) return false
    if (opts?.excludeRace !== false && p.sku?.includes('RACE')) return false
    if (opts?.skuPrefix && !p.sku?.startsWith(opts.skuPrefix)) return false
    return true
  })
}

async function salonPickupBranchId(masterToken: string) {
  const orgsRes = await fetch(`${api}/v1/organizations/mine`, {
    headers: { Authorization: `Bearer ${masterToken}` },
  })
  expect(orgsRes.ok).toBeTruthy()
  const orgs = await orgsRes.json() as { items?: Array<{ organization: { type: string }; branches?: Array<{ id: string; pickup_enabled?: boolean }> }> }
  const salon = (orgs.items ?? []).find((i) => i.organization.type !== 'supplier')
  const branch = salon?.branches?.find((b) => b.pickup_enabled !== false) ?? salon?.branches?.[0]
  expect(branch?.id).toBeTruthy()
  return branch!.id
}

const PLANNER_OCCUPY_STATUSES = new Set(['pending_confirmation', 'confirmed', 'in_progress'])

function krasnoyarskYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Krasnoyarsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd
}

function krasnoyarskWeekStartMs(d: Date): number {
  const ymd = krasnoyarskYmd(d)
  const [y, m, day] = ymd.split('-').map(Number)
  const utcMidnight = Date.UTC(y, m - 1, day)
  const daysFromMonday = (new Date(utcMidnight).getUTCDay() + 6) % 7
  return utcMidnight - daysFromMonday * 86400000
}

function listWeeksAhead(from: Date, target: Date): number {
  const delta = krasnoyarskWeekStartMs(target) - krasnoyarskWeekStartMs(from)
  return Math.max(0, Math.round(delta / (7 * 86400000)))
}

function waitForPlannerBlocksFetch(page: Page) {
  return page.waitForResponse(
    (res) => res.request().method() === 'GET' && res.url().includes('/v1/planner/blocks') && res.ok(),
    { timeout: 8_000 },
  ).catch(() => undefined)
}

async function openListWeekContaining(page: Page, when: Date) {
  const listReady = waitForPlannerBlocksFetch(page)
  await page.getByRole('button', { name: 'Список' }).click()
  await listReady
  await expect(page.locator('.fc-list-empty, .fc-list-event').first()).toBeVisible({ timeout: 15_000 })
  const weeks = listWeeksAhead(new Date(), when)
  for (let i = 0; i < weeks; i++) {
    const nextReady = waitForPlannerBlocksFetch(page)
    await page.getByRole('button', { name: 'След' }).click()
    await nextReady
    await expect(page.locator('.fc-list-empty, .fc-list-event').first()).toBeVisible({ timeout: 15_000 })
  }
}

/** Find a 60-minute interval inside working hours that does not overlap appointments or planner blocks. */
async function findFreePlannerSlot(token: string): Promise<{ start: Date; end: Date }> {
  const meRes = await fetch(`${api}/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
  expect(meRes.ok).toBeTruthy()
  const me = await meRes.json() as { id?: string; user?: { id?: string } }
  const masterId = me.id ?? me.user?.id
  expect(masterId).toBeTruthy()

  const hoursRes = await fetch(`${api}/v1/me/working-hours`, { headers: { Authorization: `Bearer ${token}` } })
  expect(hoursRes.ok).toBeTruthy()
  const hours = await hoursRes.json() as { items?: Array<{ weekday: number }> }
  expect((hours.items ?? []).length, 'working hours required').toBeGreaterThan(0)

  const windowFrom = new Date()
  windowFrom.setUTCHours(0, 0, 0, 0)
  const windowTo = new Date(windowFrom.getTime() + 21 * 86400000)
  const qs = `from=${encodeURIComponent(windowFrom.toISOString())}&to=${encodeURIComponent(windowTo.toISOString())}`
  const [blocksRes, apptsRes] = await Promise.all([
    fetch(`${api}/v1/planner/blocks?${qs}`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${api}/v1/appointments/mine?role=master&${qs}`, { headers: { Authorization: `Bearer ${token}` } }),
  ])
  expect(blocksRes.ok).toBeTruthy()
  expect(apptsRes.ok).toBeTruthy()
  const blocks = await blocksRes.json() as { items?: Array<{ starts_at: string; ends_at: string }> }
  const appts = await apptsRes.json() as { items?: Array<{ starts_at: string; ends_at: string; status?: string }> }
  const busy = [
    ...(blocks.items ?? []),
    ...(appts.items ?? []).filter((a) => PLANNER_OCCUPY_STATUSES.has(a.status ?? '')),
  ].map((x) => ({ start: new Date(x.starts_at).getTime(), end: new Date(x.ends_at).getTime() }))

  const durationMs = 60 * 60 * 1000
  for (let i = 0; i < 14; i++) {
    const date = krasnoyarskYmd(new Date(Date.now() + i * 86400000))
    const slotsRes = await fetch(`${api}/v1/masters/${masterId}/slots?date=${date}&duration_minutes=60`)
    if (!slotsRes.ok) continue
    const slots = await slotsRes.json() as { items?: Array<{ starts_at: string }> }
    for (const slot of slots.items ?? []) {
      const start = new Date(slot.starts_at)
      const end = new Date(start.getTime() + durationMs)
      const taken = busy.some((b) => intervalsOverlap(start.getTime(), end.getTime(), b.start, b.end))
      if (!taken) return { start, end }
    }
  }
  throw new Error('no free working-hours interval for planner block')
}

async function masterInProgressAppointment(token: string, masterUserId: string) {
  const res = await fetch(`${api}/v1/appointments/mine?role=master`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.ok).toBeTruthy()
  const data = await res.json() as { items?: Array<{ id: string; status: string; master_user_id: string; service_name?: string }> }
  return (data.items ?? []).find((a) => a.status === 'in_progress' && a.master_user_id === masterUserId)
}

async function ensurePhase4InProgress(masterEmail: string, clientEmail: string, serviceNameContains: string) {
  const master = await apiLogin(masterEmail)
  const client = await apiLogin(clientEmail)
  const me = await fetch(`${api}/v1/auth/me`, { headers: { Authorization: `Bearer ${master.access_token}` } })
  const body = await me.json() as { id?: string; user?: { id?: string } }
  const masterId = body.id ?? body.user?.id
  expect(masterId).toBeTruthy()
  const existing = await masterInProgressAppointment(master.access_token, masterId!)
  if (existing) return { master, masterId: masterId!, appt: existing }

  const profile = await fetch(`${api}/v1/me/master`, { headers: { Authorization: `Bearer ${master.access_token}` } })
  expect(profile.ok).toBeTruthy()
  const prof = await profile.json() as {
    master?: { id: string }
    services?: Array<{ id: string; name: string; duration_minutes?: number }>
  }
  const profileId = prof.master?.id
  expect(profileId).toBeTruthy()
  const service = (prof.services ?? []).find((s) => s.name.toLowerCase().includes(serviceNameContains.toLowerCase()))
  expect(service?.id).toBeTruthy()

  let slotStarts: string | undefined
  for (let d = 1; d <= 14 && !slotStarts; d++) {
    const day = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)
    const slotsRes = await fetch(`${api}/v1/masters/${masterId}/slots?date=${day}&duration_minutes=${service!.duration_minutes ?? 120}`)
    if (!slotsRes.ok) continue
    const slots = await slotsRes.json() as { items?: Array<{ starts_at: string }> }
    slotStarts = slots.items?.[0]?.starts_at
  }
  expect(slotStarts).toBeTruthy()

  const create = await fetch(`${api}/v1/appointments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ master_id: profileId, service_id: service!.id, starts_at: slotStarts }),
  })
  if (!create.ok) {
    const errBody = await create.text()
    throw new Error(`create appointment failed ${create.status}: ${errBody}`)
  }
  const appt = await create.json() as { id: string; status: string }
  if (appt.status === 'pending_confirmation' || appt.status === 'pending') {
    await fetch(`${api}/v1/appointments/${appt.id}/confirm`, { method: 'POST', headers: { Authorization: `Bearer ${master.access_token}` } })
  }
  await fetch(`${api}/v1/appointments/${appt.id}/start`, { method: 'POST', headers: { Authorization: `Bearer ${master.access_token}` } })
  const started = await masterInProgressAppointment(master.access_token, masterId!)
  expect(started?.id).toBeTruthy()
  return { master, masterId: masterId!, appt: started! }
}

async function fillColoringScheme(page: Page) {
  await expect(page.getByTestId('service-scheme-form')).toBeVisible({ timeout: 15_000 })
  await page.locator('#scheme-technique').fill('Балаяж E2E')
  await page.locator('#scheme-dye').fill('Majirel 7.1')
  await page.locator('#scheme-proportions').fill('1:1.5')
  await page.locator('#scheme-oxidizer').fill('6%')
  await page.locator('#scheme-product').fill('Majirel 7.1')
}

type AuthMe = { id?: string; user?: { id?: string } }
type AppointmentRow = { id: string; status: string; master_user_id: string; client_user_id?: string; service_name?: string }
type SchemeBody = {
  exists?: boolean
  skipped?: boolean
  omit_formula?: boolean
  details_redacted?: boolean
  formula_redacted?: boolean
  technique?: string
  notes?: string
  category_fields?: Record<string, unknown> | string
  components?: Array<{ name?: string }>
}

const PHASE2_FORMULA = {
  technique: 'Балаяж E2E',
  notes: 'phase2 omit_formula',
  skipped: false,
  omit_formula: true,
  category_fields: {
    technique: 'Балаяж E2E',
    dye: 'Majirel 7.1',
    proportions: '1:1.5',
    oxidizer: '6%',
  },
  components: [{ name: 'Majirel 7.1', qty: '30', unit: 'г', proportion: '1:1.5' }],
}

async function authUserId(token: string) {
  const res = await fetch(`${api}/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
  expect(res.ok).toBeTruthy()
  const body = await res.json() as AuthMe
  const id = body.id ?? body.user?.id
  expect(id).toBeTruthy()
  return id!
}

async function fetchScheme(token: string, appointmentId: string) {
  const res = await fetch(`${api}/v1/appointments/${appointmentId}/scheme`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const text = await res.text()
  let body: SchemeBody = {}
  try {
    body = JSON.parse(text) as SchemeBody
  } catch {
    body = {}
  }
  return { status: res.status, body, text }
}

function schemeCategoryFields(body: SchemeBody): Record<string, unknown> {
  const raw = body.category_fields
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch { /* ignore */ }
  }
  return {}
}

async function completeAppointmentApi(token: string, appointmentId: string, payload: Record<string, unknown>) {
  const res = await fetch(`${api}/v1/appointments/${appointmentId}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  expect(res.ok, text).toBeTruthy()
}

async function ensureInProgressForClient(masterEmail: string, clientEmail: string, serviceNameContains: string) {
  const master = await apiLogin(masterEmail)
  const client = await apiLogin(clientEmail)
  const masterId = await authUserId(master.access_token)
  const clientId = await authUserId(client.access_token)

  const list = await fetch(`${api}/v1/appointments/mine?role=master`, {
    headers: { Authorization: `Bearer ${master.access_token}` },
  })
  expect(list.ok).toBeTruthy()
  const data = await list.json() as { items?: AppointmentRow[] }
  const existing = (data.items ?? []).find(
    (a) => a.status === 'in_progress' && a.master_user_id === masterId && a.client_user_id === clientId,
  )
  if (existing) return { master, client, masterId, clientId, appt: existing }

  const profile = await fetch(`${api}/v1/me/master`, { headers: { Authorization: `Bearer ${master.access_token}` } })
  expect(profile.ok).toBeTruthy()
  const prof = await profile.json() as {
    master?: { id: string }
    services?: Array<{ id: string; name: string; duration_minutes?: number }>
  }
  const profileId = prof.master?.id
  expect(profileId).toBeTruthy()
  const service = (prof.services ?? []).find((s) => s.name.toLowerCase().includes(serviceNameContains.toLowerCase()))
  expect(service?.id).toBeTruthy()

  let slotStarts: string | undefined
  for (let d = 1; d <= 14 && !slotStarts; d++) {
    const day = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)
    const slotsRes = await fetch(`${api}/v1/masters/${masterId}/slots?date=${day}&duration_minutes=${service!.duration_minutes ?? 120}`)
    if (!slotsRes.ok) continue
    const slots = await slotsRes.json() as { items?: Array<{ starts_at: string }> }
    slotStarts = slots.items?.[0]?.starts_at
  }
  expect(slotStarts).toBeTruthy()

  const create = await fetch(`${api}/v1/appointments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ master_id: profileId, service_id: service!.id, starts_at: slotStarts }),
  })
  if (!create.ok) {
    throw new Error(`create appointment failed ${create.status}: ${await create.text()}`)
  }
  const appt = await create.json() as { id: string; status: string }
  if (appt.status === 'pending_confirmation' || appt.status === 'pending') {
    await fetch(`${api}/v1/appointments/${appt.id}/confirm`, { method: 'POST', headers: { Authorization: `Bearer ${master.access_token}` } })
  }
  const started = await fetch(`${api}/v1/appointments/${appt.id}/start`, { method: 'POST', headers: { Authorization: `Bearer ${master.access_token}` } })
  expect(started.ok, await started.text()).toBeTruthy()
  return { master, client, masterId, clientId, appt: { id: appt.id, status: 'in_progress', master_user_id: masterId, client_user_id: clientId } }
}

async function ensureCompletedWithClient(masterEmail: string, clientEmail: string, serviceNameContains: string) {
  const master = await apiLogin(masterEmail)
  const client = await apiLogin(clientEmail)
  const masterId = await authUserId(master.access_token)
  const clientId = await authUserId(client.access_token)
  const list = await fetch(`${api}/v1/appointments/mine?role=master`, {
    headers: { Authorization: `Bearer ${master.access_token}` },
  })
  expect(list.ok).toBeTruthy()
  const data = await list.json() as { items?: AppointmentRow[] }
  const done = (data.items ?? []).find((a) => a.status === 'completed' && a.client_user_id === clientId)
  if (done) return { master, client, masterId, clientId, appt: done }

  const started = await ensureInProgressForClient(masterEmail, clientEmail, serviceNameContains)
  await completeAppointmentApi(started.master.access_token, started.appt.id, {
    technique: 'E2E peer access',
    skipped: false,
    omit_formula: false,
    category_fields: { dye: 'Majirel 7.1', oxidizer: '6%', proportions: '1:1.5' },
    components: [{ name: 'Majirel 7.1', qty: '30', unit: 'г' }],
  })
  return { master: started.master, client: started.client, masterId: started.masterId, clientId: started.clientId, appt: started.appt }
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

  test('master knowledge hub search filters favorite article', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390' && info.project.name !== 'laptop-1366', 'hub viewports')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/knowledge')
    await expect(page.getByRole('heading', { name: 'База знаний' })).toBeVisible({ timeout: 15_000 })
    await test.info().attach(`knowledge-home-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    await page.getByRole('button', { name: 'Колористика' }).click()
    await page.getByRole('button', { name: 'Фильтры' }).click()
    await expect(page.getByLabel('Бренд')).toBeVisible()
    await page.getByLabel('Бренд').fill("L'Oreal")
    await page.locator('.kb-filter-panel .kb-suggest button').first().click()
    await test.info().attach(`knowledge-filtered-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    await page.getByRole('button', { name: 'Сбросить всё' }).click()
    await page.getByLabel('Поиск').fill('Majirel')
    await page.getByRole('button', { name: 'Найти' }).click()
    const majirel = page.getByRole('link', { name: /Majirel/i }).first()
    await expect(majirel).toBeVisible({ timeout: 15_000 })
    await majirel.click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.prose-article')).toBeVisible()
    await expect(page.locator('.prose-article img, .prose-article video, .article-video, .article-figure').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /избранн/i })).toBeVisible()
    await page.getByRole('button', { name: /избранн/i }).click()
    await expect(page.getByRole('heading', { name: 'Связанные товары' })).toBeVisible({ timeout: 15_000 })
    await test.info().attach(`knowledge-article-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    await page.locator('a.product-card').first().click()
    await expect(page.getByRole('heading', { name: 'Знания по этому продукту' })).toBeVisible({ timeout: 15_000 })
  })

  test('supplier knowledge editor draft preview publish', async ({ page }, info) => {
    test.skip(info.project.name !== 'laptop-1366', 'editor desktop')
    await loginUI(page, 'supplier1@demo.local')
    await page.goto('/knowledge')
    await expect(page.getByRole('heading', { name: 'База знаний' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('link', { name: 'Создать материал' }).click()
    await expect(page.getByRole('heading', { name: 'Новый материал' })).toBeVisible({ timeout: 15_000 })
    const title = `E2E протокол ${Date.now()}`
    await page.getByLabel('Заголовок').fill(title)
    await page.getByLabel('Категория материала').fill('Колористика')
    await page.getByLabel('Бренд').fill("L'Oreal")
    await page.locator('.rich-doc-surface [contenteditable="true"]').first().click()
    await page.keyboard.type('Протокол нанесения Majirel для e2e.')
    await page.getByRole('button', { name: 'Сохранить черновик' }).click()
    await expect(page.getByText(/Черновик сохран/i)).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Предпросмотр' }).click()
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 10_000 })
    await test.info().attach('knowledge-preview-1366', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    await page.getByRole('button', { name: 'К редактору' }).click()
    await page.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(page.getByText('Материал опубликован')).toBeVisible({ timeout: 20_000 })
    await test.info().attach('knowledge-editor-1366', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
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

  test('phase 0+1 profession types and hidden rep map nav', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const typesRes = await fetch(`${api}/v1/profession-types`)
    const typesText = await typesRes.text()
    expect(typesRes.ok, typesText).toBeTruthy()
    const typesBody = JSON.parse(typesText) as { items?: Array<{ slug: string; name: string }> }
    const slugs = (typesBody.items ?? []).map((t) => t.slug)
    expect(slugs).toEqual(expect.arrayContaining(['colorist', 'hairdresser', 'barber', 'nail_master', 'pedicure_master']))

    await loginUI(page, 'master1@demo.local')
    await page.goto('/master')
    await expect(page.getByText('Профессиональные типы')).toBeVisible({ timeout: 15_000 })
    const colorist = page.getByRole('checkbox', { name: 'Колорист' })
    const hairdresser = page.getByRole('checkbox', { name: 'Парикмахер' })
    await expect(colorist).toBeChecked()
    await expect(hairdresser).toBeChecked()
    await expect(page.locator('#work_type')).toHaveValue(/owner|salon_owner/)
    await expect(page.getByText('Дополнительные теги')).toBeVisible()
    await expect(page.getByPlaceholder('Свадебные укладки, мужские стрижки')).toHaveValue(/колористика/)
    await expect(page.getByText('Формат занятости', { exact: true })).toBeVisible()

    await page.evaluate(() => localStorage.clear())
    await loginUI(page, 'rep1@demo.local')
    await page.goto('/rep')
    await expect(page.getByRole('heading', { name: 'Кабинет представителя' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('link', { name: 'Маршрут' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Открыть карту' })).toHaveCount(0)
    await page.goto('/rep/map')
    await expect(page.getByRole('heading', { name: 'Карта маршрута' })).toBeVisible({ timeout: 15_000 })
  })

  test('salon owner staff + contact policy', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/staff')
    await expect(page.getByRole('heading', { name: /команда/i })).toBeVisible({ timeout: 15_000 })
    await page.goto('/salon/settings')
    await expect(page.getByTestId('contact-privacy-toggle')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Если выключено, мастера салона не увидят/)).toBeVisible()
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
    await expect(page.getByRole('heading', { name: /календарь/i })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '+ Событие' }).click()
    await expect(page.getByRole('heading', { name: 'Новое событие', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Добавить в календарь' })).toBeVisible()

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
    await expect(page.getByRole('link', { name: 'Каталог' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Корзина/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Мои заказы' })).toBeVisible()
  })

  test('phase3 client shop checkout end-to-end', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'phase3 primary viewport')
    const client = await apiLogin('client1@demo.local')
    await clearClientCart(client.access_token)
    const inStock = await shopProductInStock(client.access_token)
    expect(inStock?.id).toBeTruthy()
    await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: inStock!.id, qty: 1 }),
    })
    await loginUI(page, 'client1@demo.local')
    await page.goto('/shop/cart')
    await expect(page.getByRole('heading', { name: 'Корзина' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Оформить заказ' })).toBeEnabled({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Оформить заказ' }).click()
    await expect(page.getByRole('heading', { name: 'Оформление заказа' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /Далее · оплата/i }).click()
    await page.getByRole('button', { name: /Далее · сводка/i }).click()
    await page.getByRole('button', { name: 'Подтвердить' }).click()
    await page.getByRole('button', { name: 'Подтвердить заказ' }).click()
    await expect(page.locator('.success-panel').getByText('Готово')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.success-panel').getByText(/^CL-/).first()).toBeVisible()
    await page.locator('.success-panel').getByRole('link', { name: 'Мои заказы' }).click()
    await expect(page.getByRole('heading', { name: 'Мои заказы' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.shop-order').first()).toBeVisible()
  })

  test('phase3 audience security blocks professional product', async () => {
    const master = await apiLogin('master1@demo.local')
    const client = await apiLogin('client1@demo.local')
    const list = await fetch(`${api}/v1/commerce/shop/products?limit=100`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(list.ok).toBeTruthy()
    const products = await list.json() as { items?: Array<{ id: string; name: string }> }
    const pro = (products.items ?? []).find((p) => /Pro Fiber/i.test(p.name))
    expect(pro?.id).toBeTruthy()
    const detail = await fetch(`${api}/v1/commerce/shop/products/${pro!.id}`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    expect(detail.status).toBe(404)
    const cart = await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: pro!.id, qty: 1 }),
    })
    expect(cart.status).toBe(403)
  })

  test('phase3 checkout idempotency key', async () => {
    const client = await apiLogin('client1@demo.local')
    await clearClientCart(client.access_token)
    const product = await shopProductInStock(client.access_token)
    expect(product?.id).toBeTruthy()
    await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: product!.id, qty: 1 }),
    })
    const branchId = await salonPickupBranchId((await apiLogin('master1@demo.local')).access_token)
    const idem = `e2e-idem-${Date.now()}`
    const body = {
      delivery_address: 'E2E Test Address 123',
      payment_method: 'cash',
      pickup_branch_id: branchId,
      confirm_price_changes: true,
    }
    const h = { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json', 'Idempotency-Key': idem }
    const first = await fetch(`${api}/v1/commerce/shop/checkout`, { method: 'POST', headers: h, body: JSON.stringify(body) })
    expect(first.status).toBe(201)
    const result1 = await first.json() as { checkout_group_id?: string; orders?: Array<{ id: string }>; id?: string }
    const second = await fetch(`${api}/v1/commerce/shop/checkout`, { method: 'POST', headers: h, body: JSON.stringify(body) })
    expect(second.status).toBe(201)
    const result2 = await second.json() as { checkout_group_id?: string; orders?: Array<{ id: string }>; id?: string }
    if (result1.checkout_group_id && result2.checkout_group_id) {
      expect(result2.checkout_group_id).toBe(result1.checkout_group_id)
      expect(result2.orders?.map((o) => o.id)).toEqual(result1.orders?.map((o) => o.id))
    } else {
      expect(result2.id ?? result2.orders?.[0]?.id).toBe(result1.id ?? result1.orders?.[0]?.id)
    }
  })

  test('phase3 multi-supplier checkout creates separate orders', async () => {
    const client = await apiLogin('client1@demo.local')
    await clearClientCart(client.access_token)
    const supplier = await apiLogin('supplier1@demo.local')
    const supplier2 = await apiLogin('supplier2@demo.local')
    const list1 = await fetch(`${api}/v1/commerce/shop/products?limit=50`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const { items: all } = await list1.json() as { items?: Array<{ id: string; organization_id: string; sku: string }> }
    const org1Products = (all ?? []).filter((p) => p.sku.startsWith('S1-') && !p.sku.includes('RACE'))
    const org2Products = (all ?? []).filter((p) => p.sku.startsWith('S2-'))
    expect(org1Products.length).toBeGreaterThan(0)
    expect(org2Products.length).toBeGreaterThan(0)
    await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: org1Products[0].id, qty: 1 }),
    })
    await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: org1Products[1].id, qty: 1 }),
    })
    await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: org2Products[0].id, qty: 1 }),
    })
    const branchId = await salonPickupBranchId((await apiLogin('master1@demo.local')).access_token)
    const idem = `e2e-multi-${Date.now()}`
    const checkout = await fetch(`${api}/v1/commerce/shop/checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.access_token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idem,
      },
      body: JSON.stringify({
        delivery_address: 'Multi Supplier Test 456',
        payment_method: 'cash',
        pickup_branch_id: branchId,
        confirm_price_changes: true,
      }),
    })
    expect(checkout.status).toBe(201)
    const result = await checkout.json() as { checkout_group_id: string; orders: Array<{ id: string; supplier_org_id: string }> }
    expect(result.orders.length).toBe(2)
    const orgs = new Set(result.orders.map((o) => o.supplier_org_id))
    expect(orgs.size).toBe(2)

    const dup = await fetch(`${api}/v1/commerce/shop/checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.access_token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idem,
      },
      body: JSON.stringify({
        delivery_address: 'Multi Supplier Test 456',
        payment_method: 'cash',
        pickup_branch_id: branchId,
      }),
    })
    expect(dup.status).toBe(201)
    const dupResult = await dup.json() as { checkout_group_id: string; orders: Array<{ id: string }> }
    expect(dupResult.checkout_group_id).toBe(result.checkout_group_id)
    expect(dupResult.orders.map((o) => o.id)).toEqual(result.orders.map((o) => o.id))

    const sup1OrgRes = await fetch(`${api}/v1/organizations/mine`, {
      headers: { Authorization: `Bearer ${supplier.access_token}` },
    })
    const sup1OrgData = await sup1OrgRes.json() as { items?: Array<{ organization: { id: string; type: string } }> }
    const sup1OrgId = sup1OrgData.items?.find((i) => i.organization.type === 'supplier')?.organization.id
    expect(sup1OrgId).toBeTruthy()

    for (const order of result.orders) {
      const token = order.supplier_org_id === sup1OrgId ? supplier.access_token : supplier2.access_token
      const listRes = await fetch(`${api}/v1/commerce/shop/supplier/orders?organization_id=${order.supplier_org_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(listRes.ok).toBeTruthy()
      const list = await listRes.json() as { items?: Array<{ id: string }> }
      expect((list.items ?? []).some((o) => o.id === order.id)).toBeTruthy()
    }
    const otherSupplierOrders = result.orders.filter((o) => o.supplier_org_id !== sup1OrgId)
    if (otherSupplierOrders.length === 2) {
      expect(otherSupplierOrders[0].supplier_org_id).not.toBe(otherSupplierOrders[1].supplier_org_id)
    }
  })

  test('phase3 cross-role pickup flow', async () => {
    const client = await apiLogin('client1@demo.local')
    await clearClientCart(client.access_token)
    const supplier = await apiLogin('supplier1@demo.local')
    const rep = await apiLogin('rep1@demo.local')
    const salon = await apiLogin('master1@demo.local')
    const product = await shopProductInStock(client.access_token, { skuPrefix: 'S1-', excludeRace: true })
    expect(product?.id).toBeTruthy()
    await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: product!.id, qty: 1 }),
    })
    const branchId = await salonPickupBranchId(salon.access_token)
    const idem = `e2e-cross-${Date.now()}`
    const checkout = await fetch(`${api}/v1/commerce/shop/checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.access_token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idem,
      },
      body: JSON.stringify({
        delivery_address: 'Cross Role Flow Test',
        payment_method: 'cash',
        pickup_branch_id: branchId,
        confirm_price_changes: true,
      }),
    })
    expect(checkout.status).toBe(201)
    const created = await checkout.json() as { orders: Array<{ id: string }> }
    const orderId = created.orders[0].id

    const advance = async (status: string, repUserId?: string) => {
      const body: Record<string, string> = { status }
      if (repUserId) body.rep_user_id = repUserId
      const res = await fetch(`${api}/v1/commerce/shop/supplier/orders/${orderId}/transition`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res.status).toBeLessThan(300)
    }
    await advance('confirmed')
    await advance('picking')
    const me = await fetch(`${api}/v1/me/representative`, { headers: { Authorization: `Bearer ${rep.access_token}` } })
    const repMe = await me.json() as { id: string; user_id: string }
    await advance('in_delivery', repMe.user_id)

    const detail = await fetch(`${api}/v1/commerce/shop/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const orderDetail = await detail.json() as { items: Array<{ product_id: string; qty: number }> }
    const complete = await fetch(`${api}/v1/commerce/rep/deliveries/${orderId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${rep.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: orderDetail.items.map((it) => ({ product_id: it.product_id, qty_delivered: it.qty })),
        note: 'e2e',
        payment_received: true,
        amount_collected_minor: 89000,
      }),
    })
    expect(complete.status).toBeLessThan(300)

    const accept = await fetch(`${api}/v1/commerce/shop/pickup/orders/${orderId}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${salon.access_token}` },
    })
    expect(accept.status).toBeLessThan(300)

    const afterAccept = await fetch(`${api}/v1/commerce/shop/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const ready = await afterAccept.json() as { status: string; status_history?: Array<{ to_status: string }> }
    expect(ready.status).toBe('ready_for_pickup')

    const handover = await fetch(`${api}/v1/commerce/shop/pickup/orders/${orderId}/handover`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${salon.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_received: true }),
    })
    expect(handover.status).toBeLessThan(300)

    const final = await fetch(`${api}/v1/commerce/shop/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const done = await final.json() as { status: string; status_history?: Array<{ to_status: string }> }
    expect(done.status).toBe('received')
    const transitions = (done.status_history ?? []).map((h) => h.to_status)
    expect(transitions).toContain('submitted')
    expect(transitions).toContain('ready_for_pickup')
    expect(transitions).toContain('received')
  })

  test('phase3 price change confirmation', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'phase3 primary viewport')
    const supplier = await apiLogin('supplier1@demo.local')
    const client = await apiLogin('client1@demo.local')
    await clearClientCart(client.access_token)
    const products = await fetch(`${api}/v1/commerce/shop/products?limit=20`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const { items } = await products.json() as { items?: Array<{ id: string; sku: string; price_minor: number }> }
    const target = (items ?? []).find((p) => p.sku === 'S1-EST-ESX-001') ?? items?.[0]
    expect(target?.id).toBeTruthy()
    const oldPrice = target!.price_minor
    const newPrice = oldPrice + 20000
    await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: target!.id, qty: 1 }),
    })
    const patch = await fetch(`${api}/v1/commerce/products/${target!.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_minor: newPrice }),
    })
    expect(patch.status).toBeLessThan(300)

    await loginUI(page, 'client1@demo.local')
    await page.goto('/shop/checkout')
    await page.getByRole('button', { name: /Далее · оплата/i }).click()
    await page.getByRole('button', { name: /Далее · сводка/i }).click()
    await page.getByRole('button', { name: 'Подтвердить' }).click()
    await page.getByRole('button', { name: 'Подтвердить заказ' }).click()
    await expect(page.getByText(/Цена.*изменилась|Подтвердить новую цену/i).first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Подтвердить новую цену' }).click()
    await expect(page.getByRole('button', { name: 'Подтвердить заказ' })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Подтвердить заказ' }).click()
    await expect(page.locator('.success-panel').getByText('Готово')).toBeVisible({ timeout: 20_000 })
    await fetch(`${api}/v1/commerce/products/${target!.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_minor: oldPrice }),
    })
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
    await expect(page.getByRole('heading', { name: 'Free и Premium' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'TRIAL', exact: true })).toBeVisible()
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
      'employee1@demo.local',
      'expired1@demo.local',
      'premium1@demo.local',
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

  test('dashboard PUT/GET round-trip persists layout and colors', async () => {
    const master = await apiLogin('master1@demo.local')
    const widgets = [
      { id: 'alerts', enabled: true, positions: { lg: { x: 0, y: 0, w: 12, h: 5 } } },
      { id: 'calendar', enabled: true, positions: { lg: { x: 0, y: 5, w: 12, h: 18 } } },
      { id: 'today', enabled: true, positions: { lg: { x: 0, y: 23, w: 3, h: 4 } } },
      { id: 'pending', enabled: true, positions: { lg: { x: 3, y: 23, w: 3, h: 4 } } },
      { id: 'clients_today', enabled: true, positions: { lg: { x: 6, y: 23, w: 3, h: 4 } } },
      { id: 'upcoming', enabled: true, positions: { lg: { x: 0, y: 27, w: 6, h: 8 } } },
      { id: 'analytics', enabled: true, positions: { lg: { x: 6, y: 27, w: 6, h: 8 } } },
      { id: 'messages', enabled: false, positions: { lg: { x: 9, y: 23, w: 3, h: 4 } } },
      { id: 'calendar_colors', colors: { personal: '#aa5533' } },
    ]
    const put = await fetch(`${api}/v1/me/dashboard`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ widgets }),
    })
    expect(put.ok, `PUT dashboard ${put.status} ${await put.text()}`).toBeTruthy()
    const get = await fetch(`${api}/v1/me/dashboard`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    expect(get.ok).toBeTruthy()
    const body = await get.json() as { widgets: Array<{ id: string; enabled?: boolean; colors?: Record<string, string> }> }
    expect(body.widgets.find((w) => w.id === 'messages')?.enabled).toBe(false)
    expect(body.widgets.find((w) => w.id === 'calendar_colors')?.colors?.personal).toBe('#aa5533')
  })

  test('owner and admin can load org calendar; client cannot', async () => {
    const master = await apiLogin('master1@demo.local')
    const admin = await apiLogin('admin1@demo.local')
    const client = await apiLogin('client1@demo.local')
    const orgsRes = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    expect(orgsRes.ok).toBeTruthy()
    const orgs = await orgsRes.json() as { items: Array<{ organization: { id: string } }> }
    const orgID = orgs.items[0]?.organization.id
    expect(orgID).toBeTruthy()
    const from = new Date(Date.now() - 7 * 86400000).toISOString()
    const to = new Date(Date.now() + 14 * 86400000).toISOString()
    const qs = `organization_id=${orgID}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    const adminCal = await fetch(`${api}/v1/calendar/appointments?${qs}`, { headers: { Authorization: `Bearer ${admin.access_token}` } })
    expect(adminCal.status, await adminCal.text()).toBe(200)
    const masterCal = await fetch(`${api}/v1/calendar/appointments?${qs}`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    expect(masterCal.status).toBe(200)
    const clientCal = await fetch(`${api}/v1/calendar/appointments?${qs}`, { headers: { Authorization: `Bearer ${client.access_token}` } })
    expect(clientCal.status).toBe(403)
  })

  test('planner block occupies time and cannot overlap', async () => {
    const master = await apiLogin('master1@demo.local')
    const start = new Date(Date.UTC(2026, 11, 15, 4, 0, 0))
    const end = new Date(Date.UTC(2026, 11, 15, 5, 0, 0))
    const payload = {
      title: 'E2E lunch occupancy',
      category: 'break',
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      timezone: 'Asia/Krasnoyarsk',
    }
    const create = await fetch(`${api}/v1/planner/blocks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const created = await create.json() as { id?: string }
    expect(create.status, JSON.stringify(created)).toBeLessThan(300)
    expect(created.id).toBeTruthy()
    const overlap = await fetch(`${api}/v1/planner/blocks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, title: 'E2E overlap', category: 'personal' }),
    })
    expect(overlap.status).toBe(409)
    const del = await fetch(`${api}/v1/planner/blocks/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(del.status).toBe(204)
  })

  test('salon admin lands on operational dashboard and can open staff', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'admin1@demo.local')
    await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('link', { name: 'Найти мастера' })).toHaveCount(0)
    await page.goto('/staff')
    await expect(page.getByRole('heading', { name: /Команда/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('только мастерам')).toHaveCount(0)
  })

  test('dashboard widget toggle survives reload', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('dashboard-edit').click()
    const messages = page.locator('.dash-edit-row').filter({ hasText: 'Сообщения' }).locator('input[type="checkbox"]')
    await expect(messages).toBeVisible()
    if (await messages.isChecked()) await messages.uncheck()
    await page.getByTestId('dashboard-save').click()
    await page.reload()
    await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.widget-drag-handle', { hasText: 'Сообщения' })).toHaveCount(0)
    await expect(page.locator('[data-widget="messages"]')).toHaveCount(0)
  })

  test('calendar planner block is clickable and editable', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const master = await apiLogin('master1@demo.local')
    const windowFrom = new Date()
    windowFrom.setUTCHours(0, 0, 0, 0)
    const windowTo = new Date(windowFrom.getTime() + 21 * 86400000)
    const listed = await fetch(
      `${api}/v1/planner/blocks?from=${encodeURIComponent(windowFrom.toISOString())}&to=${encodeURIComponent(windowTo.toISOString())}`,
      { headers: { Authorization: `Bearer ${master.access_token}` } },
    )
    const listedBody = await listed.json() as { items?: Array<{ id: string; title: string; starts_at: string }> }
    let block = listedBody.items?.find((b) => b.title === 'E2E блок планера')
    let startsAt: Date
    if (!block) {
      const slot = await findFreePlannerSlot(master.access_token)
      const create = await fetch(`${api}/v1/planner/blocks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'E2E блок планера',
          category: 'task',
          starts_at: slot.start.toISOString(),
          ends_at: slot.end.toISOString(),
          timezone: 'Asia/Krasnoyarsk',
        }),
      })
      const created = await create.json() as { id?: string }
      expect(create.status, JSON.stringify(created)).toBeLessThan(300)
      block = { id: created.id!, title: 'E2E блок планера', starts_at: slot.start.toISOString() }
      startsAt = slot.start
    } else {
      startsAt = new Date(block.starts_at)
    }
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await expect(page.getByRole('button', { name: 'Неделя' })).toBeVisible({ timeout: 15_000 })
    await openListWeekContaining(page, startsAt)
    const row = page.locator('.fc-list-event').filter({ hasText: 'E2E блок планера' }).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.scrollIntoViewIfNeeded()
    await row.click({ force: true })
    await expect(page.getByRole('heading', { name: 'Событие планера' })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Удалить событие' }).click()
    await expect(page.getByText('Событие удалено')).toBeVisible()
  })

  test('chain calendar branch switcher is present', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'chain1@demo.local')
    await page.goto('/calendar')
    await expect(page.getByTestId('calendar-branch-switcher')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('calendar-branch-switcher').getByRole('option', { name: 'Новосибирск' }).first()).toBeAttached()
    await page.getByTestId('calendar-branch-switcher').selectOption({ label: 'Новосибирск' })
    await expect(page.getByText(/Asia\/Novosibirsk/)).toBeVisible()
  })

  test('phase2 supplier dashboard analytics team and assign task', async ({ page }, info) => {
    test.skip(!['phone-390', 'phone-430', 'tablet-768', 'laptop-1366', 'desktop-1920'].includes(info.project.name), 'phase2 viewports')
    await loginUI(page, 'supplier1@demo.local')
    await expect(page).toHaveURL(/\/supplier/, { timeout: 20_000 })
    await expect(page.getByText('Выручка сегодня').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Ожидает оплаты').first()).toBeVisible()
    await test.info().attach(`supplier-dashboard-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    await page.goto('/supplier/analytics')
    await expect(page.getByRole('heading', { name: 'Аналитика' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Неделя' }).click()
    await expect(page.getByText('Динамика выручки')).toBeVisible()
    await expect(page.locator('.recharts-surface').first()).toBeVisible({ timeout: 15_000 })
    if (info.project.name === 'laptop-1366') {
      await test.info().attach('supplier-analytics-desktop', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    }

    await page.goto('/supplier/team')
    await expect(page.getByRole('heading', { name: 'Представители' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Елена/).first()).toBeVisible()
    await expect(page.getByText(/Павел/).first()).toBeVisible()
    await test.info().attach(`supplier-team-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    const elena = page.locator('.kb-card').filter({ hasText: 'Елена' }).first()
    await elena.getByRole('button', { name: 'Создать задачу' }).click()
    const taskTitle = `E2E визит ${info.project.name}-${Date.now()}`
    await elena.getByLabel('Название').fill(taskTitle)
    await elena.getByLabel('Тип').selectOption('salon_visit')
    await elena.getByRole('button', { name: 'Создать задачу' }).last().click()
    await expect(page.getByText('Задача назначена')).toBeVisible({ timeout: 15_000 })
    await elena.getByRole('link', { name: 'Открыть' }).click()
    await expect(page.getByRole('heading', { name: /Елена/ })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Задачи' }).click()
    await expect(page.getByText(taskTitle).first()).toBeVisible({ timeout: 15_000 })
    if (info.project.name === 'phone-390') {
      await page.goto('/warehouse')
      await expect(page.getByRole('heading', { name: 'Склад' })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(/доступно|резерв|в пути/).first()).toBeVisible()
    }
  })

  test('phase2 representative dashboard map finance analytics', async ({ page }, info) => {
    test.skip(!['phone-390', 'phone-430', 'tablet-768', 'laptop-1366', 'desktop-1920'].includes(info.project.name), 'phase2 viewports')
    await loginUI(page, 'rep1@demo.local')
    await expect(page).toHaveURL(/\/rep/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Кабинет представителя' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Задач сегодня')).toBeVisible()
    await expect(page.getByText('К получению сегодня')).toBeVisible()
    await test.info().attach(`rep-dashboard-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    await expect(page.locator('.fc, .calendar-wrap').first()).toBeVisible({ timeout: 15_000 })

    await page.goto('/rep/map')
    await expect(page.getByRole('heading', { name: 'Карта маршрута' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.leaflet-overlay-pane svg, .leaflet-pane svg, path.leaflet-interactive').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('ol.list li, .list-item').first()).toBeVisible()
    await test.info().attach(`rep-map-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    await page.goto('/rep/finance')
    await expect(page.getByText('Итого на день')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Получено за месяц')).toBeVisible()
    await test.info().attach(`rep-finance-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    await page.goto('/rep/analytics')
    await expect(page.getByText('Доставки по дням')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.recharts-surface').first()).toBeVisible()
    await test.info().attach(`rep-analytics-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    if (info.project.name === 'phone-390') {
      await page.goto('/warehouse')
      await expect(page.getByRole('heading', { name: 'Склад' })).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.product-card .badge, .badge').filter({ hasText: /Достаточный запас|Низкий запас|Нет в наличии/ }).first()).toBeVisible({ timeout: 15_000 })
    }
  })

  test('phase2 supplier monitoring sees both representatives', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'supplier1@demo.local')
    await page.goto('/supplier/team')
    await expect(page.getByRole('heading', { name: 'Мониторинг' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Елена/).first()).toBeVisible()
    await expect(page.getByText(/Павел/).first()).toBeVisible()
    await expect(page.getByText(/просроч/i).first()).toBeVisible()
    await expect(page.getByText(/доставок/i).first()).toBeVisible()
    await expect(page.getByText(/собрано/i).first()).toBeVisible()
  })

  test('phase4 free master must fill scheme to complete', async ({ page }, info) => {
    test.skip(!['phone-390', 'laptop-1366'].includes(info.project.name), 'phase4 viewports')
    const { appt } = await ensurePhase4InProgress('master4@demo.local', 'client2@demo.local', 'Phase4')

    await loginUI(page, 'master4@demo.local')
    await page.goto(`/appointments/${appt.id}`)
    await expect(page.getByTestId('complete-appointment')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('complete-appointment').click()
    await expect(page.getByText(/field required|Заполните|обязательн/i).first()).toBeVisible({ timeout: 10_000 })
    await fillColoringScheme(page)
    await page.getByTestId('complete-appointment').click()
    await expect(page.locator('.badge').filter({ hasText: /заверш/i })).toBeVisible({ timeout: 20_000 })
    await test.info().attach(`phase4-free-scheme-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  })

  test('phase4 premium master can skip scheme', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const { appt } = await ensurePhase4InProgress('premium1@demo.local', 'client1@demo.local', 'Phase4 Premium')

    await loginUI(page, 'premium1@demo.local')
    await page.goto(`/appointments/${appt.id}`)
    await page.getByTestId('skip-scheme').check()
    await expect(page.getByTestId('scheme-skip-confirm')).toBeVisible()
    await page.getByText('Подтверждаю, что схема не раскрывается').click()
    await page.getByTestId('complete-appointment').click()
    await expect(page.locator('.badge').filter({ hasText: /заверш/i })).toBeVisible({ timeout: 20_000 })
  })

  test('phase4 expired trial subscription shows free', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'expired1@demo.local')
    await page.goto('/profile/subscription')
    await expect(page.getByTestId('subscription-expired-banner')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Trial истёк · Free', exact: true })).toBeVisible()
    const sub = await fetch(`${api}/v1/me/subscription`, {
      headers: { Authorization: `Bearer ${(await apiLogin('expired1@demo.local')).access_token}` },
    })
    const snap = await sub.json() as { effective_plan?: string; features?: string[] }
    expect(snap.effective_plan).toBe('free')
    expect(snap.features ?? []).not.toContain('skip_service_scheme')
  })

  test('phase4 registration grants calendar trial', async () => {
    const email = `phase4-trial-${Date.now()}@demo.local`
    const reg = await fetch(`${api}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        display_name: 'Phase4 Trial Master',
        as_master: true,
      }),
    })
    expect(reg.ok).toBeTruthy()
    const auth = await reg.json() as { access_token: string }
    const sub = await fetch(`${api}/v1/me/subscription`, {
      headers: { Authorization: `Bearer ${auth.access_token}` },
    })
    expect(sub.ok).toBeTruthy()
    const snap = await sub.json() as {
      status?: string
      effective_plan?: string
      trial_started_at?: string
      trial_ends_at?: string
    }
    expect(snap.status).toBe('trial')
    expect(snap.effective_plan).toBe('premium')
    expect(snap.trial_started_at).toBeTruthy()
    expect(snap.trial_ends_at).toBeTruthy()
    const start = new Date(snap.trial_started_at!)
    const end = new Date(snap.trial_ends_at!)
    const wantEnd = new Date(start)
    wantEnd.setMonth(wantEnd.getMonth() + 3)
    expect(Math.abs(end.getTime() - wantEnd.getTime())).toBeLessThan(86400000)
  })

  test('phase5 knowledge filter combination and ownership', async () => {
    const master = await apiLogin('master1@demo.local')
    const s1 = await apiLogin('supplier1@demo.local')
    const s2 = await apiLogin('supplier2@demo.local')

    const listRes = await fetch(`${api}/v1/knowledge?q=${encodeURIComponent('Majirel')}&brand=${encodeURIComponent("L'Oreal")}&category=${encodeURIComponent('Колористика')}&limit=20`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(listRes.ok).toBeTruthy()
    const listed = await listRes.json() as { items?: Array<{ id: string; title: string; brand?: string; category?: string }> }
    expect((listed.items ?? []).length).toBeGreaterThan(0)
    expect((listed.items ?? []).every((a) => /l'?oreal/i.test(a.brand ?? '') && a.category === 'Колористика')).toBeTruthy()

    const mine = await fetch(`${api}/v1/me/knowledge?limit=50`, {
      headers: { Authorization: `Bearer ${s1.access_token}` },
    })
    expect(mine.ok).toBeTruthy()
    const mineData = await mine.json() as { items?: Array<{ id: string; title: string; status?: string; published?: boolean }> }
    const owned = (mineData.items ?? [])[0]
    expect(owned?.id).toBeTruthy()

    const foreign = await fetch(`${api}/v1/knowledge/${owned!.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${s2.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'hack', category: 'Колористика', content: 'x', content_format: 'plain' }),
    })
    expect([401, 403, 404]).toContain(foreign.status)

    const draft = mineData.items?.find((a) => a.status === 'draft' || a.published === false)
    if (draft) {
      const hidden = await fetch(`${api}/v1/knowledge/${draft.id}`, {
        headers: { Authorization: `Bearer ${master.access_token}` },
      })
      expect(hidden.status).toBe(404)
      const pubList = await fetch(`${api}/v1/knowledge?q=${encodeURIComponent(draft.title)}`, {
        headers: { Authorization: `Bearer ${master.access_token}` },
      })
      const pubData = await pubList.json() as { items?: Array<{ id: string }> }
      expect((pubData.items ?? []).some((a) => a.id === draft.id)).toBeFalsy()
    }

    const s2orgs = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${s2.access_token}` } })
    const s2orgData = await s2orgs.json() as { items?: Array<{ organization: { id: string; type: string } }> }
    const s2org = (s2orgData.items ?? []).find((i) => i.organization.type === 'supplier')?.organization.id
    const s2products = await fetch(`${api}/v1/commerce/products?organization_id=${s2org}`, {
      headers: { Authorization: `Bearer ${s2.access_token}` },
    })
    const s2cats = await s2products.json() as { items?: Array<{ id: string; organization_id?: string }> }
    const foreignProduct = (s2cats.items ?? [])[0]
    if (foreignProduct?.id) {
      const orgs = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${s1.access_token}` } })
      const orgData = await orgs.json() as { items?: Array<{ organization: { id: string; type: string } }> }
      const orgId = (orgData.items ?? []).find((i) => i.organization.type === 'supplier')?.organization.id
      const attach = await fetch(`${api}/v1/knowledge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${s1.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Foreign product ${Date.now()}`,
          category: 'Колористика',
          content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"no"}]}]}',
          content_format: 'doc_json',
          organization_id: orgId,
          published: false,
          product_ids: [foreignProduct.id],
        }),
      })
      expect([400, 403]).toContain(attach.status)
    }

    const favTarget = (listed.items ?? [])[0]
    const addFav = await fetch(`${api}/v1/knowledge/${favTarget.id}/favorite`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(addFav.ok).toBeTruthy()
    const favList = await fetch(`${api}/v1/knowledge?favorites=1`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    const favData = await favList.json() as { items?: Array<{ id: string }> }
    expect((favData.items ?? []).some((a) => a.id === favTarget.id)).toBeTruthy()
    await fetch(`${api}/v1/knowledge/${favTarget.id}/favorite`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
  })

  test('phase6 contact privacy owner toggle hides contacts from employee', async ({ page }, info) => {
    test.skip(!['phone-390', 'laptop-1366'].includes(info.project.name), 'phase6 viewports')
    const owner = await apiLogin('master1@demo.local')
    const employee = await apiLogin('employee1@demo.local')
    const orgsRes = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${owner.access_token}` } })
    const orgs = await orgsRes.json() as { items?: Array<{ organization: { id: string; type: string } }> }
    const orgId = (orgs.items ?? []).find((i) => i.organization.type !== 'supplier')?.organization.id
    expect(orgId).toBeTruthy()

    const cardsRes = await fetch(`${api}/v1/clients/mine`, { headers: { Authorization: `Bearer ${employee.access_token}` } })
    expect(cardsRes.ok).toBeTruthy()
    let cards = await cardsRes.json() as { items?: Array<{ id: string; phone?: string | null; email?: string | null; contacts_hidden?: boolean }> }
    if (!(cards.items ?? []).length) {
      const apptsRes = await fetch(`${api}/v1/appointments/mine?role=master`, { headers: { Authorization: `Bearer ${employee.access_token}` } })
      const appts = await apptsRes.json() as { items?: Array<{ id: string; status: string }> }
      const live = (appts.items ?? []).find((a) => a.status === 'in_progress' || a.status === 'confirmed')
      expect(live?.id).toBeTruthy()
      if (live?.status === 'confirmed') {
        await fetch(`${api}/v1/appointments/${live.id}/start`, { method: 'POST', headers: { Authorization: `Bearer ${employee.access_token}` } })
      }
      const done = await fetch(`${api}/v1/appointments/${live!.id}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${employee.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipped: true, notes: 'e2e privacy visit' }),
      })
      expect(done.ok, await done.text()).toBeTruthy()
      const retry = await fetch(`${api}/v1/clients/mine`, { headers: { Authorization: `Bearer ${employee.access_token}` } })
      cards = await retry.json() as typeof cards
    }
    const card = cards.items?.[0]
    expect(card?.id).toBeTruthy()

    await loginUI(page, 'master1@demo.local')
    await page.goto('/salon/settings')
    await expect(page.getByTestId('contact-privacy-toggle')).toBeVisible({ timeout: 15_000 })
    const toggle = page.getByTestId('contact-privacy-toggle')
    if (await toggle.isChecked()) {
      await page.getByText('Мастера видят телефон и email клиента').click()
    }
    await page.getByRole('button', { name: 'Сохранить политику' }).click()
    await expect(page.getByText('Политика контактов обновлена')).toBeVisible({ timeout: 10_000 })

    const hiddenApi = await fetch(`${api}/v1/clients/id/${card!.id}`, { headers: { Authorization: `Bearer ${employee.access_token}` } })
    expect(hiddenApi.ok).toBeTruthy()
    const hiddenBody = await hiddenApi.json() as { phone?: string | null; email?: string | null; contacts_hidden?: boolean }
    expect(hiddenBody.phone).toBeFalsy()
    expect(hiddenBody.email).toBeFalsy()
    expect(hiddenBody.contacts_hidden).toBeTruthy()

    const ownerSee = await fetch(`${api}/v1/clients/id/${card!.id}`, { headers: { Authorization: `Bearer ${owner.access_token}` } })
    expect(ownerSee.ok).toBeTruthy()
    const ownerBody = await ownerSee.json() as { phone?: string | null; contacts_hidden?: boolean }
    expect(ownerBody.contacts_hidden).toBeFalsy()
    expect(ownerBody.phone || ownerSee.status).toBeTruthy()

    const other = await apiLogin('master2@demo.local')
    const foreign = await fetch(`${api}/v1/clients/id/${card!.id}`, { headers: { Authorization: `Bearer ${other.access_token}` } })
    expect([401, 403, 404]).toContain(foreign.status)

    await page.getByRole('button', { name: 'Выйти' }).first().click()
    await loginUI(page, 'employee1@demo.local')
    await page.goto(`/clients/${card!.id}`)
    await expect(page.getByTestId('contacts-hidden')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('+79001000001')).toHaveCount(0)

    await page.getByRole('button', { name: 'Выйти' }).first().click()
    await loginUI(page, 'master1@demo.local')
    await page.goto('/salon/settings')
    await expect(page.getByTestId('contact-privacy-toggle')).toBeVisible({ timeout: 15_000 })
    if (!(await page.getByTestId('contact-privacy-toggle').isChecked())) {
      await page.getByText('Мастера видят телефон и email клиента').click()
    }
    await page.getByRole('button', { name: 'Сохранить политику' }).click()
    await expect(page.getByText('Политика контактов обновлена')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Выйти' }).first().click()
    await loginUI(page, 'employee1@demo.local')
    await page.goto(`/clients/${card!.id}`)
    await expect(page.getByTestId('client-contacts')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('contacts-hidden')).toHaveCount(0)
  })

  test('phase6 blacklist two no-shows then unblock locality', async ({ page }, info) => {
    test.skip(!['phone-390', 'laptop-1366'].includes(info.project.name), 'phase6 viewports')
    const email = `p6-bl-${Date.now()}@demo.local`
    const reg = await fetch(`${api}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name: 'P6 Blacklist', as_master: false }),
    })
    expect(reg.ok, await reg.text()).toBeTruthy()
    const client = await apiLogin(email)
    const masterA = await apiLogin('master1@demo.local')
    const masterB = await apiLogin('master2@demo.local')
    const aMe = await fetch(`${api}/v1/me/master`, { headers: { Authorization: `Bearer ${masterA.access_token}` } })
    const bMe = await fetch(`${api}/v1/me/master`, { headers: { Authorization: `Bearer ${masterB.access_token}` } })
    const aProf = await aMe.json() as { master?: { id: string; user_id?: string }; services?: Array<{ id: string; name: string; duration_minutes?: number }> }
    const bProf = await bMe.json() as { master?: { id: string; user_id?: string }; services?: Array<{ id: string; name: string; duration_minutes?: number }> }
    const aService = (aProf.services ?? []).find((s) => /стрижк/i.test(s.name)) ?? aProf.services?.[0]
    const bService = (bProf.services ?? []).find((s) => /стрижк/i.test(s.name)) ?? bProf.services?.[0]
    expect(aProf.master?.id && aService?.id && bProf.master?.id && bService?.id).toBeTruthy()
    const aUser = await fetch(`${api}/v1/auth/me`, { headers: { Authorization: `Bearer ${masterA.access_token}` } })
    const aUserBody = await aUser.json() as { id?: string; user?: { id?: string } }
    const masterAUserId = aUserBody.id ?? aUserBody.user?.id

    async function slotFor(userId: string, duration: number) {
      const start = info.project.name === 'phone-390' ? 12 : 1
      for (let d = start; d <= start + 16; d++) {
        const day = new Date(Date.now() + d * 86400000)
        if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue
        const date = day.toISOString().slice(0, 10)
        const slotsRes = await fetch(`${api}/v1/masters/${userId}/slots?date=${date}&duration_minutes=${duration}`)
        if (!slotsRes.ok) continue
        const slots = await slotsRes.json() as { items?: Array<{ starts_at: string }> }
        if (slots.items?.[0]?.starts_at) return slots.items[0].starts_at
      }
      throw new Error('no slot')
    }

    async function noShowOnce() {
      const starts = await slotFor(masterAUserId!, aService!.duration_minutes ?? 60)
      const create = await fetch(`${api}/v1/appointments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ master_id: aProf.master!.id, service_id: aService!.id, starts_at: starts }),
      })
      const createText = await create.text()
      expect(create.ok, createText).toBeTruthy()
      const appt = JSON.parse(createText) as { id: string; status: string }
      if (appt.status === 'pending_confirmation' || appt.status === 'pending') {
        await fetch(`${api}/v1/appointments/${appt.id}/confirm`, { method: 'POST', headers: { Authorization: `Bearer ${masterA.access_token}` } })
      }
      const ns = await fetch(`${api}/v1/appointments/${appt.id}/no-show`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${masterA.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'e2e' }),
      })
      expect(ns.ok || ns.status === 200 || ns.status === 204, await ns.text()).toBeTruthy()
      return appt.id
    }

    await noShowOnce()
    await noShowOnce()

    await loginUI(page, email)
    await page.goto(`/masters/${aProf.master!.id}`)
    await page.locator('.service-card').filter({ hasText: aService!.name }).first().click()
    await page.getByRole('button', { name: 'Далее' }).click()
    await pickBookableSlot(page, masterAUserId!, aService!.duration_minutes ?? 60)
    await page.getByRole('button', { name: 'К подтверждению' }).click()
    await page.getByRole('button', { name: 'Подтвердить запись' }).click()
    await expect(page.getByText('Запись к этому мастеру сейчас недоступна.').first()).toBeVisible({ timeout: 15_000 })

    await page.goto(`/masters/${bProf.master!.id}`)
    await page.locator('.service-card').first().click()
    await page.getByRole('button', { name: 'Далее' }).click()
    await pickBookableSlot(page, bProf.master!.user_id || masterAUserId!, bService!.duration_minutes ?? 60)
    await page.getByRole('button', { name: 'К подтверждению' }).click()
    await page.getByRole('button', { name: 'Подтвердить запись' }).click()
    await expect(page.getByRole('heading', { name: 'Запись отправлена' })).toBeVisible({ timeout: 15_000 })

    const clientMe = await fetch(`${api}/v1/auth/me`, { headers: { Authorization: `Bearer ${client.access_token}` } })
    const clientBody = await clientMe.json() as { id?: string; user?: { id?: string } }
    const clientId = clientBody.id ?? clientBody.user?.id
    const listCards = await fetch(`${api}/v1/clients/mine`, { headers: { Authorization: `Bearer ${masterA.access_token}` } })
    const listed = await listCards.json() as { items?: Array<{ id: string; user_id?: string }> }
    const card = (listed.items ?? []).find((c) => c.user_id === clientId) ?? listed.items?.[0]
    expect(card?.id).toBeTruthy()

    await page.getByRole('button', { name: 'Выйти' }).first().click()
    await loginUI(page, 'master1@demo.local')
    await page.goto(`/clients/${card!.id}`)
    await expect(page.getByRole('heading', { name: /чёрный список/i })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Разблокировать клиента' }).click()
    await expect(page.getByText('Клиент разблокирован')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Выйти' }).first().click()
    await loginUI(page, email)
    await page.goto(`/masters/${aProf.master!.id}`)
    await page.locator('.service-card').filter({ hasText: aService!.name }).first().click()
    await page.getByRole('button', { name: 'Далее' }).click()
    await pickBookableSlot(page, masterAUserId!, aService!.duration_minutes ?? 60)
    await page.getByRole('button', { name: 'К подтверждению' }).click()
    await page.getByRole('button', { name: 'Подтвердить запись' }).click()
    await expect(page.getByRole('heading', { name: 'Запись отправлена' })).toBeVisible({ timeout: 15_000 })
  })

  test('phase6 recurring every 3 weeks propose accept pause revise cancel', async ({ page }, info) => {
    test.skip(!['phone-390', 'laptop-1366'].includes(info.project.name), 'phase6 viewports')
    const endMark = info.project.name === 'phone-390' ? '2029-01-21' : '2029-02-22'
    await loginUI(page, 'master1@demo.local')
    await page.goto('/cosmetics/recurring')
    await expect(page.getByRole('heading', { name: /регулярные поставки/i })).toBeVisible({ timeout: 15_000 })
    await page.locator('#sup').selectOption({ label: 'Поставщик Профи (demo)' })
    await expect(page.getByTestId('recurring-product-0')).toBeEnabled({ timeout: 10_000 })
    await expect.poll(async () => page.getByTestId('recurring-product-0').locator('option').count()).toBeGreaterThan(2)
    await page.getByTestId('recurring-product-0').selectOption({ index: 1 })
    await page.getByRole('button', { name: 'Добавить товар' }).click()
    await page.getByTestId('recurring-product-1').selectOption({ index: 2 })
    await page.locator('#freq').selectOption('every_n_weeks')
    await page.locator('#nweeks').fill('3')
    await page.locator('#end').fill(endMark)
    await page.getByRole('button', { name: 'Отправить заявку' }).click()
    await expect(page.getByText('Заявка на регулярную поставку создана')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Каждые 3 нед/).first()).toBeVisible()

    await page.getByRole('button', { name: 'Выйти' }).first().click()
    await loginUI(page, 'supplier1@demo.local')
    await page.goto('/supplier/recurring')
    const pending = page.getByTestId('recurring-pending').filter({ hasText: endMark }).first()
    await expect(pending).toBeVisible({ timeout: 15_000 })
    await pending.getByRole('button', { name: 'Предложить изменения' }).click()
    await pending.locator('input').first().fill('2')
    await pending.getByRole('button', { name: 'Отправить предложение' }).click()
    await expect(page.getByText('Решение сохранено')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Выйти' }).first().click()
    await loginUI(page, 'master1@demo.local')
    await page.goto('/cosmetics/recurring')
    const diff = page.getByTestId('recurring-diff').first()
    await expect(diff).toBeVisible({ timeout: 15_000 })
    await expect(diff.getByText(/Было → Предложено/)).toBeVisible()
    await diff.getByRole('button', { name: 'Принять' }).click()
    await expect(page.getByText('Решение сохранено')).toBeVisible({ timeout: 10_000 })
    const byEnd = { hasText: endMark }
    const active = page.getByTestId('recurring-active').filter(byEnd).first()
    await expect(active).toBeVisible()
    await active.getByRole('button', { name: 'Пауза' }).click()
    await expect(page.getByTestId('recurring-paused').filter(byEnd).first()).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('recurring-paused').filter(byEnd).getByRole('button', { name: 'Возобновить' }).click()
    await expect(active).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('recurring-active').filter(byEnd).first().getByRole('button', { name: 'Изменить условия' }).click()
    await page.getByRole('button', { name: 'Отправить на подтверждение поставщику' }).click()
    await expect(page.getByTestId('recurring-diff')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Выйти' }).first().click()
    await loginUI(page, 'supplier1@demo.local')
    await page.goto('/supplier/recurring')
    await expect(page.getByTestId('recurring-diff')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('recurring-diff').getByRole('button', { name: 'Принять' }).click()
    await expect(page.getByText('Решение сохранено')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Выйти' }).first().click()
    await loginUI(page, 'master1@demo.local')
    await page.goto('/cosmetics/recurring')
    await page.getByTestId('recurring-active').filter({ hasText: endMark }).first().getByRole('button', { name: 'Отменить' }).click()
    await expect(page.getByTestId('recurring-cancelled').filter({ hasText: endMark }).first()).toBeVisible({ timeout: 10_000 })
  })

  test('phase6 role cabinets show expected nav', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    async function moreLinks() {
      const more = page.getByRole('button', { name: 'Ещё' })
      if (await more.isVisible()) await more.click()
    }
    await loginUI(page, 'master4@demo.local')
    await expect(page.locator('.topbar-cabinet')).toHaveText('Кабинет частного мастера', { timeout: 15_000 })
    await moreLinks()
    await expect(page.getByRole('link', { name: 'Команда' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Настройки' })).toHaveCount(0)
    await closeMoreDrawer(page)
    await page.getByRole('button', { name: 'Выйти' }).first().click()

    await loginUI(page, 'master2@demo.local')
    await expect(page.locator('.topbar-cabinet')).toHaveText('Кабинет арендатора кресла', { timeout: 15_000 })
    await moreLinks()
    await expect(page.getByRole('link', { name: 'Команда' })).toHaveCount(0)
    await closeMoreDrawer(page)
    await page.getByRole('button', { name: 'Выйти' }).first().click()

    await loginUI(page, 'mobile1@demo.local')
    await expect(page.locator('.topbar-cabinet')).toHaveText('Кабинет выездного мастера', { timeout: 15_000 })
    await moreLinks()
    await expect(page.getByRole('link', { name: 'Команда' })).toHaveCount(0)
    await closeMoreDrawer(page)
    await page.getByRole('button', { name: 'Выйти' }).first().click()

    await loginUI(page, 'employee1@demo.local')
    await expect(page.locator('.topbar-cabinet')).toHaveText('Кабинет мастера салона', { timeout: 15_000 })
    await moreLinks()
    await expect(page.getByRole('link', { name: 'Команда' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Настройки' })).toHaveCount(0)
    await closeMoreDrawer(page)
    await page.getByRole('button', { name: 'Выйти' }).first().click()

    await loginUI(page, 'master1@demo.local')
    await expect(page.locator('.topbar-cabinet')).toHaveText('Кабинет владельца салона', { timeout: 15_000 })
    await moreLinks()
    await expect(page.getByRole('link', { name: 'Команда' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Настройки' })).toBeVisible()
    await closeMoreDrawer(page)
    await page.getByRole('button', { name: 'Выйти' }).first().click()

    await loginUI(page, 'admin1@demo.local')
    await expect(page.locator('.topbar-cabinet')).toHaveText('Кабинет администратора', { timeout: 15_000 })
    await moreLinks()
    await expect(page.getByRole('link', { name: 'Команда' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Настройки' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Аналитика' })).toHaveCount(0)
    await closeMoreDrawer(page)
    await page.goto('/salon/settings')
    await expect(page.getByText('недоступен для вашей роли')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Выйти' }).first().click()

    await loginUI(page, 'chain1@demo.local')
    await expect(page.locator('.topbar-cabinet')).toHaveText('Кабинет владельца сети', { timeout: 15_000 })
    await expect(page.getByTestId('chain-branch-switcher').locator('visible=true').first()).toBeVisible({ timeout: 15_000 })
  })

  test('phase6 chain owner branch switcher changes staff context', async ({ page }, info) => {
    test.skip(!['phone-390', 'laptop-1366'].includes(info.project.name), 'phase6 viewports')
    await loginUI(page, 'chain1@demo.local')
    const branchSwitch = page.getByTestId('chain-branch-switcher').locator('visible=true').first()
    await expect(branchSwitch).toBeVisible({ timeout: 15_000 })
    await branchSwitch.selectOption({ label: 'Новосибирск' })
    await page.goto('/staff')
    await expect(page.getByText(/Сеть Salon-X \(demo\) · Новосибирск/)).toBeVisible({ timeout: 15_000 })
    await page.goto('/calendar')
    await expect(page.getByTestId('calendar-branch-switcher')).toHaveValue(/.+/)
  })

  test('phase6 hints dismiss persists and global off hides them', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const email = `p6-hint-${Date.now()}@demo.local`
    const reg = await fetch(`${api}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name: 'P6 Hints', as_master: false }),
    })
    expect(reg.ok, await reg.text()).toBeTruthy()
    await loginUI(page, email)
    await page.goto('/search')
    await expect(page.getByTestId('hint-client-booking')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Запись' }).click()
    await page.getByRole('button', { name: 'Больше не показывать' }).click()
    await expect(page.getByTestId('hint-client-booking')).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: /Поиск/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('hint-client-booking')).toHaveCount(0)
    await page.goto('/profile')
    await expect(page.getByTestId('hints-toggle')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('hints-toggle').click()
    await expect(page.getByTestId('hints-toggle')).not.toBeChecked({ timeout: 15_000 })
    await page.goto('/shop')
    await expect(page.getByTestId('hint-shop-home')).toHaveCount(0)
  })

  test('phase6 auto-confirm confirms one client and blacklist still blocks', async ({ page }, info) => {
    test.skip(!['phone-390', 'laptop-1366'].includes(info.project.name), 'phase6 viewports')
    const master = await apiLogin('master1@demo.local')
    const client2 = await apiLogin('client2@demo.local')
    const me = await fetch(`${api}/v1/auth/me`, { headers: { Authorization: `Bearer ${client2.access_token}` } })
    const clientBody = await me.json() as { id?: string; user?: { id?: string } }
    const clientId = clientBody.id ?? clientBody.user?.id
    const cardsRes = await fetch(`${api}/v1/clients/mine`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    const cards = await cardsRes.json() as { items?: Array<{ id: string; user_id?: string }> }
    const card = (cards.items ?? []).find((c) => c.user_id === clientId)
    expect(card?.id).toBeTruthy()

    await loginUI(page, 'master1@demo.local')
    await page.goto(`/clients/${card!.id}`)
    await expect(page.getByTestId('auto-confirm-toggle')).toBeVisible({ timeout: 15_000 })
    if (!(await page.getByTestId('auto-confirm-toggle').isChecked())) {
      await page.getByText('Автоподтверждение для этого клиента').click()
      await expect(page.getByText('Автоподтверждение обновлено')).toBeVisible({ timeout: 10_000 })
    }

    const prof = await fetch(`${api}/v1/me/master`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    const profBody = await prof.json() as { master?: { id: string }; services?: Array<{ id: string; duration_minutes?: number; name: string }> }
    const service = (profBody.services ?? []).find((s) => /стрижк/i.test(s.name)) ?? profBody.services?.[0]
    const masterMe = await fetch(`${api}/v1/auth/me`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    const masterBody = await masterMe.json() as { id?: string; user?: { id?: string } }
    const masterUserId = masterBody.id ?? masterBody.user?.id
    let starts: string | undefined
    for (let d = 1; d <= 16 && !starts; d++) {
      const day = new Date(Date.now() + d * 86400000)
      if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue
      const slotsRes = await fetch(`${api}/v1/masters/${masterUserId}/slots?date=${day.toISOString().slice(0, 10)}&duration_minutes=${service!.duration_minutes ?? 60}`)
      if (!slotsRes.ok) continue
      const slots = await slotsRes.json() as { items?: Array<{ starts_at: string }> }
      starts = slots.items?.[0]?.starts_at
    }
    expect(starts).toBeTruthy()
    const booked = await fetch(`${api}/v1/appointments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client2.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ master_id: profBody.master!.id, service_id: service!.id, starts_at: starts }),
    })
    const bookedText = await booked.text()
    expect(booked.ok, bookedText).toBeTruthy()
    const bookedBody = JSON.parse(bookedText) as { status?: string }
    expect(bookedBody.status).toBe('confirmed')

    const freshEmail = `p6-ac-${Date.now()}@demo.local`
    const reg = await fetch(`${api}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: freshEmail, password, display_name: 'P6 Pending' }),
    })
    expect(reg.ok).toBeTruthy()
    const fresh = await apiLogin(freshEmail)
    let starts2: string | undefined
    for (let d = 1; d <= 16 && !starts2; d++) {
      const day = new Date(Date.now() + d * 86400000)
      if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue
      const slotsRes = await fetch(`${api}/v1/masters/${masterUserId}/slots?date=${day.toISOString().slice(0, 10)}&duration_minutes=${service!.duration_minutes ?? 60}`)
      if (!slotsRes.ok) continue
      const slots = await slotsRes.json() as { items?: Array<{ starts_at: string }> }
      starts2 = slots.items?.[1]?.starts_at ?? slots.items?.[0]?.starts_at
    }
    const pending = await fetch(`${api}/v1/appointments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fresh.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ master_id: profBody.master!.id, service_id: service!.id, starts_at: starts2 }),
    })
    const pendingText = await pending.text()
    expect(pending.ok, pendingText).toBeTruthy()
    const pendingBody = JSON.parse(pendingText) as { status?: string }
    expect(pendingBody.status).toMatch(/pending/)

    const client3 = await apiLogin('client3@demo.local')
    const blocked = await fetch(`${api}/v1/appointments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client3.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ master_id: profBody.master!.id, service_id: service!.id, starts_at: starts }),
    })
    expect(blocked.status).toBe(403)
    await page.goto(`/masters/${profBody.master!.id}`)
  })

  test('phase2 A premium omit_formula is independent of skip_service_scheme', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await ensureCompletedWithClient('master4@demo.local', 'client1@demo.local', 'Phase4')
    const { appt, master } = await ensureInProgressForClient('premium1@demo.local', 'client1@demo.local', 'Phase4 Premium')

    await loginUI(page, 'premium1@demo.local')
    await page.goto(`/appointments/${appt.id}`)
    await fillColoringScheme(page)
    await expect(page.getByTestId('omit-formula')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('skip-scheme')).not.toBeChecked()
    await page.getByTestId('omit-formula').check()
    await expect(page.getByTestId('skip-scheme')).not.toBeChecked()
    await page.getByTestId('complete-appointment').click()
    await expect(page.locator('.badge').filter({ hasText: /заверш/i })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('scheme-summary')).toBeVisible()
    await expect(page.getByTestId('scheme-withheld')).toHaveCount(0)
    await expect(page.getByTestId('formula-withheld')).toHaveCount(0)

    const owner = await fetchScheme(master.access_token, appt.id)
    expect(owner.status, owner.text).toBe(200)
    expect(owner.body.exists).toBe(true)
    expect(owner.body.skipped).toBe(false)
    expect(owner.body.omit_formula).toBe(true)
    expect(owner.body.details_redacted).toBe(false)
    expect(owner.body.formula_redacted).toBe(false)
    expect(String(schemeCategoryFields(owner.body).dye ?? '')).toMatch(/Majirel/)
    expect(owner.body.technique).toMatch(/Балаяж/)

    const free = await apiLogin('master4@demo.local')
    const peer = await fetchScheme(free.access_token, appt.id)
    expect(peer.status, peer.text).toBe(200)
    expect(peer.body.exists).toBe(true)
    expect(peer.body.skipped).toBe(false)
    expect(peer.body.omit_formula).toBe(true)
    expect(peer.body.details_redacted).toBe(true)
    expect(peer.body.formula_redacted).toBe(true)
    expect(schemeCategoryFields(peer.body).dye).toBeUndefined()
    expect(peer.body.technique ?? '').toBe('')
    expect(peer.text).not.toMatch(/Majirel/i)
    expect(peer.text).not.toMatch(/Балаяж/i)
  })

  test('phase2 B free master sees visit fact without technical details', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await ensureCompletedWithClient('master4@demo.local', 'client1@demo.local', 'Phase4')
    const started = await ensureInProgressForClient('premium1@demo.local', 'client1@demo.local', 'Phase4 Premium')
    await completeAppointmentApi(started.master.access_token, started.appt.id, PHASE2_FORMULA)

    const owner = await fetchScheme(started.master.access_token, started.appt.id)
    expect(owner.body.exists).toBe(true)
    expect(owner.body.omit_formula).toBe(true)
    expect(owner.body.skipped).toBe(false)
    expect(owner.body.details_redacted).toBe(false)
    expect(owner.body.formula_redacted).toBe(false)

    const free = await apiLogin('master4@demo.local')
    const peer = await fetchScheme(free.access_token, started.appt.id)
    expect(peer.status, peer.text).toBe(200)
    expect(peer.body.exists).toBe(true)
    expect(peer.body.details_redacted).toBe(true)
    expect(peer.body.formula_redacted).toBe(true)
    expect(schemeCategoryFields(peer.body).dye).toBeUndefined()
    expect(peer.body.components ?? []).toEqual([])
    expect(peer.text).not.toMatch(/Majirel/i)

    await loginUI(page, 'master4@demo.local')
    await page.goto(`/appointments/${started.appt.id}`)
    await expect(page.getByTestId('complete-appointment')).toHaveCount(0)
    await expect(page.getByTestId('formula-field')).toHaveCount(0)
  })

  test('phase2 C dispute does not mutate client card', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const started = await ensureInProgressForClient('premium1@demo.local', 'client1@demo.local', 'Phase4 Premium')
    await completeAppointmentApi(started.master.access_token, started.appt.id, {
      ...PHASE2_FORMULA,
      omit_formula: false,
    })

    const cardRes = await fetch(`${api}/v1/clients/appointment/${started.appt.id}`, {
      headers: { Authorization: `Bearer ${started.master.access_token}` },
    })
    expect(cardRes.ok, await cardRes.clone().text()).toBeTruthy()
    const before = await cardRes.json() as { id: string; preferences?: string; display_name?: string; phone?: string | null; email?: string | null }
    expect(before.id).toBeTruthy()

    await loginUI(page, 'premium1@demo.local')
    await page.goto(`/clients/by-appointment/${started.appt.id}`)
    await expect(page.getByTestId('dispute-open')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('dispute-open').click()
    await page.getByTestId('dispute-field').selectOption('preferences')
    await page.getByTestId('dispute-comment').fill(`E2E phase2 dispute ${Date.now()}`)
    await page.getByTestId('dispute-submit').click()
    await expect(page.getByTestId('dispute-success')).toBeVisible({ timeout: 15_000 })

    const afterRes = await fetch(`${api}/v1/clients/id/${before.id}`, {
      headers: { Authorization: `Bearer ${started.master.access_token}` },
    })
    expect(afterRes.ok).toBeTruthy()
    const after = await afterRes.json() as { preferences?: string; display_name?: string; phone?: string | null; email?: string | null }
    expect(after.preferences ?? '').toBe(before.preferences ?? '')
    expect(after.display_name).toBe(before.display_name)
    expect(after.phone ?? null).toBe(before.phone ?? null)
    expect(after.email ?? null).toBe(before.email ?? null)

    await page.getByRole('button', { name: 'Закрыть' }).click()
    await page.getByTestId('dispute-open').click()
    await page.getByTestId('dispute-field').selectOption('preferences')
    await page.getByTestId('dispute-comment').fill('duplicate open')
    await page.getByTestId('dispute-submit').click()
    await expect(page.getByTestId('dispute-success')).toContainText(/уже зарегистрировано/i)
  })

  test('phase3 A multiple work modes appear on calendar and reject overlap', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const master = await apiLogin('master1@demo.local')
    const headers = { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' }
    const orgsRes = await fetch(`${api}/v1/organizations/mine`, { headers })
    expect(orgsRes.ok, await orgsRes.clone().text()).toBeTruthy()
    const orgs = await orgsRes.json() as { items: Array<{ organization: { id: string }; branches: Array<{ id: string }> }> }
    const orgId = orgs.items[0].organization.id
    const branchId = orgs.items[0].branches[0].id
    const day = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10)
    const chairRes = await fetch(`${api}/v1/chairs`, {
      method: 'POST', headers,
      body: JSON.stringify({ organization_id: orgId, branch_id: branchId, name: `E2E chair ${Date.now()}`, listed_for_rent: true, rent_note: 'тест' }),
    })
    expect(chairRes.status, await chairRes.clone().text()).toBe(201)
    const chair = await chairRes.json() as { id: string }
    const chairIv = await fetch(`${api}/v1/me/work-mode-intervals`, {
      method: 'POST', headers,
      body: JSON.stringify({ mode: 'chair', chair_id: chair.id, starts_at: `${day}T10:00:00+07:00`, ends_at: `${day}T14:00:00+07:00`, timezone: 'Asia/Krasnoyarsk' }),
    })
    expect(chairIv.status, await chairIv.clone().text()).toBe(201)
    const overlap = await fetch(`${api}/v1/me/work-mode-intervals`, {
      method: 'POST', headers,
      body: JSON.stringify({ mode: 'onsite', city_id: '11111111-1111-4111-8111-111111111001', district_ids: ['11111111-1111-4111-8111-111111111011'], starts_at: `${day}T13:00:00+07:00`, ends_at: `${day}T18:00:00+07:00`, timezone: 'Asia/Krasnoyarsk' }),
    })
    expect(overlap.status).toBe(409)
    const onsite = await fetch(`${api}/v1/me/work-mode-intervals`, {
      method: 'POST', headers,
      body: JSON.stringify({ mode: 'onsite', city_id: '11111111-1111-4111-8111-111111111001', district_ids: ['11111111-1111-4111-8111-111111111011'], starts_at: `${day}T15:00:00+07:00`, ends_at: `${day}T20:00:00+07:00`, timezone: 'Asia/Krasnoyarsk' }),
    })
    expect(onsite.status, await onsite.clone().text()).toBe(201)
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await page.getByRole('button', { name: 'Месяц' }).click()
    const target = new Date(`${day}T12:00:00+07:00`)
    const now = new Date()
    const monthsAhead = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth())
    for (let i = 0; i < monthsAhead; i++) {
      await page.locator('.fc-next-button').click()
    }
    await expect(page.getByText('В салоне').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Выезд').first()).toBeVisible()
  })

  test('phase3 B onsite search matches district and date only', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const master = await apiLogin('master1@demo.local')
    const headers = { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' }
    const day = new Date(Date.now() + 13 * 86400000).toISOString().slice(0, 10)
    const created = await fetch(`${api}/v1/me/work-mode-intervals`, {
      method: 'POST', headers,
      body: JSON.stringify({
        mode: 'onsite',
        city_id: '11111111-1111-4111-8111-111111111001',
        district_ids: ['11111111-1111-4111-8111-111111111011'],
        starts_at: `${day}T12:00:00+07:00`,
        ends_at: `${day}T20:00:00+07:00`,
        timezone: 'Asia/Krasnoyarsk',
      }),
    })
    expect(created.status, await created.clone().text()).toBe(201)
    const hit = await fetch(`${api}/v1/masters?city=${encodeURIComponent('Красноярск')}&district_id=11111111-1111-4111-8111-111111111011&available_on=${day}`)
    expect(hit.ok).toBeTruthy()
    const hitBody = await hit.json() as { items: Array<{ user_id: string; onsite_match?: { badge: string } }> }
    expect(hitBody.items.some((m) => m.onsite_match?.badge)).toBeTruthy()
    const missDistrict = await fetch(`${api}/v1/masters?city=${encodeURIComponent('Красноярск')}&district_id=11111111-1111-4111-8111-111111111014&available_on=${day}`)
    const missBody = await missDistrict.json() as { items: Array<{ onsite_match?: unknown }> }
    expect(missBody.items.every((m) => !m.onsite_match)).toBeTruthy()
    const otherDay = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10)
    const missDay = await fetch(`${api}/v1/masters?city=${encodeURIComponent('Красноярск')}&district_id=11111111-1111-4111-8111-111111111011&available_on=${otherDay}`)
    const missDayBody = await missDay.json() as { items: Array<{ onsite_match?: unknown }> }
    expect(missDayBody.items.every((m) => !m.onsite_match)).toBeTruthy()
    await loginUI(page, 'client1@demo.local')
    await page.goto('/search')
    await page.locator('#city').fill('Красноярск')
    await page.locator('#available_on').fill(day)
    await page.locator('#district_id').selectOption('11111111-1111-4111-8111-111111111011')
    await page.getByRole('button', { name: 'Искать' }).click()
    await expect(page.getByTestId('onsite-badge').first()).toBeVisible({ timeout: 15_000 })
  })

  test('phase3 C chair rental then work interval for renter only', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const owner = await apiLogin('master1@demo.local')
    const renter = await apiLogin('master2@demo.local')
    const employee = await apiLogin('employee1@demo.local')
    const ownerH = { Authorization: `Bearer ${owner.access_token}`, 'Content-Type': 'application/json' }
    const renterH = { Authorization: `Bearer ${renter.access_token}`, 'Content-Type': 'application/json' }
    const empH = { Authorization: `Bearer ${employee.access_token}`, 'Content-Type': 'application/json' }
    const orgsRes = await fetch(`${api}/v1/organizations/mine`, { headers: ownerH })
    const orgs = await orgsRes.json() as { items: Array<{ organization: { id: string }; branches: Array<{ id: string }> }> }
    const orgId = orgs.items[0].organization.id
    const branchId = orgs.items[0].branches[0].id
    const chairRes = await fetch(`${api}/v1/chairs`, {
      method: 'POST', headers: ownerH,
      body: JSON.stringify({ organization_id: orgId, branch_id: branchId, name: `Rent ${Date.now()}`, listed_for_rent: true }),
    })
    expect(chairRes.status, await chairRes.clone().text()).toBe(201)
    const chair = await chairRes.json() as { id: string }
    const dayAt = (offset: number) => new Date(Date.now() + (110 + offset) * 86400000).toISOString().slice(0, 10)
    const steal = await fetch(`${api}/v1/me/work-mode-intervals`, {
      method: 'POST', headers: renterH,
      body: JSON.stringify({ mode: 'chair', chair_id: chair.id, starts_at: `${dayAt(0)}T10:00:00+07:00`, ends_at: `${dayAt(0)}T18:00:00+07:00`, timezone: 'Asia/Krasnoyarsk' }),
    })
    expect(steal.status).toBe(403)
    const staffOk = await fetch(`${api}/v1/me/work-mode-intervals`, {
      method: 'POST', headers: empH,
      body: JSON.stringify({ mode: 'chair', chair_id: chair.id, starts_at: `${dayAt(1)}T10:00:00+07:00`, ends_at: `${dayAt(1)}T12:00:00+07:00`, timezone: 'Asia/Krasnoyarsk' }),
    })
    expect(staffOk.status, await staffOk.clone().text()).toBe(201)
    const reqLease = await fetch(`${api}/v1/chairs/${chair.id}/leases`, {
      method: 'POST', headers: renterH,
      body: JSON.stringify({ starts_at: `${dayAt(3)}T00:00:00+07:00`, ends_at: `${dayAt(10)}T00:00:00+07:00` }),
    })
    expect(reqLease.status, await reqLease.clone().text()).toBe(201)
    const lease = await reqLease.json() as { id: string }
    const approve = await fetch(`${api}/v1/chair-leases/${lease.id}/approve`, { method: 'POST', headers: ownerH })
    expect(approve.status, await approve.clone().text()).toBe(200)
    const use = await fetch(`${api}/v1/me/work-mode-intervals`, {
      method: 'POST', headers: renterH,
      body: JSON.stringify({ mode: 'chair', chair_id: chair.id, starts_at: `${dayAt(4)}T10:00:00+07:00`, ends_at: `${dayAt(4)}T18:00:00+07:00`, timezone: 'Asia/Krasnoyarsk' }),
    })
    expect(use.status, await use.clone().text()).toBe(201)
    const afterLease = await fetch(`${api}/v1/me/work-mode-intervals`, {
      method: 'POST', headers: renterH,
      body: JSON.stringify({ mode: 'chair', chair_id: chair.id, starts_at: `${dayAt(40)}T10:00:00+07:00`, ends_at: `${dayAt(40)}T18:00:00+07:00`, timezone: 'Asia/Krasnoyarsk' }),
    })
    expect(afterLease.status).toBe(403)
    await loginUI(page, 'master1@demo.local')
    await page.goto('/salon/settings')
    await expect(page.getByTestId('chair-admin')).toBeVisible({ timeout: 15_000 })
  })

  test('phase3 D work_type and profession types stay independent', async () => {
    const master = await apiLogin('master1@demo.local')
    const res = await fetch(`${api}/v1/me/master`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    expect(res.ok).toBeTruthy()
    const body = await res.json() as { master?: { work_type?: string; profession_types?: unknown[] } }
    expect(body.master?.work_type).toBeTruthy()
    expect(Array.isArray(body.master?.profession_types)).toBeTruthy()
  })

  test('phase4 client-master messenger and unauthorized access', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const client = await apiLogin('client1@demo.local')
    const master = await apiLogin('master1@demo.local')
    const stranger = await apiLogin('client2@demo.local')
    const masterMe = await fetch(`${api}/v1/auth/me`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    const masterBody = await masterMe.json() as { id?: string }
    const masterUserId = masterBody.id
    expect(masterUserId).toBeTruthy()
    const profile = await fetch(`${api}/v1/me/master`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    const prof = await profile.json() as { master?: { id: string } }
    expect(prof.master?.id).toBeTruthy()

    await loginUI(page, 'client1@demo.local')
    await page.goto(`/masters/${prof.master!.id}`)
    await expect(page.getByTestId('write-master')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('write-master').click()
    await expect(page).toHaveURL(/\/messages\//, { timeout: 15_000 })
    const hello = `Здравствуйте, хочу записаться ${Date.now()}`
    await page.getByTestId('message-composer').fill(hello)
    await page.getByTestId('send-message').click()
    await expect(page.getByTestId('message-history').getByText(hello)).toBeVisible({ timeout: 10_000 })

    const list = await fetch(`${api}/v1/conversations`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    expect(list.ok).toBeTruthy()
    const convs = await list.json() as { items?: Array<{ id: string; unread_count: number }> }
    const conv = convs.items?.[0]
    expect(conv?.id).toBeTruthy()
    expect(conv!.unread_count).toBeGreaterThan(0)
    const forbidden = await fetch(`${api}/v1/conversations/${conv!.id}`, { headers: { Authorization: `Bearer ${stranger.access_token}` } })
    expect([403, 404]).toContain(forbidden.status)
    const forbiddenPost = await fetch(`${api}/v1/conversations/${conv!.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${stranger.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'hack' }),
    })
    expect([403, 404]).toContain(forbiddenPost.status)

    await page.goto('/profile')
    await page.getByRole('main').getByRole('button', { name: 'Выйти' }).click()
    await loginUI(page, 'master1@demo.local')
    await page.goto(`/messages/${conv!.id}`)
    await expect(page.getByTestId('message-history').getByText(hello)).toBeVisible({ timeout: 15_000 })
    const replyText = `Добрый день, буду рад помочь ${Date.now()}`
    await page.getByTestId('message-composer').fill(replyText)
    await page.getByTestId('send-message').click()
    await expect(page.getByTestId('message-history').getByText(replyText)).toBeVisible({ timeout: 10_000 })

    const clientList = await fetch(`${api}/v1/conversations/${conv!.id}/messages`, { headers: { Authorization: `Bearer ${client.access_token}` } })
    const msgs = await clientList.json() as { items?: Array<{ body: string }> }
    expect(msgs.items?.some((m) => m.body.includes(replyText))).toBeTruthy()
  })

  test('phase4 master-supplier messenger', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const suppliers = await fetch(`${api}/v1/suppliers`)
    expect(suppliers.ok).toBeTruthy()
    const body = await suppliers.json() as { items?: Array<{ id: string; name: string }> }
    const supplier = (body.items ?? []).find((s) => /профи/i.test(s.name)) ?? body.items?.[0]
    expect(supplier?.id).toBeTruthy()
    await loginUI(page, 'master1@demo.local')
    await page.goto(`/cosmetics/${supplier!.id}`)
    await expect(page.getByTestId('write-supplier')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('write-supplier').click()
    await expect(page).toHaveURL(/\/messages\//, { timeout: 15_000 })
    const ask = `Нужен прайс по красителям ${Date.now()}`
    await page.getByTestId('message-composer').fill(ask)
    await page.getByTestId('send-message').click()
    await expect(page.getByTestId('message-history').getByText(ask)).toBeVisible({ timeout: 10_000 })

    const supplierLogin = await apiLogin('supplier1@demo.local')
    const list = await fetch(`${api}/v1/conversations`, { headers: { Authorization: `Bearer ${supplierLogin.access_token}` } })
    const convs = await list.json() as { items?: Array<{ id: string }> }
    expect(convs.items?.[0]?.id).toBeTruthy()
    const replyBody = `Прайс отправим сегодня ${Date.now()}`
    const reply = await fetch(`${api}/v1/conversations/${convs.items![0].id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierLogin.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: replyBody }),
    })
    expect(reply.status, await reply.clone().text()).toBe(201)
    await page.goto(`/messages/${convs.items![0].id}`)
    await expect(page.getByTestId('message-history').getByText(replyBody)).toBeVisible({ timeout: 15_000 })
  })

  test('phase4 masterclass marketplace matching register and message', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const instructor = await apiLogin('master1@demo.local')
    const other = await apiLogin('employee1@demo.local')
    const created = await fetch(`${api}/v1/masterclasses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${instructor.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Колористика / сложное окрашивание',
        category: 'Колористика',
        description: 'E2E мастер-класс',
        city: 'Красноярск',
        location_note: 'Салон',
        starts_at: '2026-09-15T10:00:00+07:00',
        ends_at: '2026-09-15T14:00:00+07:00',
        timezone: 'Asia/Krasnoyarsk',
        capacity: 2,
      }),
    })
    expect(created.status, await created.clone().text()).toBe(201)
    const event = await created.json() as { id: string }
    const pub = await fetch(`${api}/v1/masterclasses/${event.id}/publish`, { method: 'POST', headers: { Authorization: `Bearer ${instructor.access_token}` } })
    expect(pub.ok, await pub.text()).toBeTruthy()
    const interest = await fetch(`${api}/v1/masterclass-interests`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${other.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'Колористика', city: 'Красноярск', date_from: '2026-09-15', date_to: '2026-09-15' }),
    })
    expect(interest.status, await interest.clone().text()).toBe(201)
    const matches = await fetch(`${api}/v1/masterclasses/${event.id}/matches`, { headers: { Authorization: `Bearer ${instructor.access_token}` } })
    const matchBody = await matches.json() as { items?: Array<{ category: string }> }
    expect(matchBody.items?.length).toBeGreaterThan(0)
    const afisha = await fetch(`${api}/v1/masterclasses`, { headers: { Authorization: `Bearer ${other.access_token}` } })
    const afishaBody = await afisha.json() as { items?: Array<{ id: string; relevant?: boolean; available_seats: number }> }
    const card = afishaBody.items?.find((i) => i.id === event.id)
    expect(card?.relevant).toBeTruthy()
    const seatsBefore = card!.available_seats
    const reg = await fetch(`${api}/v1/masterclasses/${event.id}/register`, { method: 'POST', headers: { Authorization: `Bearer ${other.access_token}` } })
    expect(reg.status, await reg.clone().text()).toBe(201)
    const dup = await fetch(`${api}/v1/masterclasses/${event.id}/register`, { method: 'POST', headers: { Authorization: `Bearer ${other.access_token}` } })
    expect(dup.status).toBe(409)
    const after = await fetch(`${api}/v1/masterclasses/${event.id}`, { headers: { Authorization: `Bearer ${other.access_token}` } })
    const afterBody = await after.json() as { available_seats: number; instructor_user_id: string }
    expect(afterBody.available_seats).toBe(seatsBefore - 1)
    const instructorMe = await fetch(`${api}/v1/auth/me`, { headers: { Authorization: `Bearer ${instructor.access_token}` } })
    const instructorId = ((await instructorMe.json()) as { id: string }).id
    const chat = await fetch(`${api}/v1/conversations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${other.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'masterclass', event_id: event.id, peer_user_id: instructorId }),
    })
    expect(chat.status, await chat.clone().text()).toBe(201)
    const regs = await fetch(`${api}/v1/masterclasses/${event.id}/registrations`, { headers: { Authorization: `Bearer ${instructor.access_token}` } })
    const regsBody = await regs.json() as { items?: Array<{ status: string }> }
    expect(regsBody.items?.some((r) => r.status === 'confirmed')).toBeTruthy()

    await loginUI(page, 'employee1@demo.local')
    await page.goto(`/masterclasses/${event.id}`)
    await expect(page.getByRole('heading', { name: /Колористика/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/мест/i)).toBeVisible()
  })

  test('phase4 model marketplace matching notify preference respond and book', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const client = await apiLogin('client1@demo.local')
    const master = await apiLogin('master1@demo.local')
    const save = await fetch(`${api}/v1/me/model-preferences`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        willing: true, notify: true, categories: ['Колористика'], city: 'Красноярск',
        date_from: '2026-09-15', date_to: '2026-09-15',
      }),
    })
    expect(save.ok, await save.text()).toBeTruthy()
    const created = await fetch(`${api}/v1/model-requests`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Требуется модель на окрашивание',
        category: 'Колористика',
        description: 'E2E модель',
        city: 'Красноярск',
        location_note: 'Салон',
        starts_at: '2026-09-15T11:00:00+07:00',
        ends_at: '2026-09-15T13:00:00+07:00',
        timezone: 'Asia/Krasnoyarsk',
        capacity: 1,
      }),
    })
    expect(created.status, await created.clone().text()).toBe(201)
    const req = await created.json() as { id: string }
    const pub = await fetch(`${api}/v1/model-requests/${req.id}/publish`, { method: 'POST', headers: { Authorization: `Bearer ${master.access_token}` } })
    expect(pub.ok, await pub.text()).toBeTruthy()
    const notes = await fetch(`${api}/v1/notifications`, { headers: { Authorization: `Bearer ${client.access_token}` } })
    const notesBody = await notes.json() as { items?: Array<{ type: string; entity_id: string }> }
    expect(notesBody.items?.some((n) => n.type === 'model_opportunity' && n.entity_id === req.id)).toBeTruthy()

    const off = await fetch(`${api}/v1/me/model-preferences`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ willing: true, notify: false }),
    })
    expect(off.ok).toBeTruthy()
    const created2 = await fetch(`${api}/v1/model-requests`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Модель без уведомления',
        category: 'Колористика',
        description: 'notify off',
        city: 'Красноярск',
        starts_at: '2026-09-15T15:00:00+07:00',
        ends_at: '2026-09-15T16:00:00+07:00',
        timezone: 'Asia/Krasnoyarsk',
        capacity: 1,
      }),
    })
    const req2 = await created2.json() as { id: string }
    await fetch(`${api}/v1/model-requests/${req2.id}/publish`, { method: 'POST', headers: { Authorization: `Bearer ${master.access_token}` } })
    const notesAfter = await fetch(`${api}/v1/notifications`, { headers: { Authorization: `Bearer ${client.access_token}` } })
    const notesAfterBody = await notesAfter.json() as { items?: Array<{ type: string; entity_id: string }> }
    expect(notesAfterBody.items?.some((n) => n.entity_id === req2.id)).toBeFalsy()

    const respond = await fetch(`${api}/v1/model-requests/${req.id}/respond`, { method: 'POST', headers: { Authorization: `Bearer ${client.access_token}` } })
    expect(respond.status, await respond.clone().text()).toBe(201)
    const resp = await respond.json() as { id: string }
    const masterMe = await fetch(`${api}/v1/auth/me`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    const masterId = ((await masterMe.json()) as { id: string }).id
    const chat = await fetch(`${api}/v1/conversations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'model_request', request_id: req.id, peer_user_id: masterId }),
    })
    expect(chat.status, await chat.clone().text()).toBe(201)
    const accept = await fetch(`${api}/v1/model-responses/${resp.id}/accept`, { method: 'POST', headers: { Authorization: `Bearer ${client.access_token}` } })
    expect(accept.ok, await accept.clone().text()).toBeTruthy()
    const final = await fetch(`${api}/v1/model-requests/${req.id}`, { headers: { Authorization: `Bearer ${client.access_token}` } })
    const finalBody = await final.json() as { status: string; available_slots: number; accepted_count: number }
    expect(finalBody.status).toBe('closed')
    expect(finalBody.available_slots).toBe(0)

    await loginUI(page, 'client1@demo.local')
    await page.goto('/models')
    await expect(page.getByRole('heading', { name: 'Модели' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('model-willing')).toBeVisible()
  })

  test('phase5 master warehouse receive consume adjust isolation', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')

    async function buyerOrg(token: string) {
      const res = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${token}` } })
      expect(res.ok).toBeTruthy()
      const body = await res.json() as { items?: Array<{ organization: { id: string; type: string }; branches?: Array<{ id: string }> }> }
      const salon = (body.items ?? []).find((i) => i.organization.type !== 'supplier') ?? body.items?.[0]
      expect(salon?.organization.id).toBeTruthy()
      return { orgId: salon!.organization.id, branchId: salon!.branches?.[0]?.id ?? '' }
    }

    async function inventory(token: string, orgId: string) {
      const res = await fetch(`${api}/v1/me/inventory?organization_id=${orgId}`, { headers: { Authorization: `Bearer ${token}` } })
      expect(res.ok, await res.clone().text()).toBeTruthy()
      return res.json() as Promise<{
        location: { id: string; kind: string; owner_user_id?: string }
        items: Array<{ product_id: string; available: number; product_name: string; brand?: string }>
      }>
    }

    async function deliverOrder(masterToken: string, supplierToken: string, opts: {
      buyerOrgId: string
      locationId: string
      branchId: string
      supplierOrgId: string
      productId: string
      qty: number
      comment: string
    }) {
      const created = await fetch(`${api}/v1/commerce/supplier-orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${masterToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyer_org_id: opts.buyerOrgId,
          supplier_org_id: opts.supplierOrgId,
          location_id: opts.locationId,
          destination_branch_id: opts.branchId,
          payment_method: 'cash',
          comment: opts.comment,
          items: [{ product_id: opts.productId, qty: opts.qty }],
        }),
      })
      expect(created.status, await created.clone().text()).toBeLessThan(300)
      const order = await created.json() as { id: string }
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/transition`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      })
      const windowStart = new Date(Date.now() + 2 * 3600_000).toISOString()
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/delivery/schedule`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ window_start: windowStart, window_end: new Date(Date.now() + 5 * 3600_000).toISOString(), planned_delivery_at: windowStart }),
      })
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/transition`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'picking', estimated_delivery_at: new Date(Date.now() + 86400_000).toISOString() }),
      })
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/transition`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ready_for_dispatch' }),
      })
      for (const step of ['in-transit', 'arrived', 'delivered']) {
        const r = await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/delivery/${step}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
          body: '{}',
        })
        expect(r.ok, `${step} ${await r.text()}`).toBeTruthy()
      }
      return order.id
    }

    const master = await apiLogin('master2@demo.local')
    const supplier = await apiLogin('supplier1@demo.local')
    const employee = await apiLogin('employee1@demo.local')
    const other = await apiLogin('master1@demo.local')
    const { orgId, branchId } = await buyerOrg(master.access_token)
    const inv = await inventory(master.access_token, orgId)
    expect(inv.location.kind).toBe('master')

    const supOrgs = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${supplier.access_token}` } })
    const supBody = await supOrgs.json() as { items?: Array<{ organization: { id: string; type: string } }> }
    const supplierOrgId = (supBody.items ?? []).find((i) => i.organization.type === 'supplier')?.organization.id
    expect(supplierOrgId).toBeTruthy()
    const products = await fetch(`${api}/v1/commerce/products?organization_id=${supplierOrgId}`, { headers: { Authorization: `Bearer ${supplier.access_token}` } })
    const prodBody = await products.json() as { items?: Array<{ id: string; sku?: string; name: string }> }
    const product = (prodBody.items ?? []).find((p) => p.sku === 'S1-LOR-MAJ-001') ?? prodBody.items?.[0]
    expect(product?.id).toBeTruthy()
    const baseline = inv.items.find((i) => i.product_id === product!.id)?.available ?? 0
    const expectQty = (n: number) => String(baseline + n)

    const locRes = await fetch(`${api}/v1/commerce/locations?organization_id=${supplierOrgId}`, { headers: { Authorization: `Bearer ${supplier.access_token}` } })
    const locBody = await locRes.json() as { items?: Array<{ id: string; kind: string }> }
    const supLoc = (locBody.items ?? []).find((l) => l.kind === 'supplier')?.id
    expect(supLoc).toBeTruthy()
    await fetch(`${api}/v1/commerce/stock/movements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_id: supLoc, product_id: product!.id, kind: 'receipt', qty: 200, reason: 'e2e phase5' }),
    })

    const comment = `E2E phase5 receive ${Date.now()}`
    const orderId = await deliverOrder(master.access_token, supplier.access_token, {
      buyerOrgId: orgId,
      locationId: inv.location.id,
      branchId,
      supplierOrgId: supplierOrgId!,
      productId: product!.id,
      qty: 100,
      comment,
    })

    await loginUI(page, 'master2@demo.local')
    await page.goto('/inventory')
    await expect(page.getByRole('heading', { name: 'Мой склад' })).toBeVisible({ timeout: 15_000 })
    const beforeName = `${product!.name}`

    await page.goto('/inventory/receipts')
    await expect(page.getByRole('heading', { name: 'Поставки / На приёмке' })).toBeVisible({ timeout: 15_000 })
    const card = page.getByTestId('pending-receipt').filter({ hasText: comment })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await card.getByTestId('open-receipt').click()
    await expect(page.getByTestId('receipt-form')).toBeVisible()
    await page.getByTestId('qty-accepted').fill('80')
    await page.getByTestId('qty-damaged').fill('10')
    await page.getByTestId('qty-rejected').fill('10')
    await page.getByTestId('item-checked').check()
    await page.getByTestId('commit-receipt').click()
    await expect(page.getByTestId('receipt-summary')).toBeVisible()
    await page.getByTestId('confirm-receipt').click()
    await expect(page).toHaveURL(/\/inventory/, { timeout: 15_000 })
    await expect(page.getByTestId('stock-item').filter({ hasText: beforeName })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('stock-item').filter({ hasText: beforeName })).toContainText(new RegExp(expectQty(80)))

    const dup = await fetch(`${api}/v1/commerce/supplier-orders/${orderId}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ product_id: product!.id, qty_accepted: 80, qty_damaged: 10, qty_rejected: 10 }] }),
    })
    expect(dup.ok, await dup.clone().text()).toBeTruthy()
    const afterDup = await inventory(master.access_token, orgId)
    const line = afterDup.items.find((i) => i.product_id === product!.id)
    expect(line?.available).toBe(baseline + 80)

    await page.getByTestId('stock-item').filter({ hasText: beforeName }).click()
    await expect(page.getByTestId('stock-detail')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('stock-available')).toContainText(expectQty(80))
    await expect(page.getByTestId('stock-movement').filter({ hasText: 'Приёмка' }).first()).toBeVisible()

    const consumeTx = `e2e-consume-${Date.now()}`
    const consume = await fetch(`${api}/v1/me/inventory/consume`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: orgId,
        product_id: product!.id,
        qty: 30,
        appointment_id: '00000000-0000-0000-0000-000000000456',
        idempotency_key: consumeTx,
        reason: 'e2e расход',
      }),
    })
    expect(consume.status, await consume.clone().text()).toBe(200)
    const afterConsume = await inventory(master.access_token, orgId)
    expect(afterConsume.items.find((i) => i.product_id === product!.id)?.available).toBe(baseline + 50)
    const dupConsume = await fetch(`${api}/v1/me/inventory/consume`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: orgId,
        product_id: product!.id,
        qty: 30,
        appointment_id: '00000000-0000-0000-0000-000000000456',
        idempotency_key: consumeTx,
        reason: 'e2e расход',
      }),
    })
    expect(dupConsume.status).toBe(200)
    expect((await inventory(master.access_token, orgId)).items.find((i) => i.product_id === product!.id)?.available).toBe(baseline + 50)
    const tooMuch = (afterConsume.items.find((i) => i.product_id === product!.id)?.available ?? 0) + 10
    const over = await fetch(`${api}/v1/me/inventory/consume`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id: orgId, product_id: product!.id, qty: tooMuch, reason: 'too much' }),
    })
    expect(over.status).toBe(409)
    const overBody = await over.json() as { error?: { code?: string; message?: string } }
    expect(overBody.error?.code).toBe('insufficient_stock')
    expect((await inventory(master.access_token, orgId)).items.find((i) => i.product_id === product!.id)?.available).toBe(baseline + 50)

    await page.goto(`/inventory/${product!.id}`)
    await page.getByTestId('adjust-qty').fill('-10')
    await page.getByTestId('adjust-reason').fill('инвентаризация e2e')
    await page.getByTestId('adjust-submit').click()
    await expect(page.getByText('Остаток скорректирован')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('stock-available')).toContainText(expectQty(40))
    await expect(page.getByTestId('stock-movement').filter({ hasText: 'Корректировка' }).first()).toBeVisible()

    const empOrg = await buyerOrg(employee.access_token)
    const empInv = await fetch(`${api}/v1/me/inventory?organization_id=${orgId}`, { headers: { Authorization: `Bearer ${employee.access_token}` } })
    expect(empInv.status).not.toBe(200)
    const empOwn = await inventory(employee.access_token, empOrg.orgId)
    expect(empOwn.items.some((i) => i.product_id === product!.id && i.available === baseline + 40)).toBeFalsy()
    const otherStock = await fetch(`${api}/v1/commerce/stock?location_id=${inv.location.id}`, { headers: { Authorization: `Bearer ${other.access_token}` } })
    expect(otherStock.status).not.toBe(200)
    const supplierStock = await fetch(`${api}/v1/commerce/stock?location_id=${inv.location.id}`, { headers: { Authorization: `Bearer ${supplier.access_token}` } })
    expect(supplierStock.status).not.toBe(200)

    const { master: mTok, appt } = await ensureInProgressForClient('master2@demo.local', 'client1@demo.local', 'стрижк')
    await completeAppointmentApi(mTok.access_token, appt.id, {
      skipped: false,
      technique: 'Стрижка e2e',
      notes: 'phase5 consume ui',
      category_fields: { technique: 'Стрижка e2e', length: 'средняя' },
      components: [{ name: 'Машинка', qty: '1', unit: 'шт' }],
    })
    await page.goto(`/appointments/${appt.id}`)
    await expect(page.getByTestId('used-materials')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('consume-product').selectOption(product!.id)
    await page.getByTestId('consume-qty').fill('5')
    await page.getByTestId('consume-submit').click()
    await expect(page.getByText('Списано со склада')).toBeVisible({ timeout: 10_000 })
    expect((await inventory(master.access_token, orgId)).items.find((i) => i.product_id === product!.id)?.available).toBe(baseline + 35)
  })

  test('phase6 supply receiving accept history', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')

    async function buyerOrg(token: string) {
      const res = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${token}` } })
      expect(res.ok).toBeTruthy()
      const body = await res.json() as { items?: Array<{ organization: { id: string; type: string }; branches?: Array<{ id: string }> }> }
      const salon = (body.items ?? []).find((i) => i.organization.type !== 'supplier') ?? body.items?.[0]
      expect(salon?.organization.id).toBeTruthy()
      return { orgId: salon!.organization.id, branchId: salon!.branches?.[0]?.id ?? '' }
    }

    async function inventory(token: string, orgId: string) {
      const res = await fetch(`${api}/v1/me/inventory?organization_id=${orgId}`, { headers: { Authorization: `Bearer ${token}` } })
      expect(res.ok, await res.clone().text()).toBeTruthy()
      return res.json() as Promise<{
        location: { id: string; kind: string }
        items: Array<{ product_id: string; available: number; product_name: string }>
      }>
    }

    async function deliverOrder(masterToken: string, supplierToken: string, opts: {
      buyerOrgId: string
      locationId: string
      branchId: string
      supplierOrgId: string
      productId: string
      qty: number
      comment: string
    }) {
      const created = await fetch(`${api}/v1/commerce/supplier-orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${masterToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyer_org_id: opts.buyerOrgId,
          supplier_org_id: opts.supplierOrgId,
          location_id: opts.locationId,
          destination_branch_id: opts.branchId,
          payment_method: 'cash',
          comment: opts.comment,
          items: [{ product_id: opts.productId, qty: opts.qty }],
        }),
      })
      expect(created.status, await created.clone().text()).toBeLessThan(300)
      const order = await created.json() as { id: string }
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/transition`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      })
      const windowStart = new Date(Date.now() + 2 * 3600_000).toISOString()
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/delivery/schedule`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ window_start: windowStart, window_end: new Date(Date.now() + 5 * 3600_000).toISOString(), planned_delivery_at: windowStart }),
      })
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/transition`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'picking', estimated_delivery_at: new Date(Date.now() + 86400_000).toISOString() }),
      })
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/transition`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ready_for_dispatch' }),
      })
      for (const step of ['in-transit', 'arrived', 'delivered']) {
        const r = await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/delivery/${step}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
          body: '{}',
        })
        expect(r.ok, `${step} ${await r.text()}`).toBeTruthy()
      }
      return order.id
    }

    const master = await apiLogin('master2@demo.local')
    const supplier = await apiLogin('supplier1@demo.local')
    const other = await apiLogin('master1@demo.local')
    const { orgId, branchId } = await buyerOrg(master.access_token)
    const inv = await inventory(master.access_token, orgId)
    expect(inv.location.kind).toBe('master')

    const supOrgs = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${supplier.access_token}` } })
    const supBody = await supOrgs.json() as { items?: Array<{ organization: { id: string; type: string } }> }
    const supplierOrgId = (supBody.items ?? []).find((i) => i.organization.type === 'supplier')?.organization.id
    expect(supplierOrgId).toBeTruthy()
    const products = await fetch(`${api}/v1/commerce/products?organization_id=${supplierOrgId}`, { headers: { Authorization: `Bearer ${supplier.access_token}` } })
    const prodBody = await products.json() as { items?: Array<{ id: string; sku?: string; name: string }> }
    const product = (prodBody.items ?? []).find((p) => p.sku === 'S1-LOR-MAJ-001') ?? prodBody.items?.[0]
    expect(product?.id).toBeTruthy()
    const locRes = await fetch(`${api}/v1/commerce/locations?organization_id=${supplierOrgId}`, { headers: { Authorization: `Bearer ${supplier.access_token}` } })
    const locBody = await locRes.json() as { items?: Array<{ id: string; kind: string }> }
    const supLoc = (locBody.items ?? []).find((l) => l.kind === 'supplier')?.id
    await fetch(`${api}/v1/commerce/stock/movements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_id: supLoc, product_id: product!.id, kind: 'receipt', qty: 80, reason: 'e2e phase6' }),
    })

    const stockOf = async () => {
      const cur = await inventory(master.access_token, orgId)
      return cur.items.find((i) => i.product_id === product!.id)?.available ?? 0
    }
    const baseline = await stockOf()

    const commentA = `E2E phase6 A ${Date.now()}`
    const orderA = await deliverOrder(master.access_token, supplier.access_token, {
      buyerOrgId: orgId, locationId: inv.location.id, branchId, supplierOrgId: supplierOrgId!, productId: product!.id, qty: 10, comment: commentA,
    })

    await loginUI(page, 'master2@demo.local')
    await page.goto('/inventory/receipts')
    await expect(page.getByRole('heading', { name: 'Поставки / На приёмке' })).toBeVisible({ timeout: 15_000 })
    const card = page.getByTestId('pending-receipt').filter({ hasText: commentA })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.getByText(/позиций/)).toBeVisible()
    await card.getByTestId('open-receipt').click()
    await expect(page.getByTestId('receipt-form')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('receipt-item')).toBeVisible()
    await expect(page.getByTestId('commit-receipt')).toBeDisabled()
    await page.getByTestId('qty-accepted').fill('6')
    await page.getByTestId('qty-damaged').fill('2')
    await page.getByTestId('qty-rejected').fill('2')
    await expect(page.getByTestId('receipt-totals')).toContainText('В склад: 6')
    await page.getByTestId('item-checked').check()
    await expect(page.getByTestId('commit-receipt')).toBeEnabled()
    await page.getByTestId('commit-receipt').click()
    await expect(page.getByTestId('receipt-summary')).toBeVisible()
    await page.getByTestId('confirm-receipt').click()
    await expect(page).toHaveURL(/\/inventory$/, { timeout: 15_000 })
    expect(await stockOf()).toBe(baseline + 6)

    await page.goto(`/inventory/${product!.id}`)
    await expect(page.getByTestId('stock-movement').filter({ hasText: 'Приёмка' }).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('stock-movement').filter({ hasText: `заказ #${orderA.slice(0, 8)}` }).first()).toBeVisible()

    const dup = await fetch(`${api}/v1/commerce/supplier-orders/${orderA}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ product_id: product!.id, qty_accepted: 6, qty_damaged: 2, qty_rejected: 2 }] }),
    })
    expect(dup.ok, await dup.clone().text()).toBeTruthy()
    expect(await stockOf()).toBe(baseline + 6)

    const commentC = `E2E phase6 C ${Date.now()}`
    const orderC = await deliverOrder(master.access_token, supplier.access_token, {
      buyerOrgId: orgId, locationId: inv.location.id, branchId, supplierOrgId: supplierOrgId!, productId: product!.id, qty: 10, comment: commentC,
    })
    const beforeC = await stockOf()
    const first = await fetch(`${api}/v1/commerce/supplier-orders/${orderC}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ product_id: product!.id, qty_accepted: 6, qty_damaged: 0, qty_rejected: 0 }] }),
    })
    expect(first.status, await first.clone().text()).toBe(200)
    expect(await stockOf()).toBe(beforeC + 6)
    const second = await fetch(`${api}/v1/commerce/supplier-orders/${orderC}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ product_id: product!.id, qty_accepted: 4, qty_damaged: 0, qty_rejected: 0 }] }),
    })
    expect(second.status, await second.clone().text()).toBe(200)
    expect(await stockOf()).toBe(beforeC + 10)

    const commentD = `E2E phase6 D ${Date.now()}`
    const orderD = await deliverOrder(master.access_token, supplier.access_token, {
      buyerOrgId: orgId, locationId: inv.location.id, branchId, supplierOrgId: supplierOrgId!, productId: product!.id, qty: 10, comment: commentD,
    })
    const beforeD = await stockOf()
    const invalid = await fetch(`${api}/v1/commerce/supplier-orders/${orderD}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ product_id: product!.id, qty_accepted: 8, qty_damaged: 2, qty_rejected: 2 }] }),
    })
    expect([400, 422]).toContain(invalid.status)
    expect(await stockOf()).toBe(beforeD)

    const forbidden = await fetch(`${api}/v1/commerce/supplier-orders/${orderD}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${other.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ product_id: product!.id, qty_accepted: 1 }] }),
    })
    expect(forbidden.status).toBe(403)
    const supplierForbidden = await fetch(`${api}/v1/commerce/supplier-orders/${orderD}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ product_id: product!.id, qty_accepted: 1 }] }),
    })
    expect(supplierForbidden.status).toBe(403)
    expect(await stockOf()).toBe(beforeD)

    const commentF = `E2E phase6 F ${Date.now()}`
    const orderF = await deliverOrder(master.access_token, supplier.access_token, {
      buyerOrgId: orgId, locationId: inv.location.id, branchId, supplierOrgId: supplierOrgId!, productId: product!.id, qty: 10, comment: commentF,
    })
    const beforeF = await stockOf()
    const idem = `e2e-phase6-${Date.now()}`
    const payload = { idempotency_key: idem, items: [{ product_id: product!.id, qty_accepted: 6, qty_damaged: 0, qty_rejected: 0 }] }
    const [r1, r2] = await Promise.all([
      fetch(`${api}/v1/commerce/supplier-orders/${orderF}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json', 'Idempotency-Key': idem },
        body: JSON.stringify(payload),
      }),
      fetch(`${api}/v1/commerce/supplier-orders/${orderF}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json', 'Idempotency-Key': idem },
        body: JSON.stringify(payload),
      }),
    ])
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(await stockOf()).toBe(beforeF + 6)

    await page.goto('/inventory/receipts')
    await page.getByTestId('receipts-history-tab').click()
    await expect(page.getByTestId('receipt-history-item').filter({ hasText: commentA }).first()).toBeVisible({ timeout: 15_000 })
  })

  test('phase7 smart repeat booking resource availability', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    test.setTimeout(180_000)

    async function buyerOrg(token: string) {
      const res = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${token}` } })
      expect(res.ok).toBeTruthy()
      const body = await res.json() as { items?: Array<{ organization: { id: string; type: string }; branches?: Array<{ id: string }> }> }
      const salon = (body.items ?? []).find((i) => i.organization.type !== 'supplier') ?? body.items?.[0]
      expect(salon?.organization.id).toBeTruthy()
      return { orgId: salon!.organization.id, branchId: salon!.branches?.[0]?.id ?? '' }
    }

    async function inventory(token: string, orgId: string) {
      const res = await fetch(`${api}/v1/me/inventory?organization_id=${orgId}`, { headers: { Authorization: `Bearer ${token}` } })
      expect(res.ok, await res.clone().text()).toBeTruthy()
      return res.json() as Promise<{
        location: { id: string; kind: string }
        items: Array<{ product_id: string; available: number }>
      }>
    }

    async function deliverOrder(masterToken: string, supplierToken: string, opts: {
      buyerOrgId: string
      locationId: string
      branchId: string
      supplierOrgId: string
      productId: string
      qty: number
      comment: string
    }) {
      const created = await fetch(`${api}/v1/commerce/supplier-orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${masterToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyer_org_id: opts.buyerOrgId,
          supplier_org_id: opts.supplierOrgId,
          location_id: opts.locationId,
          destination_branch_id: opts.branchId,
          payment_method: 'cash',
          comment: opts.comment,
          items: [{ product_id: opts.productId, qty: opts.qty }],
        }),
      })
      expect(created.status, await created.clone().text()).toBeLessThan(300)
      const order = await created.json() as { id: string }
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/transition`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      })
      const windowStart = new Date(Date.now() + 2 * 3600_000).toISOString()
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/delivery/schedule`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ window_start: windowStart, window_end: new Date(Date.now() + 5 * 3600_000).toISOString(), planned_delivery_at: windowStart }),
      })
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/transition`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'picking', estimated_delivery_at: new Date(Date.now() + 86400_000).toISOString() }),
      })
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/transition`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ready_for_dispatch' }),
      })
      for (const step of ['in-transit', 'arrived', 'delivered']) {
        const r = await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/delivery/${step}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
          body: '{}',
        })
        expect(r.ok, `${step} ${await r.text()}`).toBeTruthy()
      }
      return order.id
    }

    function toDatetimeLocal(iso: string) {
      const d = new Date(iso)
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    const master = await apiLogin('master2@demo.local')
    const supplier = await apiLogin('supplier1@demo.local')
    const other = await apiLogin('master1@demo.local')
    const client = await apiLogin('client1@demo.local')
    const clientId = await authUserId(client.access_token)
    const { orgId, branchId } = await buyerOrg(master.access_token)

    const supOrgs = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${supplier.access_token}` } })
    const supBody = await supOrgs.json() as { items?: Array<{ organization: { id: string; type: string } }> }
    const supplierOrgId = (supBody.items ?? []).find((i) => i.organization.type === 'supplier')?.organization.id
    expect(supplierOrgId).toBeTruthy()

    const createdProduct = await fetch(`${api}/v1/commerce/products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: supplierOrgId,
        name: 'Phase7 Majirel 7.1',
        brand: "L'Oreal",
        sku: `P7-${Date.now()}`,
        unit: 'ml',
        price_minor: 12000,
        currency: 'RUB',
        published: true,
      }),
    })
    expect(createdProduct.status, await createdProduct.clone().text()).toBeLessThan(300)
    const product = await createdProduct.json() as { id: string; name?: string }

    const locRes = await fetch(`${api}/v1/commerce/locations?organization_id=${supplierOrgId}`, { headers: { Authorization: `Bearer ${supplier.access_token}` } })
    const locBody = await locRes.json() as { items?: Array<{ id: string; kind: string }> }
    const supLoc = (locBody.items ?? []).find((l) => l.kind === 'supplier')?.id
    expect(supLoc).toBeTruthy()
    await fetch(`${api}/v1/commerce/stock/movements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_id: supLoc, product_id: product.id, kind: 'receipt', qty: 200, reason: 'e2e phase7 supplier stock' }),
    })

    const started = await ensureInProgressForClient('master2@demo.local', 'client1@demo.local', 'укладк')
    const liveRes = await fetch(`${api}/v1/appointments/${started.appt.id}`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    expect(liveRes.ok).toBeTruthy()
    const live = await liveRes.json() as { id: string; service_id: string }
    const norm = await fetch(`${api}/v1/commerce/norms`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id: orgId, service_id: live.service_id, product_id: product.id, qty: 30, required: true }),
    })
    expect(norm.status, await norm.clone().text()).toBeLessThan(300)
    await completeAppointmentApi(started.master.access_token, started.appt.id, {
      technique: 'Phase7 окрашивание',
      skipped: false,
      omit_formula: false,
      notes: 'phase7 repeat source',
      category_fields: { dye: 'Majirel 7.1', oxidizer: '6%', proportions: '1:1.5' },
      components: [{ name: 'Majirel 7.1', brand: "L'Oreal", qty: '30', unit: 'мл' }],
    })
    const sourceId = started.appt.id
    const apptRes = await fetch(`${api}/v1/appointments/${sourceId}`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    expect(apptRes.ok).toBeTruthy()
    const source = await apptRes.json() as { id: string; status: string; service_id: string; service_name: string; starts_at: string; price_minor: number }
    expect(source.status).toBe('completed')

    const inv = await inventory(master.access_token, orgId)
    expect(inv.location.kind).toBe('master')
    const stockOf = async (productId = product.id) => (await inventory(master.access_token, orgId)).items.find((i) => i.product_id === productId)?.available ?? 0
    async function setStock(target: number, productId = product.id) {
      const cur = await stockOf(productId)
      const delta = target - cur
      if (Math.abs(delta) < 0.001) return
      const adj = await fetch(`${api}/v1/me/inventory/adjust`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: orgId, product_id: productId, qty: delta, reason: 'phase7 e2e stock' }),
      })
      expect(adj.ok, await adj.text()).toBeTruthy()
    }
    async function coverOtherNorms(serviceId: string) {
      const res = await fetch(`${api}/v1/commerce/norms?organization_id=${orgId}&service_id=${serviceId}`, {
        headers: { Authorization: `Bearer ${master.access_token}` },
      })
      expect(res.ok, await res.clone().text()).toBeTruthy()
      const body = await res.json() as { items?: Array<{ product_id: string; qty: number }> }
      for (const n of body.items ?? []) {
        if (n.product_id === product.id) continue
        await setStock((n.qty ?? 0) + 50, n.product_id)
      }
    }

    type Preview = {
      can_repeat: boolean
      availability_status?: string
      source_appointment_id: string
      service: string
      formula_hidden?: boolean
      requirements: Array<{ product_id: string; required_qty: number; available_qty: number; incoming_qty: number; shortage_qty: number; status: string }>
      components?: Array<{ name?: string }>
    }
    async function previewAs(token: string) {
      const res = await fetch(`${api}/v1/appointments/${sourceId}/repeat-preview`, { headers: { Authorization: `Bearer ${token}` } })
      return { status: res.status, text: await res.text() }
    }
    async function optionsAs(token: string, cid: string) {
      const res = await fetch(`${api}/v1/me/clients/${cid}/repeat-options`, { headers: { Authorization: `Bearer ${token}` } })
      const text = await res.text()
      let body: { item: Preview | null } = { item: null }
      try { body = JSON.parse(text) as typeof body } catch { /* ignore */ }
      return { status: res.status, text, body }
    }

    await setStock(40)
    await coverOtherNorms(source.service_id)
    const beforeAvailable = await stockOf()
    const avail = await previewAs(master.access_token)
    expect(avail.status, avail.text).toBe(200)
    const availBody = JSON.parse(avail.text) as Preview
    expect(availBody.source_appointment_id).toBe(sourceId)
    const reqLine = availBody.requirements.find((r) => r.product_id === product.id)
    expect(reqLine?.required_qty).toBe(30)
    expect(reqLine?.status).toBe('available')
    expect(availBody.can_repeat).toBe(true)
    expect(await stockOf()).toBe(beforeAvailable)
    const opts = await optionsAs(master.access_token, clientId)
    expect(opts.status).toBe(200)
    expect(opts.body.item?.source_appointment_id).toBe(sourceId)

    const schemeBefore = await fetchScheme(master.access_token, sourceId)
    const sourceBefore = { ...source }

    const cardRes = await fetch(`${api}/v1/clients/appointment/${sourceId}`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    expect(cardRes.ok, await cardRes.clone().text()).toBeTruthy()
    const card = await cardRes.json() as { id: string }

    const profile = await fetch(`${api}/v1/me/master`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    const prof = await profile.json() as { master?: { id: string; user_id?: string }; services?: Array<{ id: string; duration_minutes?: number }> }
    const duration = prof.services?.find((s) => s.id === source.service_id)?.duration_minutes ?? 45
    const masterUserId = await authUserId(master.access_token)
    let slotIso = ''
    for (let d = 2; d <= 16 && !slotIso; d++) {
      const day = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)
      const slotsRes = await fetch(`${api}/v1/masters/${masterUserId}/slots?date=${day}&duration_minutes=${duration}`)
      if (!slotsRes.ok) continue
      const slots = await slotsRes.json() as { items?: Array<{ starts_at: string }> }
      slotIso = slots.items?.[0]?.starts_at ?? ''
    }
    expect(slotIso).toBeTruthy()

    await loginUI(page, 'master2@demo.local')
    await page.goto(`/clients/${card.id}`)
    await expect(page.getByTestId('repeat-offer')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('repeat-offer').scrollIntoViewIfNeeded()
    await expect(page.getByRole('heading', { name: 'Как в прошлый раз' })).toBeVisible()
    await expect(page.getByTestId('repeat-summary')).toContainText('наличии')
    await page.getByTestId('repeat-open-preview').click()
    await expect(page.getByTestId('repeat-preview')).toBeVisible()
    await expect(page.getByTestId('repeat-requirement').first()).toBeVisible()
    await page.getByTestId('repeat-starts').fill(toDatetimeLocal(slotIso))
    await expect(page.getByTestId('repeat-use')).toBeEnabled({ timeout: 10_000 })
    await page.getByTestId('repeat-use').click()
    await expect(page.getByTestId('repeat-created')).toBeVisible({ timeout: 15_000 })
    expect(await stockOf()).toBe(beforeAvailable)

    const sourceAfter = await fetch(`${api}/v1/appointments/${sourceId}`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    const afterBody = await sourceAfter.json() as { id: string; status: string; service_name: string; starts_at: string; price_minor: number }
    expect(afterBody.status).toBe('completed')
    expect(afterBody.service_name).toBe(sourceBefore.service_name)
    expect(afterBody.price_minor).toBe(sourceBefore.price_minor)
    expect(afterBody.starts_at).toBe(sourceBefore.starts_at)
    const schemeAfter = await fetchScheme(master.access_token, sourceId)
    expect(schemeAfter.text).toBe(schemeBefore.text)

    await setStock(10)
    const beforeShortage = await stockOf()
    const short = await previewAs(master.access_token)
    const shortBody = JSON.parse(short.text) as Preview
    const shortLine = shortBody.requirements.find((r) => r.product_id === product.id)
    expect(shortLine?.status).toBe('orderable')
    expect(shortLine?.shortage_qty).toBe(20)
    expect(shortLine?.available_qty).toBe(10)
    expect(shortLine?.incoming_qty).toBe(0)
    expect(shortBody.can_repeat).toBe(false)
    expect(await stockOf()).toBe(beforeShortage)

    await page.reload()
    await expect(page.getByTestId('repeat-offer')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('repeat-summary')).toContainText('Не хватает')
    await page.getByTestId('repeat-open-preview').click()
    await expect(page.getByText(/нужно 30/)).toBeVisible()

    const incomingId = await deliverOrder(master.access_token, supplier.access_token, {
      buyerOrgId: orgId, locationId: inv.location.id, branchId, supplierOrgId: supplierOrgId!, productId: product.id, qty: 20, comment: `E2E phase7 incoming ${Date.now()}`,
    })
    expect(incomingId).toBeTruthy()
    const beforeIncoming = await stockOf()
    expect(beforeIncoming).toBe(10)
    const incomingPrev = JSON.parse((await previewAs(master.access_token)).text) as Preview
    const inLine = incomingPrev.requirements.find((r) => r.product_id === product.id)
    expect(inLine?.available_qty).toBe(10)
    expect(inLine?.incoming_qty).toBe(20)
    expect(inLine?.required_qty).toBe(30)
    expect(inLine?.status).toBe('incoming')
    expect(incomingPrev.can_repeat).toBe(false)
    expect(await stockOf()).toBe(10)

    await page.reload()
    await expect(page.getByTestId('repeat-offer')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('repeat-summary')).toContainText('поставк')

    const asClient = await optionsAs(client.access_token, clientId)
    expect(asClient.status).toBe(403)
    expect(asClient.text.toLowerCase()).not.toContain('oxidizer')
    expect(asClient.text.toLowerCase()).not.toContain('majirel')
    const asOther = await previewAs(other.access_token)
    expect(asOther.status).toBe(403)
    expect(asOther.text.toLowerCase()).not.toContain('oxidizer')
    expect(asOther.text.toLowerCase()).not.toContain('majirel')
    expect(asOther.text).not.toContain('components')

    const empty = await optionsAs(master.access_token, '00000000-0000-0000-0000-000000000099')
    expect(empty.status).toBe(200)
    expect(empty.body.item).toBeNull()

    await page.goto('/appointments')
    await expect(page.getByRole('heading', { name: /записи/i }).first()).toBeVisible({ timeout: 15_000 })
  })

  test('phase8 smart service provisioning availability', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    test.setTimeout(180_000)

    async function buyerOrg(token: string) {
      const res = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${token}` } })
      expect(res.ok).toBeTruthy()
      const body = await res.json() as { items?: Array<{ organization: { id: string; type: string }; branches?: Array<{ id: string }> }> }
      const salon = (body.items ?? []).find((i) => i.organization.type !== 'supplier') ?? body.items?.[0]
      expect(salon?.organization.id).toBeTruthy()
      return { orgId: salon!.organization.id, branchId: salon!.branches?.[0]?.id ?? '' }
    }

    async function inventory(token: string, orgId: string) {
      const res = await fetch(`${api}/v1/me/inventory?organization_id=${orgId}`, { headers: { Authorization: `Bearer ${token}` } })
      expect(res.ok, await res.clone().text()).toBeTruthy()
      return res.json() as Promise<{
        location: { id: string; kind: string }
        items: Array<{ product_id: string; available: number }>
      }>
    }

    async function deliverOrder(masterToken: string, supplierToken: string, opts: {
      buyerOrgId: string; locationId: string; branchId: string; supplierOrgId: string; productId: string; qty: number; comment: string
    }) {
      const created = await fetch(`${api}/v1/commerce/supplier-orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${masterToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyer_org_id: opts.buyerOrgId, supplier_org_id: opts.supplierOrgId, location_id: opts.locationId,
          destination_branch_id: opts.branchId, payment_method: 'cash', comment: opts.comment,
          items: [{ product_id: opts.productId, qty: opts.qty }],
        }),
      })
      expect(created.status, await created.clone().text()).toBeLessThan(300)
      const order = await created.json() as { id: string }
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/transition`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      })
      const windowStart = new Date(Date.now() + 2 * 3600_000).toISOString()
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/delivery/schedule`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ window_start: windowStart, window_end: new Date(Date.now() + 5 * 3600_000).toISOString(), planned_delivery_at: windowStart }),
      })
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/transition`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'picking', estimated_delivery_at: new Date(Date.now() + 86400_000).toISOString() }),
      })
      await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/transition`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ready_for_dispatch' }),
      })
      for (const step of ['in-transit', 'arrived', 'delivered']) {
        const r = await fetch(`${api}/v1/commerce/supplier-orders/${order.id}/delivery/${step}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' },
          body: '{}',
        })
        expect(r.ok, `${step} ${await r.text()}`).toBeTruthy()
      }
      return order.id
    }

    const master = await apiLogin('master2@demo.local')
    const supplier = await apiLogin('supplier1@demo.local')
    const other = await apiLogin('master1@demo.local')
    const employee = await apiLogin('employee1@demo.local')
    const client = await apiLogin('client1@demo.local')
    const { orgId, branchId } = await buyerOrg(master.access_token)
    const supOrgs = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${supplier.access_token}` } })
    const supBody = await supOrgs.json() as { items?: Array<{ organization: { id: string; type: string } }> }
    const supplierOrgId = (supBody.items ?? []).find((i) => i.organization.type === 'supplier')?.organization.id
    expect(supplierOrgId).toBeTruthy()

    const sku = `P8-${Date.now()}`
    const createdProduct = await fetch(`${api}/v1/commerce/products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: supplierOrgId, name: 'Phase8 Analyzer Dye', brand: 'Test',
        sku, unit: 'ml', price_minor: 11000, currency: 'RUB', published: true, for_sale: true,
      }),
    })
    expect(createdProduct.status, await createdProduct.clone().text()).toBeLessThan(300)
    const product = await createdProduct.json() as { id: string }

    const hiddenRes = await fetch(`${api}/v1/commerce/products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: supplierOrgId, name: 'Phase8 Hidden Dye', brand: 'Test',
        sku: `${sku}-U`, unit: 'ml', price_minor: 11000, currency: 'RUB', published: false, for_sale: false,
      }),
    })
    expect(hiddenRes.status, await hiddenRes.clone().text()).toBeLessThan(300)
    const hidden = await hiddenRes.json() as { id: string }

    const locRes = await fetch(`${api}/v1/commerce/locations?organization_id=${supplierOrgId}`, { headers: { Authorization: `Bearer ${supplier.access_token}` } })
    const locBody = await locRes.json() as { items?: Array<{ id: string; kind: string }> }
    const supLoc = (locBody.items ?? []).find((l) => l.kind === 'supplier')?.id
    expect(supLoc).toBeTruthy()
    await fetch(`${api}/v1/commerce/stock/movements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_id: supLoc, product_id: product.id, kind: 'receipt', qty: 200, reason: 'e2e phase8 supplier' }),
    })

    const started = await ensureInProgressForClient('master2@demo.local', 'client1@demo.local', 'укладк')
    const liveRes = await fetch(`${api}/v1/appointments/${started.appt.id}`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    const live = await liveRes.json() as { id: string; service_id: string }
    const norm = await fetch(`${api}/v1/commerce/norms`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id: orgId, service_id: live.service_id, product_id: product.id, qty: 30, required: true }),
    })
    expect(norm.status, await norm.clone().text()).toBeLessThan(300)

    const inv = await inventory(master.access_token, orgId)
    expect(inv.location.kind).toBe('master')
    const stockOf = async (productId = product.id) => (await inventory(master.access_token, orgId)).items.find((i) => i.product_id === productId)?.available ?? 0
    async function setStock(target: number, productId = product.id) {
      const cur = await stockOf(productId)
      const delta = target - cur
      if (Math.abs(delta) < 0.001) return
      const adj = await fetch(`${api}/v1/me/inventory/adjust`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: orgId, product_id: productId, qty: delta, reason: 'phase8 e2e stock' }),
      })
      expect(adj.ok, await adj.text()).toBeTruthy()
    }
    async function coverOtherNorms(serviceId: string) {
      const res = await fetch(`${api}/v1/commerce/norms?organization_id=${orgId}&service_id=${serviceId}`, {
        headers: { Authorization: `Bearer ${master.access_token}` },
      })
      const body = await res.json() as { items?: Array<{ product_id: string; qty: number }> }
      for (const n of body.items ?? []) {
        if (n.product_id === product.id || n.product_id === hidden.id) continue
        await setStock((n.qty ?? 0) + 50, n.product_id)
      }
    }
    type Line = {
      product_id: string; required_qty: number; on_hand: number
      available: number; incoming: number; shortage: number; status: string; orderable: boolean
    }
    type Analysis = {
      can_perform_now: boolean; items: Line[]
      alternative?: { available: boolean; reason?: string }
    }
    async function analyze(token: string, serviceId = live.service_id) {
      const qs = new URLSearchParams({ organization_id: orgId, service_id: serviceId })
      const res = await fetch(`${api}/v1/me/inventory/availability?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
      const text = await res.text()
      let body = { can_perform_now: false, items: [] as Line[] } as Analysis
      try { body = JSON.parse(text) as Analysis } catch { /* ignore */ }
      return { status: res.status, text, body }
    }
    const lineOf = (a: Analysis) => a.items.find((i) => i.product_id === product.id)

    await coverOtherNorms(live.service_id)
    await setStock(100)
    const demoA = await analyze(master.access_token)
    expect(demoA.status, demoA.text).toBe(200)
    expect(lineOf(demoA.body)?.status).toBe('available')
    expect(lineOf(demoA.body)?.required_qty).toBe(30)
    expect(demoA.body.can_perform_now).toBe(true)
    expect(demoA.text.toLowerCase()).not.toContain('oxidizer')

    await setStock(10)
    const demoB = await analyze(master.access_token)
    expect(lineOf(demoB.body)?.available).toBe(10)
    expect(lineOf(demoB.body)?.shortage).toBe(20)
    expect(lineOf(demoB.body)?.status).toBe('orderable')
    expect(lineOf(demoB.body)?.orderable).toBe(true)
    expect(demoB.body.can_perform_now).toBe(false)
    expect(await stockOf()).toBe(10)

    const incomingId = await deliverOrder(master.access_token, supplier.access_token, {
      buyerOrgId: orgId, locationId: inv.location.id, branchId, supplierOrgId: supplierOrgId!, productId: product.id, qty: 20,
      comment: `E2E phase8 incoming ${Date.now()}`,
    })
    const demoC = await analyze(master.access_token)
    expect(lineOf(demoC.body)?.available).toBe(10)
    expect(lineOf(demoC.body)?.incoming).toBe(20)
    expect(lineOf(demoC.body)?.status).toBe('incoming')
    expect(demoC.body.can_perform_now).toBe(false)
    expect(await stockOf()).toBe(10)

    const accept = await fetch(`${api}/v1/commerce/supplier-orders/${incomingId}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ product_id: product.id, qty_accepted: 20, qty_damaged: 0, qty_rejected: 0 }] }),
    })
    expect(accept.ok, await accept.clone().text()).toBeTruthy()
    expect(await stockOf()).toBe(30)
    expect(lineOf((await analyze(master.access_token)).body)?.status).toBe('available')

    await fetch(`${api}/v1/commerce/norms`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id: orgId, service_id: live.service_id, product_id: hidden.id, qty: 5, required: true }),
    })
    const demoE = await analyze(master.access_token)
    const hiddenLine = demoE.body.items.find((i) => i.product_id === hidden.id)
    expect(hiddenLine?.status).toBe('unavailable')
    expect(hiddenLine?.orderable).toBe(false)

    const asEmployee = await analyze(employee.access_token)
    expect(asEmployee.status).not.toBe(200)
    const asSupplier = await analyze(supplier.access_token)
    expect(asSupplier.status).not.toBe(200)
    const asClient = await analyze(client.access_token)
    expect(asClient.status).not.toBe(200)
    const asOther = await analyze(other.access_token)
    if (asOther.status === 200) {
      expect(lineOf(asOther.body)?.available ?? 0).not.toBe(10)
    }

    const locSalon = await fetch(`${api}/v1/commerce/locations?organization_id=${orgId}`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    const salonBody = await locSalon.json() as { items?: Array<{ id: string; kind: string }> }
    let salonLoc = (salonBody.items ?? []).find((l) => l.kind === 'salon')?.id
    if (!salonLoc) {
      const createdLoc = await fetch(`${api}/v1/commerce/locations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: orgId, name: 'Склад салона', kind: 'salon' }),
      })
      salonLoc = ((await createdLoc.json()) as { id: string }).id
    }
    await setStock(0)
    await fetch(`${api}/v1/commerce/stock/movements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_id: salonLoc, product_id: product.id, kind: 'receipt', qty: 500, reason: 'phase8 salon bait' }),
    })
    const demoJ = await analyze(master.access_token)
    expect(lineOf(demoJ.body)?.available ?? 0).toBe(0)
    expect(demoJ.body.alternative?.available).toBe(false)

    await completeAppointmentApi(started.master.access_token, live.id, {
      technique: 'Phase8', skipped: false, omit_formula: false, notes: 'phase8 consume',
      category_fields: { dye: 'hidden' }, components: [{ name: 'Majirel secret', qty: '30', unit: 'мл' }],
    })

    await setStock(40)
    await loginUI(page, 'master2@demo.local')
    await page.goto(`/appointments/${live.id}`)
    await expect(page.getByTestId('availability-indicator')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('availability-indicator').click()
    await expect(page.getByTestId('availability-panel')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('used-materials')).toBeVisible()

    const consumeKey = `e2e-p8-${Date.now()}`
    const consume = await fetch(`${api}/v1/me/inventory/consume`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: orgId, product_id: product.id, qty: 8, appointment_id: live.id,
        idempotency_key: consumeKey, reason: 'phase8 e2e consume',
      }),
    })
    expect(consume.status, await consume.clone().text()).toBe(200)
    expect(await stockOf()).toBe(32)
    const dupConsume = await fetch(`${api}/v1/me/inventory/consume`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: orgId, product_id: product.id, qty: 8, appointment_id: live.id,
        idempotency_key: consumeKey, reason: 'phase8 e2e consume',
      }),
    })
    expect(dupConsume.status).toBe(200)
    expect(await stockOf()).toBe(32)

    await setStock(10)
    const cardRes = await fetch(`${api}/v1/clients/appointment/${live.id}`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    const card = await cardRes.json() as { id: string }
    await page.goto(`/clients/${card.id}`)
    await expect(page.getByTestId('repeat-offer')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('repeat-open-preview').click()
    await expect(page.getByTestId('repeat-preview')).toBeVisible()
    await expect(page.getByTestId('repeat-requirement').first()).toBeVisible()
    const orderBtn = page.getByTestId('availability-order').first()
    if (await orderBtn.count()) {
      await orderBtn.click()
      await expect(page).toHaveURL(new RegExp(`/cosmetics/products/${product.id}`), { timeout: 15_000 })
    }
  })

  test('phase9 knowledge recommendations integration', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    test.setTimeout(180_000)

    function noLeak(raw: string) {
      const low = raw.toLowerCase()
      expect(low).not.toContain('qty_on_hand')
      expect(low).not.toContain('qty_reserved')
      expect(low).not.toContain('oxidizer')
      expect(low).not.toContain('"components"')
    }

    async function buyerOrg(token: string) {
      const res = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${token}` } })
      expect(res.ok).toBeTruthy()
      const body = await res.json() as { items?: Array<{ organization: { id: string; type: string }; branches?: Array<{ id: string }> }> }
      const salon = (body.items ?? []).find((i) => i.organization.type !== 'supplier') ?? body.items?.[0]
      expect(salon?.organization.id).toBeTruthy()
      return { orgId: salon!.organization.id, branchId: salon!.branches?.[0]?.id ?? '' }
    }

    async function inventory(token: string, orgId: string) {
      const res = await fetch(`${api}/v1/me/inventory?organization_id=${orgId}`, { headers: { Authorization: `Bearer ${token}` } })
      expect(res.ok, await res.clone().text()).toBeTruthy()
      return res.json() as Promise<{ items: Array<{ product_id: string; available: number }> }>
    }

    const master = await apiLogin('master2@demo.local')
    const other = await apiLogin('master1@demo.local')
    const supplier = await apiLogin('supplier1@demo.local')
    const { orgId } = await buyerOrg(master.access_token)
    const supOrgs = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${supplier.access_token}` } })
    const supBody = await supOrgs.json() as { items?: Array<{ organization: { id: string; type: string } }> }
    const supplierOrgId = (supBody.items ?? []).find((i) => i.organization.type === 'supplier')?.organization.id
    expect(supplierOrgId).toBeTruthy()

    // DEMO A — inventory → knowledge hub
    await loginUI(page, 'master2@demo.local')
    await page.goto('/inventory')
    await expect(page.getByRole('heading', { name: 'Мой склад' })).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('inventory-knowledge').first().click()
    await expect(page).toHaveURL(/\/knowledge/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'База знаний' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Колористика' })).toBeVisible()
    await page.getByTestId('kb-search').fill('Majirel')
    await page.getByRole('button', { name: 'Найти' }).click()
    const articleLink = page.getByRole('link', { name: /Majirel/i }).first()
    await expect(articleLink).toBeVisible({ timeout: 15_000 })
    await articleLink.click()
    await expect(page.locator('.prose-article')).toBeVisible({ timeout: 15_000 })

    const kbRes = await fetch(`${api}/v1/knowledge?q=${encodeURIComponent('Majirel')}&limit=5`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(kbRes.ok).toBeTruthy()
    const kb = await kbRes.json() as { items?: Array<{ id: string; product_id?: string | null; product_ids?: string[] }> }
    expect((kb.items ?? []).length).toBeGreaterThan(0)
    const linkedProduct = kb.items![0].product_id || kb.items![0].product_ids?.[0]
    expect(linkedProduct).toBeTruthy()

    const recRes = await fetch(`${api}/v1/me/knowledge/recommendations?product_id=${linkedProduct}`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    const recText = await recRes.text()
    expect(recRes.status, recText).toBe(200)
    noLeak(recText)
    const rec = JSON.parse(recText) as { items?: Array<{ id: string; title: string }> }
    expect((rec.items ?? []).length).toBeGreaterThan(0)

    const emptyRes = await fetch(`${api}/v1/me/knowledge/recommendations?product_id=00000000-0000-0000-0000-000000000099`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    const emptyText = await emptyRes.text()
    expect(emptyRes.status).toBe(200)
    const emptyBody = JSON.parse(emptyText) as { items?: unknown[]; empty_reason?: string }
    expect(emptyBody.items ?? []).toHaveLength(0)
    expect(emptyBody.empty_reason).toContain('нет сохранённой рекомендации')

    const otherRec = await fetch(`${api}/v1/me/knowledge/recommendations?product_id=${linkedProduct}`, {
      headers: { Authorization: `Bearer ${other.access_token}` },
    })
    const otherText = await otherRec.text()
    expect(otherRec.status).toBe(200)
    noLeak(otherText)

    const unauth = await fetch(`${api}/v1/me/knowledge/recommendations?product_id=${linkedProduct}`)
    expect([401, 403]).toContain(unauth.status)

    // DEMO B — product context
    await page.goto(`/cosmetics/products/${linkedProduct}`)
    await expect(page.getByTestId('product-knowledge')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Знания по этому продукту' })).toBeVisible()
    await expect(page.getByTestId('product-knowledge-item').first()).toBeVisible()

    const blankProduct = await fetch(`${api}/v1/commerce/products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: supplierOrgId, name: 'Phase9 Empty Knowledge Dye', brand: 'Test',
        sku: `P9E-${Date.now()}`, unit: 'ml', price_minor: 9000, currency: 'RUB', published: true, for_sale: true,
      }),
    })
    expect(blankProduct.status, await blankProduct.clone().text()).toBeLessThan(300)
    const blank = await blankProduct.json() as { id: string }
    await page.goto(`/cosmetics/products/${blank.id}`)
    await expect(page.getByTestId('product-knowledge-empty')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Сохранённых материалов по этому продукту пока нет.')).toBeVisible()

    // DEMO C/D/E/G — appointment availability → knowledge
    const started = await ensureInProgressForClient('master2@demo.local', 'client1@demo.local', 'укладк')
    const liveRes = await fetch(`${api}/v1/appointments/${started.appt.id}`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    const live = await liveRes.json() as { id: string; service_id: string; status: string; starts_at?: string }
    const beforeStatus = live.status

    const createdProduct = await fetch(`${api}/v1/commerce/products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: supplierOrgId, name: 'Phase9 Shortage Dye', brand: 'Test',
        sku: `P9S-${Date.now()}`, unit: 'ml', price_minor: 11000, currency: 'RUB', published: true, for_sale: true,
      }),
    })
    expect(createdProduct.status, await createdProduct.clone().text()).toBeLessThan(300)
    const product = await createdProduct.json() as { id: string }
    const norm = await fetch(`${api}/v1/commerce/norms`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id: orgId, service_id: live.service_id, product_id: product.id, qty: 30, required: true }),
    })
    expect(norm.status, await norm.clone().text()).toBeLessThan(300)

    const stockOf = async () => (await inventory(master.access_token, orgId)).items.find((i) => i.product_id === product.id)?.available ?? 0
    const cur = await stockOf()
    if (cur !== 0) {
      const adj = await fetch(`${api}/v1/me/inventory/adjust`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: orgId, product_id: product.id, qty: -cur, reason: 'phase9 e2e zero' }),
      })
      expect(adj.ok, await adj.text()).toBeTruthy()
    }

    const svcRec = await fetch(`${api}/v1/me/knowledge/recommendations?service_id=${live.service_id}&organization_id=${orgId}&appointment_id=${live.id}`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    const svcText = await svcRec.text()
    expect([200, 403]).toContain(svcRec.status)
    if (svcRec.status === 200) noLeak(svcText)

    await page.goto(`/appointments/${live.id}`)
    await expect(page.getByTestId('availability-indicator')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('knowledge-recommendations')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('availability-indicator').click()
    await expect(page.getByTestId('availability-panel')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Не хватает/i).first()).toBeVisible()
    await expect(page.getByTestId('availability-order').first()).toBeVisible()
    await expect(page.getByTestId('availability-knowledge').first()).toBeVisible()
    await expect(page.getByTestId('availability-alternative')).toContainText(/Нет сохранённой альтернативы|Есть вариант в линейке/)

    await page.getByTestId('availability-knowledge').first().click()
    await expect(page).toHaveURL(/\/knowledge/, { timeout: 15_000 })
    const afterRes = await fetch(`${api}/v1/appointments/${live.id}`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    const after = await afterRes.json() as { status: string }
    expect(after.status).toBe(beforeStatus)

    // DEMO F — calendar drawer uses the same availability + knowledge widget
    await page.goto('/calendar')
    await expect(page.getByRole('heading', { name: /календарь/i })).toBeVisible({ timeout: 15_000 })
    if (live.starts_at) {
      await openListWeekContaining(page, new Date(live.starts_at))
      const row = page.locator('.fc-list-event').first()
      if (await row.count()) {
        await row.click({ force: true })
        await expect(page.getByTestId('availability-indicator')).toBeVisible({ timeout: 15_000 })
        await page.getByTestId('availability-indicator').click()
        await expect(page.getByTestId('availability-panel')).toBeVisible()
        await expect(page.getByTestId('knowledge-recommendations')).toBeVisible()
      }
    }

    // DEMO H — other master / appointment context must not leak stock or formula
    const foreign = await fetch(`${api}/v1/me/knowledge/recommendations?appointment_id=${live.id}`, {
      headers: { Authorization: `Bearer ${other.access_token}` },
    })
    const foreignText = await foreign.text()
    if (foreign.status === 200) noLeak(foreignText)
    else expect([403, 404]).toContain(foreign.status)
  })
})
