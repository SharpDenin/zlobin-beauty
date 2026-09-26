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

async function login(email: string) {
  const res = await fetch(`${api}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) return null
  return res.json() as Promise<{ access_token: string }>
}

test.describe('knowledge home-care visibility', () => {
  test('client sees home-care articles and cannot open professional ones', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) {
      test.skip(true, `API unhealthy at ${api} — start docker stack to run this test`)
    }
    const session = await login('client1@demo.local')
    if (!session) test.skip(true, 'seed login unavailable')

    const list = await fetch(`${api}/v1/knowledge?limit=100`, {
      headers: { Authorization: `Bearer ${session!.access_token}` },
    })
    expect(list.ok).toBeTruthy()
    const body = await list.json() as { items: Array<{ id: string; title: string; home_care?: boolean }> }
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.every((a) => a.home_care !== false)).toBeTruthy()
    expect(body.items.some((a) => /домашний уход|olaplex|absolut|otium/i.test(a.title))).toBeTruthy()
    const professional = body.items.find((a) => /majirel|колористик|оксид|балаяж/i.test(a.title))
    expect(professional).toBeFalsy()

    const forbidden = await fetch(`${api}/v1/knowledge?q=${encodeURIComponent('Majirel')}&limit=20`, {
      headers: { Authorization: `Bearer ${session!.access_token}` },
    })
    const search = await forbidden.json() as { items: Array<{ title: string }> }
    expect(search.items.some((a) => /majirel/i.test(a.title))).toBeFalsy()

    await page.goto('/login')
    await page.getByLabel('Email').fill('client1@demo.local')
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
    await page.goto('/knowledge')
    await expect(page.getByRole('heading', { name: 'База знаний' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/домашн/i).first()).toBeVisible()
    await expect(page.getByTestId('kb-article').first()).toBeVisible()
    await expect(page.getByText('Инструкция: Majirel', { exact: false })).toHaveCount(0)
    await page.getByTestId('kb-article').first().click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Только для салонов')).toHaveCount(0)
  })

  test('master sees home-care and professional articles', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) {
      test.skip(true, `API unhealthy at ${api} — start docker stack to run this test`)
    }
    const session = await login('master1@demo.local')
    if (!session) test.skip(true, 'seed login unavailable')

    const list = await fetch(`${api}/v1/knowledge?limit=100`, {
      headers: { Authorization: `Bearer ${session!.access_token}` },
    })
    expect(list.ok).toBeTruthy()
    const body = await list.json() as { items: Array<{ id: string; title: string; home_care?: boolean; professional?: boolean }> }
    expect(body.items.some((a) => a.home_care)).toBeTruthy()
    expect(body.items.some((a) => a.professional && !a.home_care)).toBeTruthy()
    const pro = body.items.find((a) => /majirel/i.test(a.title))
    expect(pro, 'seed must include a Majirel professional article').toBeTruthy()

    const detail = await fetch(`${api}/v1/knowledge/${pro!.id}`, {
      headers: { Authorization: `Bearer ${session!.access_token}` },
    })
    expect(detail.ok).toBeTruthy()

    await page.goto('/login')
    await page.getByLabel('Email').fill('master1@demo.local')
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
    await page.goto('/knowledge')
    await expect(page.getByText('Профессиональный материал').first()).toBeVisible({ timeout: 15_000 })
    await page.getByText(/Majirel/i).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })
  })
})
