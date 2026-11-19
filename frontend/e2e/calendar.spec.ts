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

    // Deterministic CSS fixture (seed event heights vary and can be too short for gutters).
    const injected = await page.evaluate(() => {
      const col = document.querySelector('.cal-masters-col, .cal-slot-grid') as HTMLElement | null
      if (!col) return false
      col.querySelectorAll('[data-testid="cal-handle-fixture"]').forEach((n) => n.remove())
      const mk = (top: number, short: boolean) => {
        const shellEl = document.createElement('div')
        shellEl.className = `cal-masters-event-shell${short ? ' is-short' : ''}`
        shellEl.setAttribute('data-testid', 'cal-handle-fixture')
        shellEl.style.cssText = `position:absolute;left:4px;right:4px;top:${top}px;height:${short ? 44 : 64}px;z-index:8;`
        shellEl.innerHTML = [
          '<span class="cal-resize-handle is-start"></span>',
          '<button type="button" class="cal-masters-event"></button>',
          '<span class="cal-resize-handle is-end"></span>',
        ].join('')
        col.appendChild(shellEl)
      }
      mk(160, true)
      mk(160 + 44 + 2, true)
      return true
    })
    expect(injected, 'masters/mobile column for handle fixture').toBe(true)
    const shell = page.locator('[data-testid="cal-handle-fixture"]').first()
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
      if (!cardBox) return { ok: false, reason: 'no-card' }
      // Handles must sit outside the colored card (gutter architecture).
      const outside = a.bottom <= cardBox.top + 1 && b.top >= cardBox.bottom - 1
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
        ok: !selfHit && !neighborHit && outside,
        reason: selfHit ? 'self-overlap' : neighborHit ? 'neighbor-hit' : !outside ? 'not-outside-card' : 'ok',
        short: el.classList.contains('is-short'),
        cardH: cardBox.height,
        a: { t: a.top, b: a.bottom, h: a.height },
        b: { t: b.top, b: b.bottom, h: b.height },
        card: { t: cardBox.top, b: cardBox.bottom },
      }
    })
    expect(geometry.ok, JSON.stringify(geometry)).toBe(true)
  })

  test('schedule editor keeps time fields inside the card on phones', async ({ page }, info) => {
    test.skip(
      info.project.name !== 'phone-360' && info.project.name !== 'phone-390' && info.project.name !== 'phone-430',
      'phone form',
    )
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar?panel=schedule&tab=hours')
    await expect(page.getByTestId('schedule-editor')).toBeVisible({ timeout: 20_000 })
    const layout = await page.evaluate(() => {
      const roots = [
        document.querySelector('[data-testid="weekly-hours-form"]'),
        document.querySelector('[data-testid="day-exception-form"]'),
        document.querySelector('[data-testid="work-mode-form"]'),
      ].filter(Boolean) as HTMLElement[]
      const issues: Array<{ id: string; overflow: number }> = []
      for (const root of roots) {
        const box = root.getBoundingClientRect()
        for (const el of root.querySelectorAll<HTMLElement>('input, select')) {
          const b = el.getBoundingClientRect()
          const overflow = Math.round(b.right - box.right)
          if (overflow > 1) issues.push({ id: el.id || el.getAttribute('type') || 'ctrl', overflow })
          if (Math.round(box.left - b.left) > 1) {
            issues.push({ id: `${el.id || 'ctrl'}-left`, overflow: Math.round(box.left - b.left) })
          }
        }
        if (root.scrollWidth > root.clientWidth + 2) {
          issues.push({ id: `${root.getAttribute('data-testid')}-scroll`, overflow: root.scrollWidth - root.clientWidth })
        }
      }
      // Measure the actual inputs — wrappers can look fine while native time chrome overlaps.
      const overlaps: Array<{ a: string; b: string; gap: number }> = []
      let stacked = false
      for (const pair of document.querySelectorAll('.schedule-time-pair')) {
        const inputs = [...pair.querySelectorAll('input')].map((n) => ({
          id: (n as HTMLInputElement).id || 'time',
          r: (n as HTMLElement).getBoundingClientRect(),
        }))
        if (inputs.length >= 2) {
          stacked = inputs[1].r.top >= inputs[0].r.bottom - 1
        }
        for (let i = 0; i < inputs.length; i++) {
          for (let j = i + 1; j < inputs.length; j++) {
            const a = inputs[i].r
            const b = inputs[j].r
            const hit = !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
            if (hit) overlaps.push({ a: inputs[i].id, b: inputs[j].id, gap: Math.round(Math.min(a.right, b.right) - Math.max(a.left, b.left)) })
          }
        }
      }
      const pairCols = document.querySelector('.schedule-time-pair')
        ? getComputedStyle(document.querySelector('.schedule-time-pair')!).gridTemplateColumns
        : null
      return { issues, overlaps, stacked, pairCols }
    })
    // eslint-disable-next-line no-console
    console.log('[schedule-time-layout]', info.project.name, JSON.stringify(layout))
    expect(layout.issues, JSON.stringify(layout.issues)).toEqual([])
    expect(layout.overlaps, JSON.stringify(layout.overlaps)).toEqual([])
    // Phones must stack С/До — side-by-side native time inputs clip on iOS.
    expect(layout.stacked, JSON.stringify(layout)).toBe(true)
    await assertNoPageOverflow(page)
  })

  test('week header and body day columns share left edges', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'key viewports')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await page.getByRole('button', { name: 'Неделя', exact: true }).click()
    await expect(page.locator('.calendar-wrap .fc-timegrid')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.fc-col-header-cell').first()).toBeVisible()
    const sync = await page.evaluate(() => {
      const headerCells = [...document.querySelectorAll('.fc-col-header-cell')]
      const bodyCols = [...document.querySelectorAll('.fc-timegrid-col')].filter(
        (n) => !n.classList.contains('fc-timegrid-axis'),
      )
      const headers = headerCells.map((n) => {
        const b = n.getBoundingClientRect()
        return { left: b.left, right: b.right, width: b.width, text: (n.textContent || '').trim() }
      })
      const bodies = bodyCols.map((n) => {
        const b = n.getBoundingClientRect()
        return { left: b.left, right: b.right, width: b.width }
      })
      if (!headers.length || !bodies.length) return { ok: false, reason: 'missing-cols', headers, bodies }
      const n = Math.min(headers.length, bodies.length)
      const deltas = []
      for (let i = 0; i < n; i++) deltas.push(Math.abs(headers[i].left - bodies[i].left))
      const max = Math.max(...deltas)
      return {
        ok: max <= 2,
        max,
        deltas,
        headers,
        bodies,
        reason: max <= 2 ? 'ok' : 'misaligned',
        fcPresent: Boolean(document.querySelector('.calendar-wrap .fc')),
      }
    })
    // eslint-disable-next-line no-console
    console.log('[fc-grid-sync]', info.project.name, JSON.stringify(sync))
    expect(sync.fcPresent).toBe(true)
    expect(sync.ok, JSON.stringify(sync)).toBe(true)
  })

  test('FullCalendar drag freezes scroll; cancel does not keep the move', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'key viewports')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await page.getByRole('button', { name: 'Неделя', exact: true }).click()
    await expect(page.locator('.calendar-wrap .fc-timegrid')).toBeVisible({ timeout: 15_000 })
    const event = page.locator('.fc-timegrid-event.fc-event-draggable, .fc-event.fc-event-draggable').first()
    if ((await event.count()) === 0) test.skip(true, 'no draggable FC event in seed')
    await event.scrollIntoViewIfNeeded()

    // Mark the scrollable timegrid scroller, then freeze its offset AFTER the event is in view.
    const scrollProbe = await page.evaluate(() => {
      document.querySelectorAll('[data-e2e-fc-scroll]').forEach((n) => n.removeAttribute('data-e2e-fc-scroll'))
      const nodes = [
        ...document.querySelectorAll<HTMLElement>(
          '.calendar-wrap .fc-scroller-liquid-absolute, .calendar-wrap .fc-scroller',
        ),
      ]
      const scrollable = nodes.find((el) => el.scrollHeight > el.clientHeight + 8) || nodes[0] || null
      if (!scrollable) return null
      // Keep the event visible: nudge from current position rather than jumping to 0.
      const nextTop = Math.min(scrollable.scrollTop + 40, Math.max(0, scrollable.scrollHeight - scrollable.clientHeight))
      scrollable.scrollTop = nextTop
      scrollable.scrollLeft = 0
      scrollable.setAttribute('data-e2e-fc-scroll', '1')
      return {
        top: scrollable.scrollTop,
        left: scrollable.scrollLeft,
        scrollHeight: scrollable.scrollHeight,
        clientHeight: scrollable.clientHeight,
        className: scrollable.className,
      }
    })
    expect(scrollProbe, 'FC scroller missing').toBeTruthy()
    const before = { top: scrollProbe!.top, left: scrollProbe!.left }
    const titleBefore = await event.evaluate((el) => (el.textContent || '').trim())
    const startBefore = await event.evaluate((el) => el.getBoundingClientRect().top)
    const box = await event.boundingBox()
    expect(box).toBeTruthy()
    // Aim at the card body center — avoid FC top/bottom resizers.
    const x = box!.x + box!.width / 2
    const y = box!.y + box!.height / 2

    // Mouse path: FC starts drag after eventDragMinDistance (16px), then our lock runs.
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 8, { steps: 2 })
    const preStartLock = await page.evaluate(() => document.body.classList.contains('is-cal-resizing'))
    await page.mouse.move(x, y + 64, { steps: 8 })
    await expect
      .poll(async () => page.evaluate(() => document.body.classList.contains('is-cal-resizing')), {
        timeout: 10_000,
      })
      .toBe(true)
    const during = await page.evaluate(() => {
      const scrollerEl = document.querySelector<HTMLElement>('[data-e2e-fc-scroll="1"]')
      return {
        locked: document.body.classList.contains('is-cal-resizing'),
        source: document.body.dataset.calGestureLockSource || null,
        top: scrollerEl?.scrollTop ?? null,
        left: scrollerEl?.scrollLeft ?? null,
      }
    })
    const timeBefore = await event.evaluate((el) => {
      const t = el.querySelector('.fc-event-time, .calendar-event-time')
      return (t?.textContent || el.textContent || '').replace(/\s+/g, ' ').trim()
    })

    // Cancel: return toward origin + Escape so FC reverts instead of committing a new slot.
    await page.mouse.move(x, y, { steps: 4 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect.poll(async () => page.evaluate(() => document.body.classList.contains('is-cal-resizing'))).toBe(false)

    const after = await page.evaluate(() => {
      const scrollerEl = document.querySelector<HTMLElement>('[data-e2e-fc-scroll="1"]')
      return { top: scrollerEl?.scrollTop ?? null, left: scrollerEl?.scrollLeft ?? null }
    })
    const scrolledAfter = await page.evaluate((targetTop) => {
      const scrollerEl = document.querySelector<HTMLElement>('[data-e2e-fc-scroll="1"]')
      if (!scrollerEl) return null
      const max = Math.max(0, scrollerEl.scrollHeight - scrollerEl.clientHeight)
      const next = Math.min(Math.max(targetTop, 0), max)
      scrollerEl.scrollTop = next
      return scrollerEl.scrollTop
    }, before.top + 24)

    const timeAfter = await event.evaluate((el) => {
      const t = el.querySelector('.fc-event-time, .calendar-event-time')
      return (t?.textContent || el.textContent || '').replace(/\s+/g, ' ').trim()
    })
    const startAfter = await event.boundingBox()
    const yDelta = startAfter ? Math.abs(startAfter.y - startBefore) : null

    // eslint-disable-next-line no-console
    console.log(
      '[fc-drag-scroll]',
      JSON.stringify({
        scrollProbe,
        before,
        during,
        after,
        scrolledAfter,
        preStartLock,
        timeBefore,
        timeAfter,
        yDelta,
      }),
    )

    expect(preStartLock, 'lock must not engage before FC drag distance/long-press').toBe(false)
    expect(during.locked).toBe(true)
    expect(during.source).toBe('fc-eventDragStart')
    expect(during.top).toBe(before.top)
    expect(during.left).toBe(before.left)
    expect(after.top).toBe(before.top)
    expect(scrolledAfter).toBeGreaterThan(before.top)

    // Cancelled drag must not keep a new time label; allow small visual jitter from FC mirror teardown.
    await expect(page.getByText(titleBefore.slice(0, Math.min(12, titleBefore.length))).first()).toBeVisible()
    expect(timeAfter).toBe(timeBefore)
    if (yDelta != null) expect(yDelta).toBeLessThan(120)
  })

  test('real calendar event handles sit outside the card (normal and short)', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'mobile geometry')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await page.getByRole('button', { name: 'День', exact: true }).click()
    await expect(page.getByTestId('calendar-mobile').or(page.getByTestId('calendar-masters-day'))).toBeVisible({
      timeout: 15_000,
    })

    const live = page.locator(
      '.cal-masters-event-shell:has(.cal-resize-handle), .cal-slot-event-shell:has(.cal-resize-handle)',
    )
    if ((await live.count()) === 0) {
      // Create a real personal block so geometry is measured on live DOM, not a CSS fixture.
      await page.getByRole('button', { name: '+ Событие' }).click()
      await expect(page.getByRole('heading', { name: 'Новое событие' })).toBeVisible()
      const start = page.locator('#cal-block-start')
      const end = page.locator('#cal-block-end')
      const startVal = await start.inputValue()
      const base = startVal || '2026-11-19T10:00'
      const [datePart, timePart] = base.split('T')
      const [hh, mm] = (timePart || '10:00').split(':').map(Number)
      const endMin = hh * 60 + (mm || 0) + 60
      const pad = (n: number) => String(n).padStart(2, '0')
      await end.fill(`${datePart}T${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`)
      await page.getByRole('button', { name: 'Добавить в календарь' }).click()
      await expect(page.getByRole('heading', { name: 'Новое событие' })).toHaveCount(0, { timeout: 20_000 })
    }

    const shells = page.locator(
      '.cal-masters-event-shell:has(.cal-resize-handle), .cal-slot-event-shell:has(.cal-resize-handle)',
    )
    await expect(shells.first()).toBeVisible({ timeout: 15_000 })
    // Prefer a mid-board event so external handles are not edge-clipped by the scrollport.
    const count = await shells.count()
    const probe = shells.nth(Math.min(1, Math.max(0, count - 1)))
    await probe.scrollIntoViewIfNeeded()

    const report = await page.evaluate(() => {
      const measure = (el: Element) => {
        const start = el.querySelector('.cal-resize-handle.is-start') as HTMLElement | null
        const end = el.querySelector('.cal-resize-handle.is-end') as HTMLElement | null
        const card = el.querySelector('.cal-slot-event, .cal-masters-event') as HTMLElement | null
        if (!start || !end || !card) return null
        const a = start.getBoundingClientRect()
        const b = end.getBoundingClientRect()
        const c = card.getBoundingClientRect()
        // Only treat local layout ancestors as clippers (page shell overflow is intentional).
        const clipped = (() => {
          let node: HTMLElement | null = el.parentElement
          while (node && node !== document.body) {
            if (
              node.classList.contains('calendar-shell') ||
              node.classList.contains('app-shell') ||
              node.classList.contains('page') ||
              node.classList.contains('calendar-page-root')
            ) {
              node = node.parentElement
              continue
            }
            const style = getComputedStyle(node)
            const clips =
              style.overflow === 'hidden' ||
              style.overflowY === 'hidden' ||
              style.overflow === 'clip' ||
              style.overflowY === 'clip'
            if (clips) {
              const nb = node.getBoundingClientRect()
              if (a.top < nb.top - 1 || b.bottom > nb.bottom + 1) return node.className || node.tagName
            }
            node = node.parentElement
          }
          return null
        })()
        const hitOk = (handle: HTMLElement) => {
          const r = handle.getBoundingClientRect()
          const x = r.left + r.width / 2
          const y = r.top + r.height / 2
          const hit = document.elementFromPoint(x, y)
          return Boolean(hit && (hit === handle || handle.contains(hit) || hit.closest('.cal-resize-handle') === handle))
        }
        return {
          short: el.classList.contains('is-short'),
          card: { t: c.top, b: c.bottom, h: c.height },
          start: { t: a.top, b: a.bottom, h: a.height },
          end: { t: b.top, b: b.bottom, h: b.height },
          outside: a.bottom <= c.top + 1 && b.top >= c.bottom - 1,
          clippedBy: clipped,
          pointerOk: getComputedStyle(start).pointerEvents !== 'none' && getComputedStyle(end).pointerEvents !== 'none',
          hitOk: hitOk(start) && hitOk(end),
        }
      }

      const all = [...document.querySelectorAll('.cal-masters-event-shell, .cal-slot-event-shell')]
        .map(measure)
        .filter(Boolean) as Array<NonNullable<ReturnType<typeof measure>>>
      const normal = all.find((x) => !x.short) || all[0] || null
      const short = all.find((x) => x.short) || null
      return { normal, short, count: all.length }
    })

    // eslint-disable-next-line no-console
    console.log('[real-handles]', JSON.stringify(report))

    expect(report.count).toBeGreaterThan(0)
    expect(report.normal, JSON.stringify(report)).toBeTruthy()
    expect(report.normal!.outside, JSON.stringify(report.normal)).toBe(true)
    expect(report.normal!.pointerOk).toBe(true)
    expect(report.normal!.clippedBy).toBeNull()
    expect(report.normal!.hitOk, JSON.stringify(report.normal)).toBe(true)

    let shortReport = report.short
    if (!shortReport) {
      // Seed may lack a short shell — mount an isolated short shell with production handle CSS.
      shortReport = await page.evaluate(() => {
        const col = document.querySelector('.cal-masters-col, .cal-slot-grid') as HTMLElement | null
        if (!col) return null
        col.querySelectorAll('[data-testid="cal-short-geometry"]').forEach((n) => n.remove())
        const shellEl = document.createElement('div')
        shellEl.className = 'cal-masters-event-shell is-short'
        shellEl.setAttribute('data-testid', 'cal-short-geometry')
        shellEl.style.cssText = 'position:absolute;left:4px;right:4px;top:220px;height:44px;z-index:9;'
        shellEl.innerHTML = [
          '<span class="cal-resize-handle is-start"></span>',
          '<button type="button" class="cal-masters-event">short</button>',
          '<span class="cal-resize-handle is-end"></span>',
        ].join('')
        col.appendChild(shellEl)
        shellEl.scrollIntoView({ block: 'center' })
        const startH = shellEl.querySelector('.cal-resize-handle.is-start') as HTMLElement
        const endH = shellEl.querySelector('.cal-resize-handle.is-end') as HTMLElement
        const card = shellEl.querySelector('.cal-masters-event') as HTMLElement
        const a = startH.getBoundingClientRect()
        const b = endH.getBoundingClientRect()
        const c = card.getBoundingClientRect()
        const hit = (handle: HTMLElement) => {
          const r = handle.getBoundingClientRect()
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return Boolean(el && (el === handle || handle.contains(el) || el.closest('.cal-resize-handle') === handle))
        }
        return {
          short: true,
          card: { t: c.top, b: c.bottom, h: c.height },
          start: { t: a.top, b: a.bottom, h: a.height },
          end: { t: b.top, b: b.bottom, h: b.height },
          outside: a.bottom <= c.top + 1 && b.top >= c.bottom - 1,
          clippedBy: null as string | null,
          pointerOk: getComputedStyle(startH).pointerEvents !== 'none' && getComputedStyle(endH).pointerEvents !== 'none',
          hitOk: hit(startH) && hit(endH),
          source: 'isolated-short-shell',
        }
      })
      // eslint-disable-next-line no-console
      console.log('[real-handles-short]', JSON.stringify(shortReport))
    }
    expect(shortReport, 'short event geometry missing').toBeTruthy()
    expect(shortReport!.outside, JSON.stringify(shortReport)).toBe(true)
    expect(shortReport!.pointerOk).toBe(true)
    expect(shortReport!.hitOk, JSON.stringify(shortReport)).toBe(true)
  })

  test('resize gesture freezes calendar scroll and restores afterwards', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'mobile gesture')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await page.getByRole('button', { name: 'День', exact: true }).click()
    const board = page.getByTestId('calendar-mobile').or(page.getByTestId('calendar-masters-day'))
    await expect(board).toBeVisible({ timeout: 15_000 })

    const handle = page.locator('.cal-resize-handle.is-end').first()
    if ((await handle.count()) === 0) {
      test.skip(true, 'no live resize handle in seed — physical gesture lock covered by unit lockCalendarGesture')
    }
    await handle.scrollIntoViewIfNeeded()
    const scroller = page.locator('.cal-masters-scroll, .cal-mobile-body').first()
    if ((await scroller.count()) === 0) {
      test.skip(true, 'custom day scrollport not present')
    }
    await scroller.evaluate((el) => {
      ;(el as HTMLElement).scrollTop = 40
      ;(el as HTMLElement).scrollLeft = 12
    })
    const before = await scroller.evaluate((el) => ({
      top: (el as HTMLElement).scrollTop,
      left: (el as HTMLElement).scrollLeft,
    }))
    const box = await handle.boundingBox()
    expect(box).toBeTruthy()
    const x = box!.x + box!.width / 2
    const y = box!.y + box!.height / 2
    // Successful resize path: lock on pointerdown, freeze during move, unlock on pointerup.
    await handle.evaluate(
      (target, point) => {
        target.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: 'touch',
            clientX: point.x,
            clientY: point.y,
            buttons: 1,
          }),
        )
      },
      { x, y },
    )
    await expect.poll(async () => page.evaluate(() => document.body.dataset.calGestureLockSource || '')).toBe(
      'custom-resize-pointerdown',
    )
    await page.evaluate(
      ({ x, y }) => {
        window.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: 'touch',
            clientX: x,
            clientY: y + 28,
            buttons: 1,
          }),
        )
      },
      { x, y },
    )
    const during = await scroller.evaluate((el) => ({
      top: (el as HTMLElement).scrollTop,
      left: (el as HTMLElement).scrollLeft,
    }))
    await page.evaluate(() => {
      window.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: 'touch',
          clientX: 0,
          clientY: 0,
        }),
      )
    })
    await expect.poll(async () => page.evaluate(() => document.body.classList.contains('is-cal-resizing'))).toBe(false)
    const afterOk = await scroller.evaluate((el) => ({
      top: (el as HTMLElement).scrollTop,
      left: (el as HTMLElement).scrollLeft,
    }))
    // eslint-disable-next-line no-console
    console.log('[resize-scroll]', JSON.stringify({ before, during, afterOk }))
    expect(during).toEqual(before)
    expect(afterOk).toEqual(before)

    // Cancel path: pointercancel must unlock without leaving a stuck lock.
    await handle.evaluate(
      (target, point) => {
        target.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 2,
            pointerType: 'touch',
            clientX: point.x,
            clientY: point.y,
            buttons: 1,
          }),
        )
      },
      { x, y },
    )
    await expect.poll(async () => page.evaluate(() => document.body.classList.contains('is-cal-resizing'))).toBe(true)
    await page.evaluate(() => {
      window.dispatchEvent(
        new PointerEvent('pointercancel', {
          bubbles: true,
          cancelable: true,
          pointerId: 2,
          pointerType: 'touch',
        }),
      )
    })
    await expect.poll(async () => page.evaluate(() => document.body.classList.contains('is-cal-resizing'))).toBe(false)
    await scroller.evaluate((el, top) => {
      ;(el as HTMLElement).scrollTop = top + 15
    }, before.top)
    expect(await scroller.evaluate((el) => (el as HTMLElement).scrollTop)).toBe(before.top + 15)
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
