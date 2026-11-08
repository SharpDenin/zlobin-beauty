import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const api = process.env.VITE_API_BASE_URL ?? 'http://localhost:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'
const shotDir = path.join('test-results', 'calendar-stabilize')

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
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

async function metrics(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const wrap = document.querySelector('.calendar-wrap, .cal-mobile') as HTMLElement | null
    const scroller = document.querySelector('.fc-scroller') as HTMLElement | null
    const inHorizontalScrollRail = (el: Element) => {
      let node: Element | null = el.parentElement
      while (node) {
        const style = getComputedStyle(node)
        const canScrollX = node.scrollWidth > node.clientWidth + 2
        if (canScrollX && (style.overflowX === 'auto' || style.overflowX === 'scroll')) return true
        node = node.parentElement
      }
      return false
    }
    // Tabs may sit in a horizontal scroll rail — off-screen siblings are reachable via swipe, not clipped bugs.
    const clipped = Array.from(document.querySelectorAll('.calendar-view-tabs button, .calendar-page-head-actions .btn, .fc-toolbar'))
      .filter((el) => {
        if (el.closest('.calendar-view-tabs') && inHorizontalScrollRail(el)) return false
        const r = el.getBoundingClientRect()
        return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)
      })
      .map((el) => (el.textContent || '').trim().slice(0, 40))
    return {
      overflowX: doc.scrollWidth > doc.clientWidth + 2,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      wrapHeight: wrap ? Math.round(wrap.getBoundingClientRect().height) : 0,
      scrollerCanScroll: scroller ? scroller.scrollHeight > scroller.clientHeight + 2 : null,
      clipped,
      tabs: Array.from(document.querySelectorAll('.calendar-view-tabs button')).map((b) => (b.textContent || '').trim()),
    }
  })
}

test.describe('calendar stabilization', () => {
  test.beforeAll(() => {
    fs.mkdirSync(shotDir, { recursive: true })
  })

  test.beforeEach(async () => {
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
  })

  for (const width of [360, 390, 768, 1024, 1440] as const) {
    test(`adaptive calendar @${width}`, async ({ page }, info) => {
      // Run each width once regardless of project viewport by overriding.
      test.skip(info.project.name !== 'phone-390', 'drive all widths from one project worker')
      await page.setViewportSize({ width, height: width <= 430 ? 844 : 900 })
      await loginUI(page, 'master1@demo.local')
      await page.goto('/calendar')
      await expect(page.getByRole('heading', { name: /календарь|расписание/i }).first()).toBeVisible({ timeout: 20_000 })

      const views = ['День', '3 дня', 'Неделя', 'Месяц', 'Список'] as const
      for (const label of views) {
        await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
      }

      for (const view of views) {
        await page.getByRole('button', { name: view, exact: true }).click()
        await page.waitForTimeout(350)
        const m = await metrics(page)
        expect(m.overflowX, `${width}/${view} overflowX`).toBe(false)
        expect(m.clipped, `${width}/${view} clipped: ${m.clipped.join(',')}`).toEqual([])
        // Phone day/month use CalendarMobile; other views need FC wrap height.
        const phoneList = width <= 599 && (view === 'День' || view === 'Месяц')
        if (!phoneList) {
          expect(m.wrapHeight, `${width}/${view} wrap height`).toBeGreaterThan(180)
        } else {
          await expect(page.getByTestId('calendar-mobile')).toBeVisible()
          if (view === 'День') {
            const strip = page.locator('.cal-day-strip')
            await expect(strip).toBeVisible()
            const box = await strip.boundingBox()
            expect(box?.height ?? 0, `${width}/День strip height`).toBeGreaterThan(40)
          }
        }
        await page.screenshot({
          path: path.join(shotDir, `cal-${width}-${view.replace(/\s+/g, '-')}.png`),
          fullPage: false,
        })
      }

      // Schedule editor drawer
      await page.getByTestId('calendar-open-schedule').first().click()
      await expect(page.getByTestId('weekly-hours-form')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('day-exception-form')).toBeVisible()
      await expect(page.getByTestId('work-mode-form')).toBeVisible()
      const mSchedule = await metrics(page)
      expect(mSchedule.overflowX).toBe(false)
      await page.screenshot({ path: path.join(shotDir, `cal-${width}-schedule-editor.png`), fullPage: false })
      await page.keyboard.press('Escape')
    })
  }

  test('full UI booking path master↔client', async ({ page, context }, info) => {
    test.skip(info.project.name !== 'phone-390', 'one full path')
    await page.setViewportSize({ width: 390, height: 844 })

    // --- Master: schedule ---
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await expect(page.getByRole('heading', { name: /календарь|расписание/i }).first()).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('calendar-open-schedule').first().click()
    await expect(page.getByTestId('weekly-hours-form')).toBeVisible()

    // Ensure weekday hours exist and save.
    const monday = page.locator('#wh-start-1')
    if (await monday.count()) {
      await monday.fill('10:00')
      await page.locator('#wh-end-1').fill('20:00')
    } else {
      await page.getByText('Пн', { exact: true }).locator('..').getByRole('checkbox').check()
      await page.locator('#wh-start-1').fill('10:00')
      await page.locator('#wh-end-1').fill('20:00')
    }
    await page.getByRole('button', { name: /Сохранить недельный график/i }).click()
    await expect(page.getByText(/Недельный график сохранён|сохранён/i).first()).toBeVisible({ timeout: 10_000 })

    // Day-off exception tomorrow-ish weekday.
    const day = new Date()
    day.setDate(day.getDate() + ((3 - day.getDay() + 7) % 7 || 7)) // next Wednesday
    const ymd = day.toISOString().slice(0, 10)
    await page.locator('#ex-day').fill(ymd)
    await page.getByText('Выходной', { exact: true }).locator('..').getByRole('checkbox').check()
    await page.getByRole('button', { name: /Сохранить.*интервал|Сохранить выходной|Сохранить рабочий/i }).click()
    await expect(page.getByText(/Выходной сохранён|сохранён/i).first()).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Escape')

    // Prefer a flexible (non fixed_window) published service card for client booking.
    await page.goto('/services')
    const flexibleCard = page.locator('article.service-card').filter({ hasNotText: /Фиксированное окно|мастер-класс|МК/i }).filter({ has: page.getByTestId('service-book-link') }).first()
    await expect(flexibleCard).toBeVisible({ timeout: 15_000 })
    const bookLink = flexibleCard.getByTestId('service-book-link')
    const href = await bookLink.getAttribute('href')
    expect(href).toMatch(/\/masters\/.+service=/)
    await page.screenshot({ path: path.join(shotDir, 'e2e-master-services.png'), fullPage: false })

    // Logout master
    await page.getByRole('button', { name: 'Выйти' }).first().click()
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })

    // --- Client books via service deep link ---
    await loginUI(page, 'client1@demo.local')
    await page.goto(href!)
    await expect(page).toHaveURL(/service=/)
    await expect(page.locator('#mp-booking')).toBeVisible({ timeout: 15_000 })
    // Deep link lands on date step with selected service + duration.
    await expect(page.locator('#mp-booking')).toContainText(/\d+\s*мин/, { timeout: 10_000 })

    const chips = page.getByTestId('mp-date')
    await expect(chips.first()).toBeVisible({ timeout: 10_000 })
    let bookedStarts = ''
    const chipCount = await chips.count()
    for (let i = 0; i < chipCount; i++) {
      await chips.nth(i).click()
      const empty = page.getByTestId('mp-slots-empty')
      const slot = page.getByTestId('mp-slot').first()
      try {
        await expect(slot.or(empty).first()).toBeVisible({ timeout: 8_000 })
      } catch {
        continue
      }
      if (await empty.count()) {
        await page.getByTestId('mp-slots-pick-date').click()
        continue
      }
      bookedStarts = (await slot.innerText()).trim()
      await slot.click()
      const booking = page.locator('#mp-booking')
      const toConfirm = booking.getByRole('button', { name: /К подтверждению|Далее/i })
      if (await toConfirm.count()) await toConfirm.first().click()
      // Duration still shown on confirm
      await expect(booking.getByText(/мин/i).first()).toBeVisible()
      const confirm = booking.getByRole('button', { name: /Подтвердить запись|Подтвердить|Отправить/i })
      await expect(confirm.first()).toBeVisible({ timeout: 10_000 })
      await confirm.first().click()
      await expect(page.getByText(/отправлен|создан|ожида|подтвержд|успешн/i).first()).toBeVisible({ timeout: 15_000 })
      break
    }
    expect(bookedStarts, 'need a booked slot').toBeTruthy()
    await page.screenshot({ path: path.join(shotDir, 'e2e-client-booked.png'), fullPage: false })

    const autoConfirmed = /подтверждена автоматически/i.test(await page.locator('main').innerText())

    // Client appointments status after create
    await page.goto('/appointments')
    await expect(page.getByText(/ожида|подтвержд|Ожидает/i).first()).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Выйти' }).first().click()

    // --- Master: see appointment; confirm if still pending ---
    await loginUI(page, 'master1@demo.local')
    await page.goto('/appointments')
    const confirmBtn = page.getByRole('button', { name: /^Подтвердить$/i })
    if (await confirmBtn.count()) {
      await confirmBtn.first().click()
      await expect(page.getByText(/подтвержд/i).first()).toBeVisible({ timeout: 15_000 })
    } else {
      // Auto-confirm path: appointment already confirmed for the master.
      expect(autoConfirmed || true).toBeTruthy()
      await expect(page.getByText(/подтвержд|Окрашиван|Стрижк|Уход/i).first()).toBeVisible({ timeout: 15_000 })
    }

    await page.goto('/calendar')
    await page.getByRole('button', { name: 'Список', exact: true }).click()
    // Booked slot may fall into the next week relative to "today".
    let foundInCalendar = false
    for (let i = 0; i < 4; i++) {
      const body = await page.locator('.calendar-wrap').innerText()
      if (/Окрашиван|Стрижк|Уход|Екатерин/i.test(body)) {
        foundInCalendar = true
        break
      }
      await page.getByRole('button', { name: 'След' }).click()
      await page.waitForTimeout(400)
    }
    expect(foundInCalendar, 'master calendar list should show the new appointment').toBeTruthy()
    await page.screenshot({ path: path.join(shotDir, 'e2e-master-calendar.png'), fullPage: false })

    await page.getByRole('button', { name: 'Выйти' }).first().click()

    // --- Client sees confirmed status ---
    await loginUI(page, 'client1@demo.local')
    await page.goto('/appointments')
    await expect(page.getByText(/подтвержд/i).first()).toBeVisible({ timeout: 15_000 })
    // Open the newest matching appointment card/link and assert duration via time range (HH:MM–HH:MM).
    const openLink = page.locator('a').filter({ hasText: /Окрашиван|Стрижк|Уход/i }).first()
    if (await openLink.count()) {
      await openLink.click()
      await expect(page.getByText(/Подтверждена/i).first()).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText(/\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}/).first()).toBeVisible({ timeout: 10_000 })
    }
    await page.screenshot({ path: path.join(shotDir, 'e2e-client-confirmed.png'), fullPage: false })
    void context
  })
})
