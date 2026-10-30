import { test, expect, type Page } from '@playwright/test'

const api = process.env.VITE_API_BASE_URL ?? 'http://localhost:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'

const WIDTHS = [360, 390, 768, 1024, 1440] as const

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

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    return doc.scrollWidth > doc.clientWidth + 1
  })
  expect(overflow).toBe(false)
}

async function assertSearchField(page: Page, opts?: { testId?: string; label?: string | RegExp }) {
  const input = opts?.testId
    ? page.getByTestId(opts.testId)
    : opts?.label
      ? page.getByLabel(opts.label)
      : page.locator('.search-field__input').first()
  await expect(input).toBeVisible()
  const box = await input.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40)
  await expect(page.locator('.search-field__icon').first()).toBeVisible()
}

test.describe('UI unification adaptive smoke', () => {
  test.beforeEach(async () => {
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
  })

  for (const width of WIDTHS) {
    test(`width ${width}: search shop knowledge contacts clients nav calendar`, async ({ page }, testInfo) => {
      // Run each width once on the closest project to keep suite time reasonable.
      const project = testInfo.project.name
      const allow =
        (width === 360 && project === 'phone-360') ||
        (width === 390 && project === 'phone-390') ||
        (width === 768 && project === 'tablet-768') ||
        (width === 1024 && project === 'laptop-1366') ||
        (width === 1440 && project === 'desktop-1920')
      test.skip(!allow, `mapped to other project`)

      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 })
      await loginUI(page, 'master1@demo.local')

      // Search (also leaves owner-home chrome so shell nav is visible)
      await page.goto('/search')
      await assertSearchField(page, { label: 'Имя или специализация' })
      await assertNoHorizontalOverflow(page)

      // Navigation icons — bottomnav on phone, sidenav on wider layouts
      const navIcon = width < 768
        ? page.locator('.bottomnav .nav-icon').first()
        : page.locator('.sidenav .nav-icon, nav .nav-icon').first()
      await expect(navIcon).toBeVisible({ timeout: 15_000 })
      await expect(navIcon.locator('path, circle, rect').first()).toBeVisible()

      // Shop
      await page.goto('/shop')
      await assertSearchField(page, { label: 'Поиск' })
      await assertNoHorizontalOverflow(page)

      // Knowledge
      await page.goto('/knowledge')
      await assertSearchField(page, { testId: 'kb-search' })
      await page.getByTestId('kb-search').fill('test')
      await expect(page.getByRole('button', { name: 'Очистить поиск' })).toBeVisible()
      await page.getByRole('button', { name: 'Очистить поиск' }).click()
      await expect(page.getByTestId('kb-search')).toHaveValue('')
      await assertNoHorizontalOverflow(page)

      // Contacts
      await page.goto('/contacts')
      await assertSearchField(page, { label: 'Найти в контактах' })
      await assertNoHorizontalOverflow(page)

      // Clients
      await page.goto('/clients')
      await assertSearchField(page, { testId: 'clients-search' })
      await assertNoHorizontalOverflow(page)

      // Calendar — radius/tokens smoke
      await page.goto('/calendar')
      await expect(page.locator('main, .calendar-shell, .page').first()).toBeVisible({ timeout: 15_000 })
      await assertNoHorizontalOverflow(page)

      // Mobile more-nav open (narrow only)
      if (width <= 430) {
        const more = page.getByRole('button', { name: /Ещё|More/i }).or(page.locator('a[href="/more"], button:has(.nav-icon)').filter({ hasText: /Ещё/ }))
        if (await more.first().isVisible().catch(() => false)) {
          await more.first().click()
          await assertNoHorizontalOverflow(page)
        }
      }
    })
  }
})
