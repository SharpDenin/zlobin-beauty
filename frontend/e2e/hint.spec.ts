import { test, expect } from '@playwright/test'

const api = (process.env.VITE_API_BASE_URL?.startsWith('http')
  ? process.env.VITE_API_BASE_URL
  : null) ?? 'http://localhost:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'

const PROJECTS = new Set(['phone-360', 'phone-390', 'tablet-768', 'laptop-1366'])
const EXTRA_WIDTHS = [1024, 1440]

async function loginFresh(page: import('@playwright/test').Page, tag: string) {
  const health = await fetch(`${api}/healthz`)
  expect(health.ok).toBeTruthy()
  const email = `hint-ui05-${tag}-${Date.now()}@demo.local`
  const reg = await fetch(`${api}/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, display_name: 'Hint UI05', as_master: false }),
  })
  expect(reg.ok, await reg.text()).toBeTruthy()
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

async function assertHintFitsViewport(page: import('@playwright/test').Page) {
  const trigger = page.getByTestId('hint-client-booking').getByRole('button', { name: 'Запись' })
  await expect(trigger).toBeVisible({ timeout: 15_000 })
  await trigger.click()
  const pop = page.getByTestId('hint-pop-client-booking')
  await expect(pop).toBeVisible({ timeout: 10_000 })
  await expect(pop).toHaveCSS('position', 'fixed')
  const box = await pop.boundingBox()
  expect(box).toBeTruthy()
  const vp = page.viewportSize()!
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.y).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 1)
  return { trigger, pop }
}

test('UI-05 hint: fixed popover, outside click, Escape, dismiss', async ({ page }, info) => {
  test.skip(!PROJECTS.has(info.project.name), 'responsive matrix')

  await loginFresh(page, info.project.name)
  await page.goto('/search')
  const { trigger, pop } = await assertHintFitsViewport(page)

  await page.locator('h1').click({ position: { x: 8, y: 8 }, force: true })
  await expect(pop).toHaveCount(0)

  await trigger.click()
  await expect(pop).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(pop).toHaveCount(0)

  await trigger.click()
  await expect(pop).toBeVisible()
  await pop.getByRole('button', { name: 'Больше не показывать' }).click()
  await expect(page.getByTestId('hint-client-booking')).toHaveCount(0)
})

test('UI-05 hint fits 1024 and 1440 widths', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-390', 'extra widths once')
  await loginFresh(page, 'extra-widths')
  for (const width of EXTRA_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/search')
    const { pop } = await assertHintFitsViewport(page)
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
  }
})
