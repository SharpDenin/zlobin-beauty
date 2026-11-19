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
    await expect(page.getByRole('button', { name: 'Неделя', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Месяц', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Список', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '3 дня', exact: true })).toHaveCount(0)
    await expect(page.locator('.bottomnav')).toHaveCount(0)
    await assertNoPageOverflow(page)

    if (info.project.name === 'phone-390') {
      await page.getByRole('button', { name: 'День', exact: true }).click()
      const mobileDay = page.getByTestId('calendar-mobile')
      const mastersDay = page.getByTestId('calendar-masters-day')
      await expect(mobileDay.or(mastersDay)).toBeVisible({ timeout: 15_000 })
      if (await mobileDay.count()) {
        await expect(mobileDay).toHaveAttribute('data-day-list', 'true')
        await expect(page.locator('.cal-day-strip')).toBeVisible()
      } else {
        await expect(page.getByRole('button', { name: /Назад|К предыдущ/i }).first()).toBeVisible()
        await expect(page.getByRole('button', { name: /Вперёд|К следующ/i }).first()).toBeVisible()
      }
      const appt = page.locator('.cal-slot-event.is-appt, .cal-slot-event, .cal-masters-event').first()
      if (await appt.count()) {
        // Click the card body center so external resize handles do not intercept.
        const box = await appt.boundingBox()
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 18))
        } else {
          await appt.click()
        }
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
    await page.locator('#cal-block-end').fill('2000-01-01T00:00')
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

    // Category filters removed — settings hold grid range / nav; chrome stays clean.
    await expect(page.locator('.calendar-shell > .calendar-category-row')).toHaveCount(0)
    await page.getByTestId('calendar-open-settings').click()
    await expect(page.getByTestId('calendar-settings')).toBeVisible()
    await expect(page.getByRole('group', { name: 'Фильтры категорий' })).toHaveCount(0)
    await expect(page.getByTestId('calendar-nav-mode')).toBeVisible()
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

  test('mobile FC keeps a single date-nav source; desktop keeps FC toolbar', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'key viewports')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await expect(page.getByRole('heading', { name: /календарь|расписание/i }).first()).toBeVisible({ timeout: 20_000 })

    if (info.project.name === 'phone-390') {
      await page.getByRole('button', { name: 'Неделя', exact: true }).click()
      await expect(page.locator('.calendar-wrap .fc')).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.cal-chrome-day-nav')).toBeVisible()
      // Chrome owns Назад/Вперёд; FC toolbar buttons must not duplicate them.
      await expect(page.locator('.fc-prev-button, .fc-next-button, .fc-today-button')).toHaveCount(0)
      const titleBefore = await page.locator('.fc-toolbar-title').textContent()
      // Mobile FC chrome advances by period (week) so one step must change the title.
      await page.locator('.cal-chrome-day-nav').getByRole('button', { name: /Вперёд/i }).click()
      await expect.poll(async () => page.locator('.fc-toolbar-title').textContent()).not.toBe(titleBefore)
      await page.locator('.cal-chrome-day-nav').getByRole('button', { name: /Назад/i }).click()
      await expect.poll(async () => page.locator('.fc-toolbar-title').textContent()).toBe(titleBefore)
      await page.locator('.cal-chrome-day-nav').getByRole('button', { name: /Сегодня/i }).click()
      await expect(page.locator('.fc-toolbar-title')).toBeVisible()
    } else {
      await page.getByRole('button', { name: 'Неделя', exact: true }).click()
      await expect(page.locator('.calendar-wrap .fc')).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.cal-chrome-day-nav')).toHaveCount(0)
      await expect(page.locator('.fc-prev-button')).toBeVisible()
      await expect(page.locator('.fc-next-button')).toBeVisible()
      await expect(page.locator('.fc-today-button')).toBeVisible()
    }
    await assertNoPageOverflow(page)
  })

  test('short event resize handles do not vertically overlap each other', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'mobile geometry')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await page.getByRole('button', { name: 'День', exact: true }).click()
    const dayBoard = page.getByTestId('calendar-mobile').or(page.getByTestId('calendar-masters-day'))
    await expect(dayBoard).toBeVisible({ timeout: 15_000 })

    // Chrome nav must not cover masters column heads (layout regression from compact nav).
    const chromeOverlap = await page.evaluate(() => {
      const nav = document.querySelector('.cal-chrome-day-nav') as HTMLElement | null
      const head = document.querySelector('.cal-masters-col-head, .cal-mobile-head') as HTMLElement | null
      if (!nav || !head) return { ok: true, reason: 'no-pair' }
      const a = nav.getBoundingClientRect()
      const b = head.getBoundingClientRect()
      const hit = !(a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left)
      return { ok: !hit, reason: hit ? 'chrome-over-masters' : 'ok' }
    })
    expect(chromeOverlap.ok, JSON.stringify(chromeOverlap)).toBe(true)

    // Prefer a real seed event; otherwise inject a short CSS fixture into a master column.
    let shell = page.locator('.cal-masters-event-shell, .cal-slot-event-shell').first()
    if ((await shell.count()) === 0) {
      const injected = await page.evaluate(() => {
        const col = document.querySelector('.cal-masters-col, .cal-slot-grid') as HTMLElement | null
        if (!col) return false
        const mk = (top: number, short: boolean) => {
          const shellEl = document.createElement('div')
          shellEl.className = `cal-masters-event-shell${short ? ' is-short' : ''}`
          shellEl.setAttribute('data-testid', 'cal-handle-fixture')
          shellEl.style.cssText = `position:absolute;left:4px;right:4px;top:${top}px;height:${short ? 36 : 56}px;z-index:3;`
          shellEl.innerHTML = [
            '<span class="cal-resize-handle is-start"></span>',
            '<button type="button" class="cal-masters-event" style="position:absolute;inset:0;margin:0;border:0;"></button>',
            '<span class="cal-resize-handle is-end"></span>',
          ].join('')
          col.appendChild(shellEl)
        }
        // Contiguous short pair: exercises self + neighbor separation.
        mk(160, true)
        mk(160 + 36 + 2, true)
        return true
      })
      expect(injected, 'masters/mobile column for handle fixture').toBe(true)
      shell = page.locator('[data-testid="cal-handle-fixture"]').first()
    }
    await expect(shell).toBeVisible({ timeout: 15_000 })
    await shell.scrollIntoViewIfNeeded()
    const geometry = await shell.evaluate((el) => {
      const start = el.querySelector('.cal-resize-handle.is-start') as HTMLElement | null
      const end = el.querySelector('.cal-resize-handle.is-end') as HTMLElement | null
      if (!start || !end) return { ok: false, reason: 'no-handles' }
      const a = start.getBoundingClientRect()
      const b = end.getBoundingClientRect()
      const selfHit = !(a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left)
      const card = el.querySelector('.cal-slot-event, .cal-masters-event') as HTMLElement | null
      const cardBox = card?.getBoundingClientRect()
      const others = [...document.querySelectorAll('.cal-masters-event-shell, .cal-slot-event-shell')].filter((n) => n !== el)
      let neighborHit = false
      for (const other of others) {
        const otherCard = other.querySelector('.cal-slot-event, .cal-masters-event') as HTMLElement | null
        if (!otherCard) continue
        const o = otherCard.getBoundingClientRect()
        for (const h of [a, b]) {
          if (!(h.bottom <= o.top || o.bottom <= h.top || h.right <= o.left || o.right <= h.left)) {
            neighborHit = true
            break
          }
        }
        if (neighborHit) break
      }
      return {
        ok: !selfHit && !neighborHit,
        reason: selfHit ? 'self-overlap' : neighborHit ? 'neighbor-hit' : 'ok',
        short: el.classList.contains('is-short'),
        cardH: cardBox?.height ?? null,
        a: { t: a.top, b: a.bottom, h: a.height },
        b: { t: b.top, b: b.bottom, h: b.height },
      }
    })
    expect(geometry.ok, JSON.stringify(geometry)).toBe(true)
  })
})

test.describe('layout spillover smoke', () => {
  test('shop and calendar settings stay free of page overflow on phone/desktop', async ({ page }, info) => {
    test.skip(
      info.project.name !== 'phone-360' &&
        info.project.name !== 'phone-390' &&
        info.project.name !== 'phone-430' &&
        info.project.name !== 'desktop-1280',
      'key viewports',
    )
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    await loginUI(page, 'client1@demo.local')
    await page.goto('/shop')
    await expect(page.locator('h1, h2, .shop-tabs, .page').first()).toBeVisible({ timeout: 20_000 })
    await assertNoPageOverflow(page)

    // Auth lives in localStorage (zb.auth); cookies alone do not clear the session.
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.context().clearCookies()
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await page.getByTestId('calendar-open-settings').click()
    await expect(page.getByTestId('calendar-settings')).toBeVisible()
    const segmented = page.locator('.segmented, [data-testid="calendar-nav-mode"]')
    if (await segmented.count()) {
      const overlap = await segmented.first().evaluate((el) => {
        const labels = [...el.querySelectorAll('label, .btn, button')]
        const boxes = labels.map((n) => (n as HTMLElement).getBoundingClientRect())
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]
            const b = boxes[j]
            if (!(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)) return true
          }
        }
        return false
      })
      expect(overlap).toBe(false)
    }
    await assertNoPageOverflow(page)
  })
})
