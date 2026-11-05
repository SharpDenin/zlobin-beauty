import { test, expect } from '@playwright/test'

const api = (process.env.VITE_API_BASE_URL?.startsWith('http')
  ? process.env.VITE_API_BASE_URL
  : null) ?? 'http://localhost:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'

const WIDTHS = [360, 390, 768, 1024, 1440]

test('UI-07 calendar nav uses Russian labels across widths', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-390', 'run once; matrix via setViewportSize')

  const health = await fetch(`${api}/healthz`)
  expect(health.ok).toBeTruthy()

  await page.goto('/login')
  await page.getByLabel('Email').fill('master1@demo.local')
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 })
    await page.goto('/calendar')
    await expect(page.getByRole('heading', { name: /Календарь|Расписание/i }).or(page.locator('.calendar-wrap, [data-testid="calendar-mobile"]')).first()).toBeVisible({ timeout: 20_000 })

    const back = page.getByRole('button', { name: /Назад|К предыдущ/i }).first()
    const forward = page.getByRole('button', { name: /Вперёд|К следующ/i }).first()
    await expect(back, `width ${width}`).toBeVisible({ timeout: 15_000 })
    await expect(forward, `width ${width}`).toBeVisible({ timeout: 15_000 })

    const cryptic = page.locator('button').filter({ hasText: /^[<>‹›«»←→]+$/ })
    await expect(cryptic, `no cryptic nav glyphs at ${width}`).toHaveCount(0)
  }
})
