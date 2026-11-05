import { test, expect } from '@playwright/test'

/**
 * ROLE-01/02/03 smoke: master UI can switch to client mode via preferences switcher.
 * Uses demo master credentials when available; skips if login unavailable.
 */
test.describe('ROLE interaction mode', () => {
  test('master can open menu and see mode switch without losing master routes', async ({ page }) => {
    await page.goto('/login')
    const email = page.locator('input[type="email"], input[name="email"]')
    const password = page.locator('input[type="password"]')
    if (!(await email.count()) || !(await password.count())) {
      test.skip(true, 'login form not available')
      return
    }
    await email.fill(process.env.E2E_MASTER_EMAIL || 'master1@demo.local')
    await password.fill(process.env.E2E_MASTER_PASSWORD || 'Demo1234!')
    await page.getByRole('button', { name: /войти|login/i }).click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 }).catch(() => null)
    if (page.url().includes('/login')) {
      test.skip(true, 'demo login failed')
      return
    }

    await page.setViewportSize({ width: 390, height: 844 })
    const menuBtn = page.getByRole('button', { name: /меню/i })
    if (await menuBtn.count()) {
      await menuBtn.click()
    }
    const modeSwitch = page.getByTestId('interaction-mode-switch')
    await expect(modeSwitch).toBeVisible({ timeout: 10000 })
    await modeSwitch.getByLabel('Клиент').click()
    await expect(modeSwitch.getByLabel('Клиент')).toBeChecked()

    // Deep-link master profile still reachable; mode does not revoke access.
    await page.goto('/master')
    await expect(page.getByTestId('work-format-picker')).toBeVisible({ timeout: 15000 })
  })
})
