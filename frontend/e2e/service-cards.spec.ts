import { test, expect, type Page } from '@playwright/test'

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

async function loginUI(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

/** Assert cover and text body do not share overlapping client rects. */
async function assertNoImageTextOverlap(page: Page) {
  const cards = page.getByTestId('service-card')
  const count = await cards.count()
  expect(count).toBeGreaterThan(0)

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i)
    const overlap = await card.evaluate((el) => {
      const cover = el.querySelector('.media-first-cover') as HTMLElement | null
      const title = el.querySelector('.service-card-title') as HTMLElement | null
      const body = el.querySelector('.service-card-body') as HTMLElement | null
      if (!cover || !title || !body) return { ok: false, reason: 'missing-nodes' as const }
      const a = cover.getBoundingClientRect()
      const b = title.getBoundingClientRect()
      const intersects = !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)
      const overlay = el.querySelector('.media-first-overlay')
      const overlayVisible = overlay
        ? getComputedStyle(overlay).display !== 'none' && getComputedStyle(overlay).visibility !== 'hidden'
        : false
      const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      return {
        ok: !intersects && !overlayVisible && !overflowX,
        intersects,
        overlayVisible,
        overflowX,
        titleText: title.textContent?.trim() ?? '',
      }
    })
    expect(overlap.ok, JSON.stringify(overlap)).toBe(true)
    expect(overlap.titleText.length).toBeGreaterThan(0)
  }
}

test.describe('Service catalog cards layout', () => {
  test.beforeEach(async () => {
    if (!(await apiHealthy())) {
      test.skip(true, `API unhealthy at ${api}`)
    }
  })

  test('image does not cover title/meta on /services', async ({ page }) => {
    await loginUI(page, 'master1@demo.local')
    await page.goto('/services')
    await expect(page.getByTestId('service-card').first()).toBeVisible({ timeout: 20_000 })
    await assertNoImageTextOverlap(page)
  })

  test('master booking service rows keep thumb and title separate', async ({ page }) => {
    await loginUI(page, 'client1@demo.local')
    // Seeded master public page with services
    await page.goto('/search')
    const first = page.locator('a.search-master-card').first()
    await expect(first).toBeVisible({ timeout: 20_000 })
    await first.click()
    await expect(page.getByTestId('mp-service').first()).toBeVisible({ timeout: 20_000 })

    const row = page.getByTestId('mp-service').first()
    const ok = await row.evaluate((el) => {
      const thumb = el.querySelector('.mp-service-thumb') as HTMLElement | null
      const title = el.querySelector('.mp-service-main strong') as HTMLElement | null
      if (!thumb || !title) return false
      const a = thumb.getBoundingClientRect()
      const b = title.getBoundingClientRect()
      return a.right <= b.left + 1
    })
    expect(ok).toBe(true)
  })
})
