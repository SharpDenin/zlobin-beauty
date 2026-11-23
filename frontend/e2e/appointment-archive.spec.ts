import { test, expect } from '@playwright/test'

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

async function loginUI(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

test.describe('appointment archive (hide)', () => {
  test('mobile: hide via API then show in archive UI and unhide', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'mobile viewport priority')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    const login = await fetch(`${api}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'master1@demo.local', password }),
    })
    if (!login.ok) test.skip(true, 'seed login unavailable')
    const session = await login.json() as { access_token: string }
    const mine = await fetch(`${api}/v1/appointments/mine?role=master`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (!mine.ok) test.skip(true, 'appointments list unavailable')
    const body = await mine.json() as { items?: Array<{ id: string }> }
    const appt = body.items?.[0]
    if (!appt?.id) test.skip(true, 'no master appointments in seed')

    const hide = await fetch(`${api}/v1/appointments/${appt.id}/hide`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    expect(hide.status).toBe(204)

    const active = await fetch(`${api}/v1/appointments/mine?role=master`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const activeBody = await active.json() as { items?: Array<{ id: string }> }
    expect((activeBody.items ?? []).some((a) => a.id === appt.id)).toBe(false)

    const archived = await fetch(`${api}/v1/appointments/mine?role=master&hidden=1`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const archivedBody = await archived.json() as { items?: Array<{ id: string }> }
    expect((archivedBody.items ?? []).some((a) => a.id === appt.id)).toBe(true)

    await loginUI(page, 'master1@demo.local')
    await page.goto('/appointments')
    await page.getByTestId('appointments-archive-toggle').click()
    await expect(page.getByRole('heading', { name: 'Архив записей' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId(`appointment-unhide-${appt.id}`)).toBeVisible({ timeout: 10_000 })
    await page.getByTestId(`appointment-unhide-${appt.id}`).click()
    await expect(page.getByTestId(`appointment-unhide-${appt.id}`)).toHaveCount(0, { timeout: 10_000 })
  })
})
