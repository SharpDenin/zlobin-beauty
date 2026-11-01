import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const api = process.env.VITE_API_BASE_URL ?? 'http://localhost:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'
const shotDir = path.join('test-results', 'portfolio-gif')

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

test.describe('portfolio GIF still preview (PORT-01)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(shotDir, { recursive: true })
  })

  test.beforeEach(async () => {
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
  })

  for (const width of [360, 390, 768, 1024, 1440] as const) {
    test(`portfolio surfaces adaptive @${width}`, async ({ page }, info) => {
      test.skip(info.project.name !== 'phone-390', 'drive widths from one worker')
      await page.setViewportSize({ width, height: width <= 430 ? 844 : 900 })
      await loginUI(page, 'master1@demo.local')

      // Public master portfolio grid (may be photo-only in seed; still validates layout).
      await page.goto('/master')
      // Prefer client-facing master page if cabinet has profile link; else search.
      await page.goto('/search')
      await page.getByRole('button', { name: /Искать|Найти/i }).click()
      const masterCard = page.locator('a.list-item').filter({ hasText: /Анна|Волков|мастер/i }).first()
      if (await masterCard.count()) {
        await masterCard.click()
        const grid = page.locator('.portfolio-tight-grid')
        if (await grid.count()) {
          await expect(grid.first()).toBeVisible({ timeout: 15_000 })
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
          expect(overflow).toBe(false)
          const cell = grid.locator('.portfolio-cell').first()
          if (await cell.count()) {
            await cell.click()
            await expect(page.getByRole('button', { name: 'Закрыть' })).toBeVisible({ timeout: 8_000 })
            await page.getByRole('button', { name: 'Закрыть' }).click()
            await expect(grid.first()).toBeVisible()
          }
          await page.screenshot({ path: path.join(shotDir, `master-portfolio-${width}.png`), fullPage: false })
        }
      }

      // Cabinet portfolio thumbs
      await page.goto('/master')
      const thumbs = page.locator('.portfolio-thumb, [data-still-frame], .list-item img')
      await page.screenshot({ path: path.join(shotDir, `cabinet-${width}.png`), fullPage: false })
      const overflowCab = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
      expect(overflowCab).toBe(false)
      void thumbs
    })
  }
})
