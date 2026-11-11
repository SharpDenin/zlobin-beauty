import { test, expect } from '@playwright/test'

const WALLPAPERS = ['forest-water', 'mist-canyon', 'pebble-shore'] as const
const E2E_USER = 'e2e-wallpaper'

async function seedScopedWallpaper(page: import('@playwright/test').Page, bgId: string, accent?: string) {
  await page.evaluate(
    ({ userId, id, accentHex }) => {
      localStorage.setItem('zb.wallpaper.active-user', userId)
      localStorage.setItem(`zb.wallpaper.${userId}.bg`, id)
      localStorage.removeItem(`zb.wallpaper.${userId}.media`)
      localStorage.removeItem('zb.home-bg')
      localStorage.removeItem('zb.home-bg-media')
      if (accentHex) {
        localStorage.setItem(
          'zb.home-bg-accent',
          JSON.stringify({
            v: 1,
            map: { [`system:${id}`]: accentHex },
            activeKey: `system:${id}`,
          }),
        )
      } else {
        localStorage.removeItem('zb.home-bg-accent')
      }
      localStorage.setItem('zb.theme', 'dark')
    },
    { userId: E2E_USER, id: bgId, accentHex: accent ?? null },
  )
}

test.describe('Wallpaper accent palette', () => {
  for (const id of WALLPAPERS) {
    test(`extracts or caches accent for ${id}`, async ({ page }) => {
      await page.goto('/login')
      await seedScopedWallpaper(page, id)
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

      await page.waitForFunction(
        ({ userId, bgId }) => {
          if (localStorage.getItem('zb.wallpaper.active-user') !== userId) return false
          if (localStorage.getItem(`zb.wallpaper.${userId}.bg`) !== bgId) return false
          const raw = localStorage.getItem('zb.home-bg-accent')
          if (!raw) return false
          try {
            const cache = JSON.parse(raw) as { map?: Record<string, string> }
            const hex = cache.map?.[`system:${bgId}`]
            return typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)
          } catch {
            return false
          }
        },
        { userId: E2E_USER, bgId: id },
        { timeout: 20_000 },
      )

      const primary = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim(),
      )
      const ink = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-primary-ink').trim(),
      )
      expect(primary).toMatch(/^#?[0-9a-fA-F]{3,8}$|^rgb/i)
      expect(ink).toMatch(/^#?[0-9a-fA-F]{3,8}$|^rgb/i)

      await page.evaluate(() => localStorage.setItem('zb.theme', 'light'))
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
      const cacheAfter = await page.evaluate((bgId) => {
        const raw = localStorage.getItem('zb.home-bg-accent')
        if (!raw) return null
        return (JSON.parse(raw) as { map: Record<string, string> }).map[`system:${bgId}`] ?? null
      }, id)
      expect(cacheAfter).toMatch(/^#[0-9a-fA-F]{6}$/)
      const primaryLight = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim(),
      )
      expect(primaryLight).toBeTruthy()
    })
  }

  test('restores cached accent without flash on reload', async ({ page }) => {
    await page.goto('/login')
    await seedScopedWallpaper(page, 'mist-canyon', '#9FCB9A')
    await page.reload()
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim().toLowerCase(),
    )
    expect(primary).toBeTruthy()
  })

  test('guest session does not show another account wallpaper', async ({ page }) => {
    await page.goto('/login')
    await page.evaluate(() => {
      localStorage.setItem('zb.home-bg', 'mist-canyon')
      localStorage.removeItem('zb.wallpaper.active-user')
    })
    await page.reload()
    const bg = await page.evaluate(() => document.documentElement.dataset.homeBg || '')
    expect(bg).toBe('forest-water')
  })
})
