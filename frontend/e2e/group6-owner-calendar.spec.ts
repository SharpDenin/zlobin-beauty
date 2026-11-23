import { test, expect, type Page } from '@playwright/test'

const api = process.env.VITE_API_BASE_URL ?? 'http://localhost:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'

const VIEWPORTS = ['phone-360', 'phone-390', 'phone-430', 'desktop-1280'] as const

async function apiHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${api}/healthz`, { signal: AbortSignal.timeout(4000) })
    return res.ok
  } catch {
    return false
  }
}

async function apiLogin(email: string) {
  const res = await fetch(`${api}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(res.ok, `login ${email} → ${res.status}`).toBeTruthy()
  return (await res.json()) as { access_token: string; refresh_token?: string; user: { id: string } }
}

async function loginViaStorage(page: Page, email: string, path = '/') {
  const session = await apiLogin(email)
  await page.addInitScript((auth) => {
    localStorage.setItem(
      'zb.auth',
      JSON.stringify({
        accessToken: auth.access_token,
        refreshToken: auth.refresh_token ?? '',
      }),
    )
  }, session)
  await page.goto(path)
}

async function dismissBlockingOverlays(page: Page) {
  for (let i = 0; i < 4; i++) {
    const overlay = page.locator('[data-overlay="true"]')
    if ((await overlay.count()) === 0) break
    const gotIt = page.getByRole('button', { name: 'Понятно' })
    if (await gotIt.isVisible().catch(() => false)) {
      await gotIt.click()
      await page.waitForTimeout(150)
      continue
    }
    const close = page.getByRole('button', { name: 'Закрыть' }).last()
    if (await close.isVisible().catch(() => false)) {
      await close.click()
      await page.waitForTimeout(150)
      continue
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
}

async function assertNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    return doc.scrollWidth - doc.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(1)
}

test.describe('Group 6 owner calendar', () => {
  test('owner day/week boards, master filter, master card', async ({ page }, info) => {
    test.skip(!VIEWPORTS.includes(info.project.name as typeof VIEWPORTS[number]), 'target viewports')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    await loginViaStorage(page, 'admin1@demo.local', '/calendar')
    await dismissBlockingOverlays(page)
    await expect(page.getByTestId('calendar-view-tabs')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('calendar-owner-master-filter')).toBeVisible()
    await expect(page.getByTestId('calendar-open-schedule')).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Событие' })).toBeVisible()

    // Day board (owner multi-master) — already default on mobile for owner.
    await page.getByTestId('calendar-view-tabs').getByRole('button', { name: 'День' }).click()
    await dismissBlockingOverlays(page)
    await expect(page.getByTestId('calendar-masters-day').or(page.getByTestId('calendar-pick-branch'))).toBeVisible({
      timeout: 15_000,
    })
    await assertNoPageOverflow(page)

    if (await page.getByTestId('calendar-pick-branch').isVisible().catch(() => false)) {
      await page.getByTestId('calendar-open-settings').click()
      const branch = page.getByTestId('calendar-branch-switcher')
      await expect(branch).toBeVisible()
      const options = branch.locator('option')
      const count = await options.count()
      if (count > 1) {
        await branch.selectOption({ index: 1 })
      }
      await dismissBlockingOverlays(page)
    }

    await expect(page.getByTestId('calendar-masters-day')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('calendar-owner-schedule-title')).toBeVisible()
    await expect(page.getByTestId('calendar-owner-today')).toBeVisible()

    // Master filter — all masters
    await page.getByTestId('calendar-owner-master-filter-trigger').click()
    await expect(page.getByTestId('calendar-owner-master-all')).toBeChecked()
    await page.keyboard.press('Escape')

    // Week board
    await page.getByTestId('calendar-view-tabs').getByRole('button', { name: 'Неделя' }).click()
    await expect(page.getByTestId('calendar-masters-week')).toBeVisible({ timeout: 15_000 })
    await assertNoPageOverflow(page)

    // Month keeps FC / mobile month (not multi-col week board)
    await page.getByTestId('calendar-view-tabs').getByRole('button', { name: 'Месяц' }).click()
    await expect(page.getByTestId('calendar-masters-week')).toHaveCount(0)
    await assertNoPageOverflow(page)

    // Back to day — open a visible master card (prefer a named master over fallback «Мастер»).
    await page.getByTestId('calendar-view-tabs').getByRole('button', { name: 'День' }).click()
    await expect(page.getByTestId('calendar-masters-day')).toBeVisible({ timeout: 15_000 })
    const buttons = page.locator('[data-testid^="calendar-master-open-"]')
    const n = await buttons.count()
    let target = buttons.first()
    for (let i = 0; i < n; i++) {
      const label = (await buttons.nth(i).getAttribute('aria-label')) ?? ''
      if (label && !label.endsWith(' Мастер')) {
        target = buttons.nth(i)
        break
      }
    }
    if (n > 0) {
      const testId = await target.getAttribute('data-testid')
      const masterId = testId?.replace('calendar-master-open-', '') ?? ''
      await target.scrollIntoViewIfNeeded()
      await target.click({ force: true })
      await expect(page).toHaveURL(new RegExp(`/masters/${masterId}`), { timeout: 15_000 })
    }
  })

  test('owner schedule targeting requires single master; targets that master', async ({ page }, info) => {
    test.skip(!VIEWPORTS.includes(info.project.name as typeof VIEWPORTS[number]), 'target viewports')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    await loginViaStorage(page, 'admin1@demo.local', '/calendar')
    await dismissBlockingOverlays(page)
    await expect(page.getByTestId('calendar-masters-day').or(page.getByTestId('calendar-pick-branch'))).toBeVisible({
      timeout: 20_000,
    })
    if (await page.getByTestId('calendar-pick-branch').isVisible().catch(() => false)) {
      await page.getByTestId('calendar-open-settings').click()
      const branch = page.getByTestId('calendar-branch-switcher')
      if ((await branch.locator('option').count()) > 1) await branch.selectOption({ index: 1 })
      await dismissBlockingOverlays(page)
    }
    await expect(page.getByTestId('calendar-masters-day')).toBeVisible({ timeout: 15_000 })

    // «Все мастера» — do not open ScheduleEditor as current user
    await page.getByTestId('calendar-open-schedule').click()
    await expect(page.getByTestId('schedule-editor')).toHaveCount(0)
    // Toast is best-effort (short-lived); hard guarantee is no editor opened as self.
    await expect(page.getByTestId('schedule-editor-target-master')).toHaveCount(0)

    // Pick exactly one master via column header id (stable), then mirror in filter UI.
    const openBtns = page.locator('[data-testid^="calendar-master-open-"]')
    await expect(openBtns.first()).toBeVisible({ timeout: 15_000 })
    const masterId = ((await openBtns.first().getAttribute('data-testid')) ?? '').replace('calendar-master-open-', '')
    expect(masterId.length).toBeGreaterThan(8)

    await page.getByTestId('calendar-owner-master-filter-trigger').click()
    await expect(page.locator('.cal-owner-master-filter-panel')).toBeVisible()
    const masterInputs = page.locator('input[data-testid^="calendar-owner-master-"]:not([data-testid="calendar-owner-master-all"])')
    const masterCount = await masterInputs.count()
    test.skip(masterCount < 1, 'no branch masters to target')

    // From «Все»: DOM click avoids flaky detach on narrow viewports
    await page.getByTestId(`calendar-owner-master-${masterId}`).evaluate((el) => (el as HTMLInputElement).click())
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('calendar-owner-master-filter-trigger')).not.toHaveText('Все мастера', {
      timeout: 8_000,
    })

    await page.getByTestId('calendar-open-schedule').click()
    await expect(page.getByTestId('schedule-editor')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('schedule-editor')).toHaveAttribute('data-schedule-target', masterId)
    await expect(page.getByTestId('schedule-editor-target-master')).toHaveText(masterId)
    await expect(page.getByTestId('schedule-editor')).not.toHaveAttribute('data-schedule-target', 'self')

    await page.getByRole('button', { name: 'Закрыть' }).last().click()
    await expect(page.getByTestId('schedule-editor')).toHaveCount(0)

    // Multi-select: add second master → block again
    if (masterCount >= 2 && (await openBtns.count()) >= 2) {
      const secondId = ((await openBtns.nth(1).getAttribute('data-testid')) ?? '').replace('calendar-master-open-', '')
      await page.getByTestId('calendar-owner-master-filter-trigger').click()
      await expect(page.locator('.cal-owner-master-filter-panel')).toBeVisible()
      await page.getByTestId(`calendar-owner-master-${secondId}`).evaluate((el) => (el as HTMLInputElement).click())
      await page.keyboard.press('Escape')
      await page.getByTestId('calendar-open-schedule').click()
      await expect(page.getByTestId('schedule-editor')).toHaveCount(0)
      await expect(page.getByTestId('schedule-editor-target-master')).toHaveCount(0)
    }
  })

  test('master calendar regression smoke (day/week/month)', async ({ page }, info) => {
    test.skip(!VIEWPORTS.includes(info.project.name as typeof VIEWPORTS[number]), 'target viewports')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    // employee1 is seeded as salon staff master (role=master), not an org owner.
    await loginViaStorage(page, 'employee1@demo.local', '/calendar')
    await dismissBlockingOverlays(page)
    await expect(page.getByTestId('calendar-view-tabs')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: /мой календарь/i }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('calendar-owner-master-filter')).toHaveCount(0)
    await expect(page.getByTestId('calendar-masters-day')).toHaveCount(0)
    await expect(page.getByTestId('calendar-masters-week')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Список', exact: true })).toBeVisible()

    await page.getByTestId('calendar-view-tabs').getByRole('button', { name: 'День' }).click()
    await expect(
      page.getByTestId('calendar-mobile').or(page.locator('.calendar-shell.is-mobile-fc')).or(page.locator('.calendar-wrap .fc')).first(),
    ).toBeVisible({ timeout: 15_000 })
    await assertNoPageOverflow(page)

    // Master ScheduleEditor stays self-targeted
    await page.getByTestId('calendar-open-schedule').click()
    await expect(page.getByTestId('schedule-editor')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('schedule-editor')).toHaveAttribute('data-schedule-target', 'self')
    await page.getByRole('button', { name: 'Закрыть' }).last().click()

    await page.getByTestId('calendar-view-tabs').getByRole('button', { name: 'Неделя' }).click()
    await expect(page.getByTestId('calendar-masters-week')).toHaveCount(0)
    await assertNoPageOverflow(page)

    await page.getByTestId('calendar-view-tabs').getByRole('button', { name: 'Месяц' }).click()
    await assertNoPageOverflow(page)

    await page.getByTestId('calendar-view-tabs').getByRole('button', { name: 'Список' }).click()
    await assertNoPageOverflow(page)
  })
})
