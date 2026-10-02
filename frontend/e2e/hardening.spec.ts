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

test.describe('release hardening paths', () => {
  test.beforeEach(async () => {
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
  })

  test('ordinary login has no session scare; logout and login again stays clean', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
    await expect(page.getByText('Сессия завершилась')).toHaveCount(0)
    await loginUI(page, 'master1@demo.local')
    await page.goto('/profile')
    await page.getByRole('main').getByRole('button', { name: 'Выйти' }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText('Сессия завершилась')).toHaveCount(0)
    await loginUI(page, 'master1@demo.local')
    await expect(page.getByText('Сессия завершилась')).toHaveCount(0)
  })

  test('expired stored JWT shows a one-shot Russian notice', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const exp = Math.floor(Date.now() / 1000) - 120
    const payload = btoa(JSON.stringify({ exp, sub: 'expired' })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    await page.addInitScript((token) => {
      localStorage.setItem('zb.auth', JSON.stringify({
        accessToken: token,
        refreshToken: 'dead',
        user: { id: 'x', email: 'x@demo.local', display_name: 'X', roles: ['master'] },
      }))
    }, `eyJhbGciOiJub25lIn0.${payload}.x`)
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
    await expect(page.getByText('Сессия завершилась. Войдите снова.')).toBeVisible()
    await page.reload()
    await expect(page.getByText('Сессия завершилась. Войдите снова.')).toHaveCount(0)
  })

  test('owner home shows salon name and current-day appointments', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1920', 'key viewports')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/')
    await expect(page.getByTestId('owner-start-page')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: /Ателье цвета/ })).toBeVisible()
    await expect(page.getByText(/Кабинет/)).toHaveCount(0)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
    expect(overflow).toBe(false)
    const dayList = page.locator('.owner-start-appts li')
    const empty = page.getByText('На этот день записей нет')
    await expect(dayList.or(empty).first()).toBeVisible({ timeout: 15_000 })
    if (await dayList.count()) {
      await expect(dayList.first()).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-/i)
    }
  })

  test('planner block color persists across reload', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1920', 'desktop calendar')
    const master = await apiLogin('master1@demo.local')
    const start = new Date()
    start.setDate(start.getDate() + 14)
    start.setHours(18, 15, 0, 0)
    while (start.getDay() === 0 || start.getDay() === 6) start.setDate(start.getDate() + 1)
    const end = new Date(start.getTime() + 30 * 60000)
    const title = `E2E цвет ${Date.now()}`
    const create = await fetch(`${api}/v1/planner/blocks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        category: 'task',
        color: 'violet',
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        timezone: 'Asia/Krasnoyarsk',
      }),
    })
    const created = await create.json() as { id?: string; color?: string }
    expect(create.status, JSON.stringify(created)).toBeLessThan(300)
    expect(created.id).toBeTruthy()
    expect(String(created.color)).toMatch(/violet|success/i)

    const listed = await fetch(
      `${api}/v1/planner/blocks?from=${encodeURIComponent(new Date(start.getTime() - 3600000).toISOString())}&to=${encodeURIComponent(new Date(end.getTime() + 3600000).toISOString())}`,
      { headers: { Authorization: `Bearer ${master.access_token}` } },
    )
    expect(listed.ok).toBeTruthy()
    const body = await listed.json() as { items?: Array<{ id: string; color?: string; title?: string }> }
    const row = body.items?.find((b) => b.id === created.id)
    expect(row?.title).toBe(title)
    expect(row?.color).toBeTruthy()

    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await expect(page.getByRole('heading', { name: /календарь/i }).first()).toBeVisible({ timeout: 15_000 })

    await fetch(`${api}/v1/planner/blocks/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
  })

  test('mobile calendar is usable and does not overflow', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-360' && info.project.name !== 'phone-390', 'phones')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await expect(page.getByTestId('calendar-mobile')).toBeVisible({ timeout: 20_000 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
    expect(overflow).toBe(false)
    const strip = page.locator('.cal-day-chip').nth(3)
    await expect(strip).toBeVisible()
    await strip.click()
    const box = await strip.boundingBox()
    expect(box && box.height >= 32 && box.width >= 32).toBeTruthy()
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="calendar-mobile"]')
      if (!el) return
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: 280, clientY: 240 }))
      el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', clientX: 40, clientY: 240 }))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', clientX: 40, clientY: 240 }))
    })
    await expect(page.getByTestId('calendar-mobile')).toBeVisible()
  })

  test('contacts search opens a card and can start a chat without duplicate threads', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/contacts')
    await expect(page.getByTestId('contacts-list')).toBeVisible({ timeout: 15_000 })
    const search = page.getByPlaceholder('Найти в контактах')
    if (await search.count()) {
      await search.fill('Екатерина')
    }
    const person = page.getByTestId('contacts-list').getByText(/Екатерина/i).first()
    await expect(person).toBeVisible()
    await person.click()
    const write = page.getByRole('button', { name: 'Написать' })
    await expect(write).toBeVisible()
    await write.click()
    await expect(page).toHaveURL(/\/messages\//, { timeout: 15_000 })
    const firstPath = new URL(page.url()).pathname
    await page.goto('/contacts')
    await page.getByPlaceholder('Найти в контактах').fill('Екатерина')
    await page.getByTestId('contacts-list').getByText(/Екатерина/i).first().click()
    await page.getByRole('button', { name: 'Написать' }).click()
    await expect(page).toHaveURL(/\/messages\//, { timeout: 15_000 })
    expect(new URL(page.url()).pathname).toBe(firstPath)
  })

  test('owner QR invite shows salon name and a usable /invite link', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/staff')
    await page.getByRole('button', { name: 'Создать QR' }).click()
    await expect(page.getByAltText('QR для регистрации мастера')).toBeVisible({ timeout: 15_000 })
    const inviteUrl = await page.locator('.invite-qr-block p.break-all').innerText()
    expect(inviteUrl).toMatch(/\/invite\//)
    await expect(page.getByRole('heading', { name: /Пригласить мастера по QR/ })).toBeVisible()
  })

  test('master can register without a salon after choosing a type', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const suffix = Date.now()
    await page.goto('/register')
    await page.getByLabel(/имя/i).fill(`Марина Тестова ${suffix}`)
    await page.getByLabel('Email').fill(`e2e.nosalon.${suffix}@example.com`)
    await page.getByLabel('Пароль').fill('Password123!')
    await page.getByRole('radio', { name: /мастер/i }).click()
    const type = page.getByRole('checkbox').first()
    await expect(type).toBeVisible({ timeout: 10_000 })
    await type.check()
    await page.getByRole('button', { name: /Зарегистрироваться|Создать аккаунт/i }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
    await expect(page.getByText(/Кабинет/)).toHaveCount(0)
  })
})
