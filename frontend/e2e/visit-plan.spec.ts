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

test.describe('multi-service visit plan', () => {
  test('client books two salon services from a recommended plan', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) {
      test.skip(true, `API unhealthy at ${api} — start docker stack to run this test`)
    }

    const login = await fetch(`${api}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'master1@demo.local', password }),
    })
    if (!login.ok) {
      test.skip(true, 'seed login unavailable')
    }
    const masterSession = await login.json() as { access_token: string }
    const me = await fetch(`${api}/v1/me/master`, {
      headers: { Authorization: `Bearer ${masterSession.access_token}` },
    })
    expect(me.ok).toBeTruthy()
    const prof = await me.json() as {
      master?: { id: string; organization_id?: string }
      services?: Array<{ id: string; name: string; booking_mode?: string }>
    }
    const cut = (prof.services ?? []).find((s) => /стрижк/i.test(s.name) && s.booking_mode !== 'fixed_window')
    const color = (prof.services ?? []).find((s) => /окраш/i.test(s.name) && s.booking_mode !== 'fixed_window' && s.id !== cut?.id)
    expect(cut && color, 'seed must include haircut + coloring on Anna').toBeTruthy()

    await page.goto('/login')
    await page.getByLabel('Email').fill('client1@demo.local')
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })

    await page.goto(`/masters/${prof.master!.id}`)
    await page.locator('.service-card').filter({ has: page.getByText(cut!.name, { exact: true }) }).first().click()
    await page.getByTestId('add-second-service').click()
    const dialog = page.getByTestId('multi-service-booking')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await dialog.locator('.occurrence-card').filter({ has: page.getByText(color!.name, { exact: true }) }).first().click()
    await expect(dialog.getByText('Найденные варианты')).toBeVisible({ timeout: 30_000 })
    await dialog.getByRole('radio').first().click()
    await expect(dialog.getByTestId('visit-plan-confirm')).toBeVisible()
    await dialog.getByRole('button', { name: 'Подтвердить' }).click()
    await expect(page.getByText('Визит из двух услуг создан')).toBeVisible({ timeout: 20_000 })
    await page.goto('/appointments')
    await expect(page.getByText('Визит из двух услуг').first()).toBeVisible({ timeout: 15_000 })
  })
})
