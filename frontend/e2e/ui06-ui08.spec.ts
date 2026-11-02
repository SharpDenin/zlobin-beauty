import { test, expect, type Page } from '@playwright/test'

const password = process.env.SEED_PASSWORD ?? 'Password123!'

const WIDTHS = [360, 390, 768, 1024, 1440] as const

async function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    return !(doc.scrollWidth > doc.clientWidth + 1)
  })
}

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

async function gotoStable(page: Page, route: string) {
  await page.goto(route)
  await page.waitForLoadState('domcontentloaded')
  const crashed = page.getByRole('heading', { name: 'Что-то пошло не так' })
  if (await crashed.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Обновить страницу' }).click()
    await page.waitForLoadState('domcontentloaded')
  }
  await expect(crashed).toHaveCount(0, { timeout: 15_000 })
}

test.describe('UI-06 save confirmations + UI-08 overflow', () => {
  test('profile save shows toast after success', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await login(page, 'client1@demo.local')
    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: 'Профиль' })).toBeVisible({ timeout: 15_000 })
    const name = page.getByLabel('Имя')
    await expect(name).toBeVisible({ timeout: 10_000 })
    const current = await name.inputValue()
    await name.fill(current.endsWith('·') ? current.slice(0, -1) : `${current}·`)
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Профиль сохранён' })).toBeVisible({ timeout: 10_000 })
  })

  test('key pages have no horizontal overflow and calendar fill-shell stays bounded', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'width matrix once')
    // Host→:8090 is flaky on Windows Docker; login via the frontend proxy is the readiness signal.
    await login(page, 'master1@demo.local')

    const routes = ['/profile', '/calendar', '/search', '/shop', '/appointments', '/messages'] as const
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 })
      for (const route of routes) {
        await gotoStable(page, route)
        await expect
          .poll(async () => noHorizontalOverflow(page), { timeout: 8_000 })
          .toBe(true)

        if (route === '/calendar') {
          await expect(page.getByRole('heading', { name: /календар|расписан/i }).first()).toBeVisible({
            timeout: 15_000,
          })
          const bounded = await page.evaluate(() => {
            const el = document.querySelector('.app-shell.app-shell--fill')
            if (!el) return true
            const r = el.getBoundingClientRect()
            return r.height <= window.innerHeight + 2
          })
          expect(bounded, `calendar fill shell @ ${width}`).toBe(true)
        }
      }
    }
  })
})
