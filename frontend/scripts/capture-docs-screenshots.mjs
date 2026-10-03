/**
 * Capture live UI into docs/screenshots/. Requires Vite :5173 and API :8090 + seed.
 * Usage (from frontend/): node scripts/capture-docs-screenshots.mjs
 *
 * These are Playwright browser captures, not physical-device photos.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const base = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173'
const password = process.env.SEED_PASSWORD ?? 'Password123!'
const outDir = resolve('..', 'docs/screenshots')
mkdirSync(outDir, { recursive: true })

async function newSession(browser, viewport) {
  const ctx = await browser.newContext({
    viewport,
    colorScheme: 'dark',
  })
  await ctx.addInitScript(() => {
    localStorage.setItem('zb.theme', 'dark')
  })
  return ctx
}

async function login(page, email) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').waitFor({ timeout: 20_000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
}

async function shot(page, name) {
  await page.waitForTimeout(700)
  await page.screenshot({ path: resolve(outDir, `${name}.png`), fullPage: false })
  console.log('wrote', name)
}

const browser = await chromium.launch()

try {
  const ownerDesk = await newSession(browser, { width: 1440, height: 900 })
  const ownerD = await ownerDesk.newPage()
  await login(ownerD, 'master1@demo.local')

  await ownerD.goto(`${base}/`)
  await ownerD.getByTestId('owner-start-page').waitFor({ timeout: 20_000 })
  await shot(ownerD, 'owner-start-desktop')

  await ownerD.goto(`${base}/calendar`)
  await ownerD.getByRole('heading', { name: /календарь/i }).first().waitFor({ timeout: 15_000 })
  await ownerD.getByRole('button', { name: 'Неделя' }).click()
  await ownerD.waitForTimeout(500)
  await shot(ownerD, 'calendar-desktop')

  await ownerD.goto(`${base}/appointments`)
  await ownerD.getByRole('heading', { name: /Записи/ }).waitFor({ timeout: 15_000 })
  const firstAppt = ownerD.locator('a[href^="/appointments/"]').first()
  await firstAppt.waitFor({ timeout: 15_000 })
  await firstAppt.click()
  await ownerD.getByRole('heading', { name: 'Запись' }).waitFor({ timeout: 15_000 })
  await shot(ownerD, 'appointment-detail')

  await ownerD.goto(`${base}/contacts`)
  await ownerD.getByTestId('contacts-list').waitFor({ timeout: 15_000 })
  await shot(ownerD, 'contacts')

  await ownerD.goto(`${base}/messages`)
  await ownerD.getByRole('heading', { name: /Сообщения/ }).waitFor({ timeout: 15_000 })
  await shot(ownerD, 'messenger')

  await ownerD.goto(`${base}/staff`)
  await ownerD.getByRole('button', { name: 'Создать QR' }).click()
  const qr = ownerD.getByAltText('QR для регистрации мастера')
  await qr.waitFor({ timeout: 15_000 })
  await qr.scrollIntoViewIfNeeded()
  await ownerD.waitForTimeout(800)
  await shot(ownerD, 'qr-invite')

  await ownerD.goto(`${base}/portfolio`)
  await ownerD.locator('.media-frame, .portfolio-grid, img').first().waitFor({ timeout: 15_000 }).catch(() => {})
  await ownerD.waitForTimeout(800)
  await shot(ownerD, 'portfolio')

  await ownerD.goto(`${base}/master`)
  await ownerD.getByRole('heading', { name: /Профиль мастера/i }).first().waitFor({ timeout: 15_000 })
  await shot(ownerD, 'master-settings')

  const ownerPhone = await newSession(browser, { width: 390, height: 844 })
  const ownerP = await ownerPhone.newPage()
  await login(ownerP, 'master1@demo.local')
  await ownerP.goto(`${base}/`)
  await ownerP.getByTestId('owner-start-page').waitFor({ timeout: 20_000 })
  await shot(ownerP, 'owner-start-mobile')

  await ownerP.goto(`${base}/calendar`)
  await ownerP.getByTestId('calendar-mobile').waitFor({ timeout: 20_000 })
  const listBtn = ownerP.getByRole('button', { name: 'Список' })
  if (await listBtn.count()) await listBtn.click()
  await ownerP.waitForTimeout(400)
  await shot(ownerP, 'calendar-mobile')

  const clientCtx = await newSession(browser, { width: 1440, height: 900 })
  const clientD = await clientCtx.newPage()
  await login(clientD, 'client1@demo.local')
  await clientD.goto(`${base}/search`)
  await clientD.getByRole('button', { name: /Искать|Найти/i }).click()
  const anna = clientD.locator('a.list-item').filter({ hasText: /Анна/i }).first()
  await anna.waitFor({ timeout: 15_000 })
  await anna.click()
  await clientD.locator('#mp-booking').waitFor({ timeout: 15_000 })
  await shot(clientD, 'master-profile')
  await clientD.getByTestId('mp-service').filter({ hasText: /Стрижка/i }).first().click()
  await clientD.getByTestId('mp-date').first().waitFor({ timeout: 10_000 })
  await shot(clientD, 'client-booking')

  const supCtx = await newSession(browser, { width: 1440, height: 900 })
  const sup = await supCtx.newPage()
  await login(sup, 'supplier1@demo.local')
  await sup.goto(`${base}/knowledge`)
  await sup.getByRole('heading', { name: /База|знани/i }).waitFor({ timeout: 15_000 })
  await shot(sup, 'supplier-knowledge')
  await sup.goto(`${base}/supplier/products`)
  await sup.getByRole('heading', { name: /Товар/i }).waitFor({ timeout: 15_000 })
  await shot(sup, 'supplier-catalog')
} finally {
  await browser.close()
}

console.log('done', outDir)
