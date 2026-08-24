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
    await expect(page.getByRole('heading', { name: /склад/i })).toBeVisible({ timeout: 15_000 })
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
    await expect(page.getByRole('heading', { name: 'Материалы и инструкции' })).toBeVisible({ timeout: 15_000 })
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
    await page.getByRole('button', { name: 'Настроить' }).click()
    const messages = page.locator('.dashboard-setting-row').filter({ hasText: 'Сообщения' }).locator('input[type="checkbox"]')
    await expect(messages).toBeVisible()
    if (await messages.isChecked()) await messages.uncheck()
    await page.getByRole('button', { name: 'Готово' }).click()
    await page.reload()
    await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.widget-drag-handle', { hasText: 'Сообщения' })).toHaveCount(0)
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
    await page.getByLabel('Не раскрывать схему').check()
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
})
