import { test, expect } from '@playwright/test'

const api = process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8090'

async function apiJSON(path: string, init: RequestInit = {}) {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(data)}`)
  return data
}

test.describe('responsive shell', () => {
  test('login page has no horizontal overflow and primary CTA visible', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement
      return doc.scrollWidth > doc.clientWidth + 1
    })
    expect(overflow).toBe(false)
  })
})

test.describe('stage1 booking path', () => {
  test('api creates appointment and UI shows it', async ({ page }, testInfo) => {
    // Run full booking flow only on one viewport to keep suite fast.
    test.skip(testInfo.project.name !== 'phone-390', 'full flow once')

    const suffix = Date.now()
    const master = await apiJSON('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: `pw.master.${suffix}@example.com`,
        password: 'Password123!',
        display_name: 'PW Master',
        as_master: true,
      }),
    })
    const org = await apiJSON('/v1/organizations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}` },
      body: JSON.stringify({
        name: 'PW Salon',
        type: 'salon',
        branch_name: 'Center',
        city: 'Moscow',
        address_line: 'Test 1',
        timezone: 'Europe/Moscow',
      }),
    })
    await apiJSON(`/v1/branches/${org.branch.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${master.access_token}` },
      body: JSON.stringify({
        phone: '+79001112233',
        city: 'Moscow',
        address_line: 'Test 1',
        timezone: 'Europe/Moscow',
        published: true,
        pickup_enabled: true,
      }),
    })
    // Publish org
    await apiJSON(`/v1/organizations/${org.organization.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${master.access_token}` },
      body: JSON.stringify({ published: true }),
    })
    const profile = await apiJSON('/v1/me/master', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${master.access_token}` },
      body: JSON.stringify({
        organization_id: org.organization.id,
        branch_id: org.branch.id,
        display_name: 'PW Master',
        city: 'Moscow',
        bio: 'Playwright master bio for readiness checks.',
        experience_years: 5,
        education: 'Test Academy',
        specializations: ['Colorist'],
        published: false,
      }),
    })
    const service = await apiJSON('/v1/services', {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}` },
      body: JSON.stringify({
        organization_id: org.organization.id,
        name: 'Hair coloring',
        category: 'Coloring',
        duration_minutes: 60,
        price_minor: 500000,
        attach_to_me: true,
      }),
    })
    await apiJSON('/v1/me/working-hours', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${master.access_token}` },
      body: JSON.stringify({
        items: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_minute: 600, end_minute: 1140 })),
      }),
    })
    // Publish master after readiness pieces exist
    await apiJSON('/v1/me/master', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${master.access_token}` },
      body: JSON.stringify({
        organization_id: org.organization.id,
        branch_id: org.branch.id,
        display_name: 'PW Master',
        city: 'Moscow',
        bio: 'Playwright master bio for readiness checks.',
        experience_years: 5,
        education: 'Test Academy',
        specializations: ['Colorist'],
        published: true,
      }),
    })

    const client = await apiJSON('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: `pw.client.${suffix}@example.com`,
        password: 'Password123!',
        display_name: 'PW Client',
      }),
    })

    await page.goto('/login')
    await page.evaluate((auth) => localStorage.setItem('zb.auth', JSON.stringify(auth)), {
      accessToken: client.access_token,
      refreshToken: client.refresh_token,
      user: client.user,
    })
    await page.goto('/search')
    await expect(page.getByRole('heading', { name: /Поиск/i })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('textbox', { name: 'Город', exact: true }).fill('Moscow')
    await page.getByRole('button', { name: 'Искать' }).click()
    await expect(page.getByText('PW Master').first()).toBeVisible({ timeout: 15_000 })

    // book via API for determinism of slots, then open appointments UI
    const day = new Date()
    day.setUTCDate(day.getUTCDate() + 1)
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1)
    const date = day.toISOString().slice(0, 10)
    const slots = await apiJSON(
      `/v1/masters/${master.user.id}/slots?date=${date}&duration_minutes=60&timezone=Europe/Moscow`,
    )
    expect(slots.items.length).toBeGreaterThan(0)
    const appt = await apiJSON('/v1/appointments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}` },
      body: JSON.stringify({
        master_id: profile.id,
        service_id: service.id,
        starts_at: slots.items[0].starts_at,
      }),
    })
    expect(appt.status).toBe('pending_confirmation')

    await apiJSON(`/v1/appointments/${appt.id}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}` },
    })

    await page.evaluate((auth) => localStorage.setItem('zb.auth', JSON.stringify(auth)), {
      accessToken: client.access_token,
      refreshToken: client.refresh_token,
      user: client.user,
    })
    await page.goto('/appointments')
    await expect(page.getByText('Hair coloring')).toBeVisible()
    await expect(page.getByText(/Подтвержд|confirmed/i).first()).toBeVisible()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    expect(overflow).toBe(false)
  })
})

test.describe('stage2 visit lifecycle', () => {
  test('confirm → start → complete → client card → review → notifications', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-390', 'full flow once')

    const suffix = Date.now()
    const master = await apiJSON('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: `pw2.master.${suffix}@example.com`,
        password: 'Password123!',
        display_name: 'PW2 Master',
        as_master: true,
      }),
    })
    const org = await apiJSON('/v1/organizations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}` },
      body: JSON.stringify({
        name: 'PW2 Salon',
        type: 'salon',
        branch_name: 'Center',
        city: 'Moscow',
        address_line: 'Test 2',
        timezone: 'Europe/Moscow',
      }),
    })
    await apiJSON(`/v1/branches/${org.branch.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${master.access_token}` },
      body: JSON.stringify({
        phone: '+79001112234',
        city: 'Moscow',
        address_line: 'Test 2',
        timezone: 'Europe/Moscow',
        published: true,
        pickup_enabled: true,
      }),
    })
    await apiJSON(`/v1/organizations/${org.organization.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${master.access_token}` },
      body: JSON.stringify({ published: true }),
    })
    const profile = await apiJSON('/v1/me/master', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${master.access_token}` },
      body: JSON.stringify({
        organization_id: org.organization.id,
        branch_id: org.branch.id,
        display_name: 'PW2 Master',
        city: 'Moscow',
        bio: 'Playwright master bio for readiness checks.',
        experience_years: 5,
        education: 'Test Academy',
        specializations: ['Colorist'],
        published: false,
      }),
    })
    const service = await apiJSON('/v1/services', {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}` },
      body: JSON.stringify({
        organization_id: org.organization.id,
        name: 'Haircut',
        category: 'Cut',
        duration_minutes: 60,
        price_minor: 300000,
        attach_to_me: true,
      }),
    })
    await apiJSON('/v1/me/working-hours', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${master.access_token}` },
      body: JSON.stringify({
        items: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_minute: 600, end_minute: 1140 })),
      }),
    })
    await apiJSON('/v1/me/master', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${master.access_token}` },
      body: JSON.stringify({
        organization_id: org.organization.id,
        branch_id: org.branch.id,
        display_name: 'PW2 Master',
        city: 'Moscow',
        bio: 'Playwright master bio for readiness checks.',
        experience_years: 5,
        education: 'Test Academy',
        specializations: ['Colorist'],
        published: true,
      }),
    })
    const client = await apiJSON('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: `pw2.client.${suffix}@example.com`,
        password: 'Password123!',
        display_name: 'PW2 Client',
      }),
    })

    const day = new Date()
    day.setUTCDate(day.getUTCDate() + 1)
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1)
    const date = day.toISOString().slice(0, 10)
    const slots = await apiJSON(
      `/v1/masters/${master.user.id}/slots?date=${date}&duration_minutes=60&timezone=Europe/Moscow`,
    )
    const appt = await apiJSON('/v1/appointments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}` },
      body: JSON.stringify({
        master_id: profile.id, service_id: service.id, starts_at: slots.items[0].starts_at,
      }),
    })
    await apiJSON(`/v1/appointments/${appt.id}/confirm`, {
      method: 'POST', headers: { Authorization: `Bearer ${master.access_token}` },
    })
    await apiJSON(`/v1/appointments/${appt.id}/start`, {
      method: 'POST', headers: { Authorization: `Bearer ${master.access_token}` },
    })
    const completed = await apiJSON(`/v1/appointments/${appt.id}/complete`, {
      method: 'POST', headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(completed.status).toBe('completed')

    const card = await apiJSON(`/v1/client-cards/appointment/${appt.id}`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(card.id).toBeTruthy()
    const visits = await apiJSON(`/v1/client-cards/id/${card.id}/visits`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(visits.items.length).toBeGreaterThan(0)

    await apiJSON('/v1/reviews', {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.access_token}` },
      body: JSON.stringify({
        appointment_id: appt.id, master_rating: 5, result_rating: 5,
        comment: 'Great', publish_allowed: true,
      }),
    })
    const notes = await apiJSON('/v1/notifications', {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    expect(notes.items.length).toBeGreaterThan(0)

    await page.goto('/')
    await page.evaluate((auth) => localStorage.setItem('zb.auth', JSON.stringify(auth)), {
      accessToken: client.access_token,
      refreshToken: client.refresh_token,
      user: client.user,
    })
    // Notifications UI may be hidden from nav; API coverage above is enough.
    await page.goto('/appointments')
    await expect(page.getByRole('heading', { name: /Записи/i })).toBeVisible({ timeout: 15_000 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    expect(overflow).toBe(false)
  })
})
