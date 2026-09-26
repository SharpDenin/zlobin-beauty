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

test.describe('production messenger', () => {
  test('client opens master chat and sends a message', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) {
      test.skip(true, `API unhealthy at ${api} — start docker stack to run this test`)
    }
    const master = await fetch(`${api}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'master1@demo.local', password }),
    })
    if (!master.ok) test.skip(true, 'seed login unavailable')
    const masterSession = await master.json() as { access_token: string }
    const profile = await fetch(`${api}/v1/me/master`, { headers: { Authorization: `Bearer ${masterSession.access_token}` } })
    const prof = await profile.json() as { master?: { id: string } }
    expect(prof.master?.id).toBeTruthy()

    await loginUI(page, 'client1@demo.local')
    await page.goto(`/masters/${prof.master!.id}`)
    await expect(page.getByTestId('write-master')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('write-master').click()
    await expect(page).toHaveURL(/\/messages\//, { timeout: 15_000 })
    const hello = `Уточнение по тонированию ${Date.now()}`
    await page.getByTestId('message-composer').fill(hello)
    await page.getByTestId('send-message').click()
    await expect(page.getByTestId('message-history').getByText(hello)).toBeVisible({ timeout: 10_000 })
  })

  test('master opens supplier chat and sends a message', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) {
      test.skip(true, `API unhealthy at ${api} — start docker stack to run this test`)
    }
    const suppliers = await fetch(`${api}/v1/suppliers`)
    if (!suppliers.ok) test.skip(true, 'suppliers unavailable')
    const body = await suppliers.json() as { items?: Array<{ id: string; name: string }> }
    const supplier = (body.items ?? []).find((s) => /профи/i.test(s.name)) ?? body.items?.[0]
    expect(supplier?.id).toBeTruthy()

    await loginUI(page, 'master1@demo.local')
    await page.goto(`/cosmetics/${supplier!.id}`)
    await expect(page.getByTestId('write-supplier')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('write-supplier').click()
    await expect(page).toHaveURL(/\/messages\//, { timeout: 15_000 })
    const ask = `Наличие Olaplex ${Date.now()}`
    await page.getByTestId('message-composer').fill(ask)
    await page.getByTestId('send-message').click()
    await expect(page.getByTestId('message-history').getByText(ask)).toBeVisible({ timeout: 10_000 })
  })
})
