import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import { PNG } from './helpers/png-fixture'

const api = process.env.VITE_API_BASE_URL ?? 'http://localhost:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'
const fixtureDir = path.join('test-results', 'image-crop-fixtures')
const shotDir = path.join('test-results', 'image-crop')

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

function writeFixture(name: string, width: number, height: number): string {
  fs.mkdirSync(fixtureDir, { recursive: true })
  const filePath = path.join(fixtureDir, name)
  fs.writeFileSync(filePath, PNG.solid(width, height, [40, 120, 200, 255]))
  return filePath
}

test.describe('image zoom + crop editor', () => {
  test.beforeAll(() => {
    fs.mkdirSync(shotDir, { recursive: true })
    writeFixture('portrait.png', 480, 800)
    writeFixture('landscape.png', 1200, 675)
  })

  test.beforeEach(async () => {
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
  })

  test('opens crop UI on wallpaper upload (mobile)', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'mobile viewport sample')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/settings/appearance')
    await expect(page.getByTestId('settings-appearance')).toBeVisible()

    const portrait = path.join(fixtureDir, 'portrait.png')
    await page.getByTestId('settings-bg-upload').setInputFiles(portrait)

    const editor = page.getByTestId('image-crop-editor')
    await expect(editor).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('image-crop-stage')).toBeVisible()
    await expect(page.getByTestId('image-crop-zoom')).toBeVisible()

    // Zoom control
    await page.getByTestId('image-crop-zoom').fill('2')
    await expect(page.getByTestId('image-crop-zoom')).toHaveValue('2')

    // Reset returns to min zoom
    await page.getByTestId('image-crop-reset').click()
    await expect(page.getByTestId('image-crop-zoom')).toHaveValue('1')

    // Cancel must not upload / change current wallpaper selection message
    await page.getByTestId('image-crop-cancel').click()
    await expect(editor).toHaveCount(0)

    // Re-open with landscape, confirm cropped upload
    const landscape = path.join(fixtureDir, 'landscape.png')
    const uploadPromise = page.waitForResponse(
      (r) => r.url().includes('/v1/media') && r.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await page.getByTestId('settings-bg-upload').setInputFiles(landscape)
    await expect(editor).toBeVisible({ timeout: 10_000 })

    // Free-form crop: Cropper must not lock aspect (NaN / 0 / undefined).
    const aspectState = await page.evaluate(() => {
      const img = document.querySelector('[data-testid="image-crop-source"]') as HTMLImageElement & {
        cropper?: { options?: { aspectRatio?: number }; getData?: (rounded?: boolean) => { width: number; height: number } }
      }
      const cropper = img?.cropper
      const ratio = cropper?.options?.aspectRatio
      const free = ratio == null || Number.isNaN(ratio) || ratio === 0
      const before = cropper?.getData?.(true)
      return { free, beforeW: before?.width ?? 0, beforeH: before?.height ?? 0 }
    })
    expect(aspectState.free).toBe(true)

    // Drag pan inside crop stage (mouse ≈ finger drag on Chromium mobile project)
    const stage = page.getByTestId('image-crop-stage')
    const box = await stage.boundingBox()
    expect(box).toBeTruthy()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 + 30)
      await page.mouse.up()
    }

    // Resize crop box independently on width vs height via SE corner handle (pointer).
    const resizeOk = await page.evaluate(() => {
      const point = document.querySelector('.cropper-point.point-se') as HTMLElement | null
      const img = document.querySelector('[data-testid="image-crop-source"]') as HTMLImageElement & {
        cropper?: { getData?: (rounded?: boolean) => { width: number; height: number } }
      }
      if (!point || !img?.cropper?.getData) return { ok: false, reason: 'missing-handle' }
      const before = img.cropper.getData(true)
      const r = point.getBoundingClientRect()
      const x0 = r.left + r.width / 2
      const y0 = r.top + r.height / 2
      const fire = (type: string, x: number, y: number, buttons: number) => {
        point.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
            buttons,
          }),
        )
      }
      fire('pointerdown', x0, y0, 1)
      fire('pointermove', x0 + 36, y0 + 12, 1)
      fire('pointerup', x0 + 36, y0 + 12, 0)
      const after = img.cropper.getData(true)
      const changed = Math.abs(after.width - before.width) > 2 || Math.abs(after.height - before.height) > 2
      const ratioBefore = before.width / Math.max(1, before.height)
      const ratioAfter = after.width / Math.max(1, after.height)
      // Free crop: aspect may change when dragging a corner unevenly.
      return {
        ok: changed,
        ratioDelta: Math.abs(ratioAfter - ratioBefore),
        beforeW: before.width,
        beforeH: before.height,
        afterW: after.width,
        afterH: after.height,
      }
    })
    expect(resizeOk.ok).toBe(true)

    // Approximate pinch via synthetic TouchEvent (not a full OS multi-touch path).
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="image-crop-stage"]')
      if (!el) return
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const opts = { bubbles: true, cancelable: true, composed: true }
      el.dispatchEvent(
        new TouchEvent('touchstart', {
          ...opts,
          touches: [
            new Touch({ identifier: 1, target: el, clientX: cx - 30, clientY: cy }),
            new Touch({ identifier: 2, target: el, clientX: cx + 30, clientY: cy }),
          ] as unknown as Touch[],
        } as TouchEventInit),
      )
      el.dispatchEvent(
        new TouchEvent('touchmove', {
          ...opts,
          touches: [
            new Touch({ identifier: 1, target: el, clientX: cx - 55, clientY: cy }),
            new Touch({ identifier: 2, target: el, clientX: cx + 55, clientY: cy }),
          ] as unknown as Touch[],
        } as TouchEventInit),
      )
      el.dispatchEvent(new TouchEvent('touchend', { ...opts, touches: [] } as TouchEventInit))
    }).catch(() => undefined)

    // Controls must not cover the crop stage on mobile
    const overlap = await page.evaluate(() => {
      const stageEl = document.querySelector('[data-testid="image-crop-stage"]') as HTMLElement | null
      const confirm = document.querySelector('[data-testid="image-crop-confirm"]') as HTMLElement | null
      if (!stageEl || !confirm) return true
      const a = stageEl.getBoundingClientRect()
      const b = confirm.getBoundingClientRect()
      return !(b.bottom <= a.top || b.top >= a.bottom || b.right <= a.left || b.left >= a.right)
    })
    expect(overlap).toBe(false)

    await page.screenshot({ path: path.join(shotDir, 'mobile-crop-editor.png'), fullPage: false })
    await page.getByTestId('image-crop-confirm').click()
    const res = await uploadPromise
    expect(res.ok()).toBeTruthy()
    await expect(editor).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByText('Свой фон загружен')).toBeVisible({ timeout: 15_000 })
  })

  test('desktop crop editor opens from master profile MediaDropzone', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1280', 'desktop viewport sample')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/master')
    const dropzone = page.locator('.dropzone').first()
    await expect(dropzone).toBeVisible({ timeout: 20_000 })
    const input = dropzone.locator('input[type="file"]')
    await input.setInputFiles(path.join(fixtureDir, 'portrait.png'))
    const editor = page.getByTestId('image-crop-editor')
    await expect(editor).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('image-crop-zoom')).toBeVisible()
    await page.getByTestId('image-crop-zoom').fill('2.2')
    await expect(page.getByTestId('image-crop-zoom')).toHaveValue('2.2')
    await page.screenshot({ path: path.join(shotDir, 'desktop-crop-editor.png'), fullPage: false })
    await page.getByTestId('image-crop-cancel').click()
    await expect(editor).toHaveCount(0)
  })
})
