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
    test.skip(
      info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280' && info.project.name !== 'desktop-1920',
      'key viewports',
    )
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await expect(page.getByRole('heading', { name: /календарь|расписание/i }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'День', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '3 дня', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Неделя', exact: true })).toBeVisible()
    await assertNoPageOverflow(page)

    if (info.project.name === 'phone-390') {
      await page.getByRole('button', { name: 'День', exact: true }).click()
      await expect(page.getByTestId('calendar-mobile')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('calendar-mobile')).toHaveAttribute('data-day-list', 'true')
      await expect(page.locator('.cal-day-strip')).toBeVisible()
      const appt = page.locator('.cal-slot-event.is-appt, .cal-slot-event').first()
      if (await appt.count()) {
        await appt.click()
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

    // Close any leftover sheet/detail before creating an event.
    for (let i = 0; i < 3; i++) {
      if ((await page.locator('[data-overlay="true"]').count()) === 0) break
      await page.keyboard.press('Escape')
      await page.waitForTimeout(150)
    }
    await page.getByRole('button', { name: '+ Событие' }).click()
    await expect(page.getByRole('heading', { name: 'Новое событие' })).toBeVisible()
    await page.getByLabel('Конец').fill('2000-01-01T00:00')
    await page.getByRole('button', { name: 'Добавить в календарь' }).click()
    await expect(page.getByRole('dialog').getByRole('alert').filter({ hasText: /позже начала|Не удалось/ })).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть' }).click()

    if (info.project.name === 'phone-390') {
      const todayCount = await page.locator('.cal-day-chip.is-today').count()
      expect(todayCount).toBeLessThanOrEqual(1)
      const span = page.getByTestId('calendar-event-span').first()
      if (await span.count()) {
        const spanSlots = Number(await span.getAttribute('data-span'))
        expect(spanSlots).toBeGreaterThanOrEqual(1)
        const h = await span.evaluate((el) => el.getBoundingClientRect().height)
        expect(h).toBeGreaterThanOrEqual(40 * spanSlots - 8)
      }
    }

    // Category filters live in settings — not permanently in the main calendar chrome.
    await expect(page.locator('.calendar-shell > .calendar-category-row')).toHaveCount(0)
    await page.getByTestId('calendar-open-settings').click()
    await expect(page.getByTestId('calendar-settings')).toBeVisible()
    await expect(page.getByRole('group', { name: 'Фильтры категорий' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Клиент/ }).first()).toBeVisible()
    const settingsScroll = await page.getByTestId('calendar-settings').evaluate((el) => {
      const panel = el.closest('[data-overlay-scroll]') as HTMLElement | null
      if (!panel) return { ok: false, reason: 'no-scroll-panel' }
      const style = getComputedStyle(panel)
      return {
        ok: style.overflow === 'auto' || style.overflowY === 'auto' || style.overflowY === 'scroll',
        reason: 'ok',
      }
    })
    expect(settingsScroll.ok, JSON.stringify(settingsScroll)).toBe(true)

    await page.getByTestId('settings-open-schedule').click()
    await expect(page).toHaveURL(/panel=schedule/)
    await expect(page.getByTestId('weekly-hours-form')).toBeVisible()
    await assertNoPageOverflow(page)
  })

  test('calendar?panel=schedule opens weekly hours editor', async ({ page }, info) => {
    test.skip(
      info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280' && info.project.name !== 'desktop-1920',
      'key viewports',
    )
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar?panel=schedule')
    await expect(page.getByTestId('weekly-hours-form')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('schedule-editor')).toBeVisible()
  })
})
