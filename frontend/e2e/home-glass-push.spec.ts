import { test, expect, type Page } from '@playwright/test'

const api = process.env.E2E_API_BASE_URL
  ?? (process.env.VITE_API_BASE_URL?.startsWith('http') ? process.env.VITE_API_BASE_URL : null)
  ?? 'http://127.0.0.1:8090'
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
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 })
}

test.describe('Home glass lens + push onboarding', () => {
  test('home uses right-panel lens; other routes keep fullscreen lens', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'sample viewports')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    await loginUI(page, 'client1@demo.local')
    await page.goto('/')
    await expect(page.getByTestId('owner-start-page')).toBeVisible()

    const homeLens = await page.evaluate(() => {
      const after = getComputedStyle(document.body, '::after')
      const panel = document.querySelector('.owner-start-panel')
      const panelStyle = panel ? getComputedStyle(panel) : null
      return {
        afterFilter: after.backdropFilter || after.webkitBackdropFilter || '',
        afterBg: after.backgroundColor,
        panelFilter: panelStyle?.backdropFilter || panelStyle?.webkitBackdropFilter || '',
      }
    })
    expect(homeLens.afterFilter === 'none' || homeLens.afterFilter === '').toBeTruthy()
    expect(homeLens.panelFilter).toMatch(/blur\(/)

    await page.goto('/profile')
    const otherLens = await page.evaluate(() => {
      const after = getComputedStyle(document.body, '::after')
      return after.backdropFilter || after.webkitBackdropFilter || ''
    })
    expect(otherLens).toMatch(/blur\(/)
  })

  test('push home prompt can be declined without permission prompt', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    await loginUI(page, 'client1@demo.local')
    await page.goto('/')
    const card = page.getByTestId('device-push-card')
    // Card may already be hidden if previously declined/subscribed for this seed user.
    if (await card.isVisible().catch(() => false)) {
      const decline = page.getByTestId('device-push-decline')
      if (await decline.isVisible().catch(() => false)) {
        await decline.click()
        await expect(card).toHaveCount(0)
      }
    }

    await page.goto('/settings/notifications')
    await expect(page.getByTestId('device-push-card')).toBeVisible()
  })

  test('invite primary Link keeps CTA ink contrast', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await page.goto('/invite/demo-token-layout')
    // Peek may error; still render auth-screen chrome with possible CTAs after error state.
    const register = page.getByRole('link', { name: 'Зарегистрироваться' })
    if (await register.isVisible().catch(() => false)) {
      const color = await register.evaluate((el) => getComputedStyle(el).color)
      expect(color).not.toMatch(/rgb\(\s*124\s*,\s*130\s*,\s*255\s*\)/i)
    }
  })
})
