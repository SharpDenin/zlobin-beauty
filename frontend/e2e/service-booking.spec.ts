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
})
