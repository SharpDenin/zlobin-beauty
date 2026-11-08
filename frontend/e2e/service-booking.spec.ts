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
  return res.json() as Promise<{ access_token: string }>
}

test.describe('service-card-first booking (SVC-01 / BOOK-01)', () => {
  test.beforeEach(async () => {
    if (!(await apiHealthy())) {
      test.skip(true, `API unhealthy at ${api}`)
    }
  })

  test('deep link preselects service and books a free slot', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'primary mobile path once')

    const master = await apiLogin('master1@demo.local')
    const me = await fetch(`${api}/v1/me/master`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    const meText = await me.text()
    expect(me.ok, meText).toBeTruthy()
    const body = JSON.parse(meText) as {
      master?: { id: string; user_id?: string }
      services?: Array<{ id: string; name: string; duration_minutes?: number; booking_mode?: string }>
    }
    const service = (body.services ?? []).find(
      (s) => (s.booking_mode ?? 'flexible') !== 'fixed_window' && /стрижк/i.test(s.name),
    ) ?? (body.services ?? []).find((s) => (s.booking_mode ?? 'flexible') !== 'fixed_window')
    expect(body.master?.id && service?.id).toBeTruthy()

    await loginUI(page, 'client1@demo.local')
    await page.goto(`/masters/${body.master!.id}?service=${service!.id}`)
    await expect(page).toHaveURL(new RegExp(`service=${service!.id}`))
    await expect(page.locator('#mp-booking')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(service!.name).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(new RegExp(`${service!.duration_minutes ?? 60}\\s*мин`)).first()).toBeVisible()

    // Reload must keep service selection via URL.
    await page.reload()
    await expect(page).toHaveURL(new RegExp(`service=${service!.id}`))
    await expect(page.getByText(service!.name).first()).toBeVisible({ timeout: 10_000 })

    const chips = page.getByTestId('mp-date')
    await expect(chips.first()).toBeVisible({ timeout: 10_000 })
    let booked = false
    const chipCount = await chips.count()
    for (let i = 0; i < chipCount; i++) {
      await chips.nth(i).click()
      const empty = page.getByTestId('mp-slots-empty')
      const slot = page.getByTestId('mp-slot').first()
      try {
        await expect(slot.or(empty).first()).toBeVisible({ timeout: 8_000 })
      } catch {
        continue
      }
      if (await empty.count()) {
        await page.getByTestId('mp-slots-pick-date').click()
        continue
      }
      await slot.click()
      const booking = page.locator('#mp-booking')
      const toConfirm = booking.getByRole('button', { name: /К подтверждению|Далее/i })
      if (await toConfirm.count()) await toConfirm.first().click()
      const confirm = booking.getByRole('button', { name: /Подтвердить запись|Подтвердить|Отправить/i })
      await expect(confirm.first()).toBeVisible({ timeout: 10_000 })
      await confirm.first().click()
      await expect(page.getByText(/отправлен|создан|ожида|подтвержд|успешн/i).first()).toBeVisible({ timeout: 15_000 })
      booked = true
      break
    }
    expect(booked, 'expected at least one free slot across date chips').toBeTruthy()
  })

  test('foreign service id is rejected', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const master = await apiLogin('master1@demo.local')
    const me = await fetch(`${api}/v1/me/master`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    const body = await me.json() as { master?: { id: string } }
    expect(body.master?.id).toBeTruthy()

    await loginUI(page, 'client1@demo.local')
    await page.goto(`/masters/${body.master!.id}?service=00000000-0000-4000-8000-000000000099`)
    await expect(page.getByText(/не принадлежит выбранному мастеру/i).first()).toBeVisible({ timeout: 10_000 })
    await expect(page).not.toHaveURL(/service=00000000/)
  })

  test('self-booking is blocked in UI and API', async ({ page }, info) => {
    test.skip(!['phone-390', 'laptop-1366'].includes(info.project.name), 'mobile + desktop')
    const master = await apiLogin('master1@demo.local')
    const me = await fetch(`${api}/v1/me/master`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    const body = await me.json() as {
      master?: { id: string; user_id: string }
      services?: Array<{ id: string; duration_minutes?: number; booking_mode?: string }>
    }
    expect(body.master?.id).toBeTruthy()
    const flexible = (body.services ?? []).find((s) => (s.booking_mode ?? 'flexible') !== 'fixed_window')
    expect(flexible?.id).toBeTruthy()

    const selfCreate = await fetch(`${api}/v1/appointments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${master.access_token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        master_id: body.master!.id,
        service_id: flexible!.id,
        starts_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    })
    const selfText = await selfCreate.text()
    expect(selfCreate.status, selfText).toBe(403)
    expect(selfText).toMatch(/self_booking_forbidden|yourself/i)

    await loginUI(page, 'master1@demo.local')
    await page.goto(`/masters/${body.master!.id}`)
    await expect(page.getByTestId('mp-self-badge')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('mp-self-booking-blocked')).toBeVisible()
    await expect(page.getByTestId('mp-hero-book')).toHaveCount(0)
    await expect(page.locator('.mp-sticky-cta')).toHaveCount(0)
  })

  test('day slots expose anonymized busy blocks', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const master = await apiLogin('master1@demo.local')
    const client = await apiLogin('client1@demo.local')
    const me = await fetch(`${api}/v1/me/master`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    const body = await me.json() as {
      master?: { id: string; user_id: string }
      services?: Array<{ id: string; duration_minutes?: number; booking_mode?: string }>
    }
    const service = (body.services ?? []).find((s) => (s.booking_mode ?? 'flexible') !== 'fixed_window')
    expect(body.master?.user_id && service?.id).toBeTruthy()
    const duration = service!.duration_minutes ?? 60

    let bookedStarts = ''
    let bookedDay = ''
    for (let offset = 1; offset <= 14; offset++) {
      const day = new Date()
      day.setDate(day.getDate() + offset)
      if (day.getDay() === 0 || day.getDay() === 6) continue
      const date = day.toISOString().slice(0, 10)
      const slotsRes = await fetch(
        `${api}/v1/masters/${body.master!.user_id}/slots?date=${date}&duration_minutes=${duration}`,
      )
      if (!slotsRes.ok) continue
      const slotsBody = await slotsRes.json() as { items?: Array<{ starts_at: string }> }
      const first = slotsBody.items?.[0]
      if (!first) continue
      const create = await fetch(`${api}/v1/appointments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${client.access_token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          master_id: body.master!.id,
          service_id: service!.id,
          starts_at: first.starts_at,
        }),
      })
      if (!create.ok) continue
      bookedStarts = first.starts_at
      bookedDay = date
      break
    }
    expect(bookedStarts, 'need a free slot to seed busy').toBeTruthy()

    const busyRes = await fetch(
      `${api}/v1/masters/${body.master!.user_id}/slots?date=${bookedDay}&duration_minutes=${duration}`,
    )
    const busyText = await busyRes.text()
    expect(busyRes.ok, busyText).toBeTruthy()
    const busyBody = JSON.parse(busyText) as {
      items: Array<{ starts_at: string }>
      busy?: Array<{ starts_at: string; ends_at: string; kind?: string }>
    }
    expect(busyBody.busy?.some((b) => b.starts_at === bookedStarts)).toBeTruthy()
    expect(busyText).not.toMatch(/client1|@demo\.local/i)
    expect(busyBody.items.some((s) => s.starts_at === bookedStarts)).toBeFalsy()

    await loginUI(page, 'client2@demo.local')
    await page.goto(`/masters/${body.master!.id}?service=${service!.id}`)
    await expect(page.locator('#mp-booking')).toBeVisible({ timeout: 15_000 })
    const chip = page.getByTestId('mp-date').filter({ hasText: String(Number(bookedDay.slice(-2))) }).first()
    if (await chip.count()) await chip.click()
    else {
      await page.locator('#date').fill(bookedDay)
      await page.getByRole('button', { name: 'К времени' }).click()
    }
    await expect(page.getByTestId('mp-day-busy')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('mp-busy-block').first()).toBeVisible()
    await expect(page.getByTestId('mp-busy-block').first()).toContainText(/Занято/i)
    await expect(page.getByTestId('mp-busy-block').first()).not.toContainText(/@demo\.local|client/i)
  })

  test('fixed_window books pending then master confirms', async ({ page }, info) => {
    test.skip(!['phone-390', 'laptop-1366'].includes(info.project.name), 'mobile + desktop')

    const master = await apiLogin('master1@demo.local')
    const me = await fetch(`${api}/v1/me/master`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    const meText = await me.text()
    expect(me.ok, meText).toBeTruthy()
    const body = JSON.parse(meText) as {
      master?: { id: string; user_id: string; branch_id?: string }
      services?: Array<{ id: string; name: string; booking_mode?: string }>
    }
    const fixed = (body.services ?? []).find((s) => s.booking_mode === 'fixed_window')
    expect(body.master?.id && fixed?.id).toBeTruthy()

    const branchId = body.master?.branch_id
    expect(branchId, 'master branch for new occurrence').toBeTruthy()
    // Unique future window per run so parallel viewports / previous seats do not collide.
    const start = new Date()
    start.setUTCDate(start.getUTCDate() + 12 + Math.floor(Math.random() * 20))
    start.setUTCHours(7, 0, 0, 0)
    while (start.getUTCDay() === 0 || start.getUTCDay() === 6) start.setUTCDate(start.getUTCDate() + 1)
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000)
    const created = await fetch(`${api}/v1/services/${fixed!.id}/occurrences`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${master.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        branch_id: branchId,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        timezone: 'Asia/Krasnoyarsk',
        capacity: 3,
        title: `E2E сеанс ${Date.now()}`,
        note: 'e2e fixed_window pending confirm',
      }),
    })
    const createdText = await created.text()
    expect(created.ok, createdText).toBeTruthy()
    const occurrence = JSON.parse(createdText) as { id: string; status: string; remaining: number; starts_at: string; title?: string }
    expect(occurrence.id).toBeTruthy()

    const email = `fw-pending-${Date.now()}@demo.local`
    const clientName = `FW Pending ${Date.now()}`
    const reg = await fetch(`${api}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name: clientName }),
    })
    expect(reg.ok, await reg.text()).toBeTruthy()

    await loginUI(page, email)
    await page.goto(`/masters/${body.master!.id}?service=${fixed!.id}`)
    await expect(page.locator('#mp-booking')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(fixed!.name).first()).toBeVisible({ timeout: 10_000 })

    const card = page.locator('.occurrence-card').filter({ hasText: occurrence.title || 'E2E сеанс' }).first()
    await expect(card).toBeVisible({ timeout: 15_000 })
    await card.click()
    const booking = page.locator('#mp-booking')
    await expect(booking.getByRole('heading', { name: 'Итого' })).toBeVisible({ timeout: 10_000 })
    await booking.getByRole('button', { name: /Подтвердить запись/i }).click()
    await expect(page.getByRole('heading', { name: 'Запись отправлена' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/ожидает подтверждения мастера/i).first()).toBeVisible()

    const client = await apiLogin(email)
    const mine = await fetch(`${api}/v1/appointments/mine?role=client`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const mineBody = await mine.json() as { items?: Array<{ id: string; status: string; occurrence_id?: string }> }
    const pending = (mineBody.items ?? []).find((a) => a.occurrence_id === occurrence.id)
      ?? mineBody.items?.[0]
    expect(pending?.status).toBe('pending_confirmation')

    await page.getByRole('button', { name: 'Выйти' }).first().click()
    await loginUI(page, 'master1@demo.local')
    await page.goto('/appointments')
    await expect(page.getByRole('heading', { name: 'Записи' })).toBeVisible({ timeout: 15_000 })
    const masterRole = page.getByRole('group', { name: 'Роль в записях' }).getByText('Мастер')
    if (await masterRole.count()) await masterRole.click()
    const pendingCard = page.locator('.appt-card').filter({ hasText: clientName }).filter({ hasText: /Ожидает подтверждения/i })
    await expect(pendingCard).toBeVisible({ timeout: 15_000 })
    await pendingCard.getByRole('button', { name: 'Подтвердить' }).click()
    await expect(page.getByText('Запись подтверждена').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.appt-card').filter({ hasText: clientName }).filter({ hasText: /Подтверждена/i })).toBeVisible({
      timeout: 10_000,
    })

    await page.getByRole('button', { name: 'Выйти' }).first().click()
    await loginUI(page, email)
    await page.goto('/appointments')
    await expect(page.locator('.appt-card').filter({ hasText: /Подтверждена/i }).first()).toBeVisible({ timeout: 15_000 })
  })

  test('search marks own master profile as Это вы', async ({ page }, info) => {
    test.skip(!['phone-390', 'laptop-1366'].includes(info.project.name), 'mobile + desktop')

    await loginUI(page, 'master1@demo.local')
    await page.goto('/search')
    await page.locator('#city').fill('Красноярск')
    await page.locator('#q').fill('Анна Волкова')
    await page.getByRole('button', { name: 'Искать' }).click()

    const selfCard = page.getByTestId('search-master-self')
    await expect(selfCard).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('search-self-badge')).toHaveText('Это вы')
    await selfCard.click()
    await expect(page.getByTestId('mp-self-badge')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('mp-self-booking-blocked')).toBeVisible()
    await expect(page.getByTestId('mp-hero-book')).toHaveCount(0)

    await page.goto('/search')
    await page.locator('#city').fill('Красноярск')
    await page.locator('#q').fill('Дмитрий')
    await page.getByRole('button', { name: 'Искать' }).click()
    const other = page.getByTestId('search-master-card').filter({ hasText: /Дмитрий/i }).first()
    await expect(other).toBeVisible({ timeout: 15_000 })
    await expect(other.getByTestId('search-self-badge')).toHaveCount(0)
    await other.click()
    await expect(page.getByTestId('mp-hero-book')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('mp-self-booking-blocked')).toHaveCount(0)
  })
})
