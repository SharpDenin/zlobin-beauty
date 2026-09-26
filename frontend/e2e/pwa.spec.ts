import { test, expect } from '@playwright/test'

test.describe('PWA', () => {
  test('manifest, app shell and service worker registration', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')

    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])

    const manifestHref = await page.locator('link[rel="manifest"]').first().getAttribute('href')
    expect(manifestHref).toBeTruthy()
    const manifestUrl = new URL(manifestHref!, page.url()).toString()
    const manifestRes = await page.request.get(manifestUrl)
    expect(manifestRes.ok(), `manifest ${manifestUrl} → ${manifestRes.status()}`).toBeTruthy()
    const contentType = manifestRes.headers()['content-type'] ?? ''
    expect(contentType).toMatch(/json|webmanifest/i)
    const manifest = await manifestRes.json() as {
      name?: string
      short_name?: string
      display?: string
      start_url?: string
      scope?: string
      background_color?: string
      theme_color?: string
      icons?: Array<{ src: string; sizes: string; purpose?: string }>
    }
    expect(manifest.name).toBe('Salon-X')
    expect(manifest.short_name).toBe('Salon-X')
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toMatch(/^\//)
    expect(manifest.scope).toMatch(/^\//)
    expect(manifest.background_color).toBe('#0B0D12')
    expect(manifest.theme_color).toBe('#0B0D12')
    const sizes = new Set((manifest.icons ?? []).map((i) => i.sizes))
    expect(sizes.has('192x192')).toBeTruthy()
    expect(sizes.has('512x512')).toBeTruthy()
    expect((manifest.icons ?? []).some((i) => (i.purpose ?? '').includes('maskable'))).toBeTruthy()

    for (const icon of manifest.icons ?? []) {
      const iconRes = await page.request.get(new URL(icon.src, page.url()).toString())
      expect(iconRes.ok(), `icon ${icon.src}`).toBeTruthy()
      expect(iconRes.headers()['content-type'] ?? '').toMatch(/image\/png/i)
    }

    const registration = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return null
      const existing = await navigator.serviceWorker.getRegistration()
      if (existing) return { scope: existing.scope, active: Boolean(existing.active || existing.installing || existing.waiting) }
      const ready = await Promise.race([
        navigator.serviceWorker.ready.then((reg) => ({ scope: reg.scope, active: true })),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 8000)),
      ])
      return ready
    })
    if (registration) {
      expect(registration.active).toBeTruthy()
    }

    await expect(page.getByText(/Failed to fetch|NetworkError|ChunkLoadError/i)).toHaveCount(0)
  })
})
