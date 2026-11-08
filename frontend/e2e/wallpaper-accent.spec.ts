import { test, expect } from '@playwright/test'

const WALLPAPERS = ['forest-water', 'mist-canyon', 'pebble-shore'] as const

test.describe('Wallpaper accent palette', () => {
  for (const id of WALLPAPERS) {
    test(`extracts or caches accent for ${id}`, async ({ page }) => {
      await page.goto('/login')
      await page.evaluate((bgId) => {
        localStorage.setItem('zb.home-bg', bgId)
        localStorage.removeItem('zb.home-bg-media')
        localStorage.removeItem('zb.home-bg-accent')
        localStorage.setItem('zb.theme', 'dark')
      }, id)
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

      await page.waitForFunction(
        (bgId) => {
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
        id,
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

      // Theme toggle re-tunes without clearing the cached raw hue.
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
    await page.evaluate(() => {
      localStorage.setItem('zb.home-bg', 'mist-canyon')
      localStorage.removeItem('zb.home-bg-media')
      localStorage.setItem(
        'zb.home-bg-accent',
        JSON.stringify({
          v: 1,
          map: { 'system:mist-canyon': '#9FCB9A' },
          activeKey: 'system:mist-canyon',
        }),
      )
      localStorage.setItem('zb.theme', 'dark')
    })
    await page.reload()
    // Boot script + applyAccent should keep a non-default primary close to cached mint.
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim().toLowerCase(),
    )
    expect(primary).toBeTruthy()
    expect(primary).not.toBe('#7c82ff')
  })
})
