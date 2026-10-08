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

async function assertNoPageOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  expect(overflow).toBe(false)
}

test.describe('production calendar', () => {
  test('master opens calendar, switches day, and can open create', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1920', 'key viewports')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await expect(page.getByRole('heading', { name: /календарь/i }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'День', exact: true })).toBeVisible()
    if (info.project.name === 'phone-390') {
      await expect(page.getByRole('button', { name: '3 дня', exact: true })).toBeVisible()
    } else {
      await expect(page.getByRole('button', { name: 'Неделя', exact: true })).toBeVisible()
    }
    await assertNoPageOverflow(page)

    if (info.project.name === 'phone-390') {
      await expect(page.getByTestId('calendar-mobile')).toBeVisible()
      const dayChip = page.locator('.cal-day-chip').nth(4)
      await expect(dayChip).toBeVisible()
      await dayChip.click()
      const block = page.locator('.cal-slot-event').first()
      if (await block.count()) {
        await block.click()
        await expect(page.getByTestId('calendar-detail')).toBeVisible()
        const reschedule = page.getByRole('button', { name: 'Перенести' })
        if (await reschedule.count()) {
          await reschedule.click()
          await expect(page.getByTestId('reschedule-dialog')).toBeVisible()
          await page.getByRole('button', { name: 'Закрыть' }).last().click()
        } else {
          await page.getByRole('button', { name: 'Закрыть' }).click()
        }
      }
    } else {
      await expect(page.locator('.calendar-wrap .fc')).toBeVisible({ timeout: 15_000 })
      await page.getByRole('button', { name: 'Неделя' }).click()
      await expect(page.locator('.fc-timegrid')).toBeVisible()
      const appt = page.locator('.fc-event.is-appt').first()
      if (await appt.count()) {
        await appt.click()
        await expect(page.getByTestId('calendar-detail')).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByTestId('calendar-detail')).toHaveCount(0)
      }
    }

    await page.getByRole('button', { name: '+ Событие' }).click()
    await expect(page.getByRole('heading', { name: 'Новое событие' })).toBeVisible()
    await page.getByLabel('Конец').fill('2000-01-01T00:00')
    await page.getByRole('button', { name: 'Добавить в календарь' }).click()
    await expect(page.getByRole('dialog').getByRole('alert').filter({ hasText: /позже начала|Не удалось/ })).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть' }).click()

    await page.getByRole('button', { name: 'Настройки календаря' }).click()
    await expect(page.getByTestId('calendar-settings')).toBeVisible()
    await expect(page.getByTestId('settings-open-schedule')).toHaveAttribute('href', '/schedule')
    await assertNoPageOverflow(page)
  })
})
