import { chromium, devices } from 'playwright'
import fs from 'fs'
import path from 'path'

const out = path.resolve('../docs/qa-finalize-glass')
fs.mkdirSync(out, { recursive: true })

const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173'
const api = process.env.VITE_API_BASE_URL || 'http://127.0.0.1:8090'
const email = process.env.SEED_EMAIL || 'master1@demo.local'
const password = process.env.SEED_PASSWORD || 'Password123!'

function styleSnapshot(sel) {
  const el = document.querySelector(sel)
  if (!el) return null
  const s = getComputedStyle(el)
  return {
    bg: s.backgroundColor,
    backdrop: s.backdropFilter || s.webkitBackdropFilter,
    border: s.borderColor,
    radius: s.borderRadius,
  }
}

async function measure(page) {
  return page.evaluate(() => {
    const before = getComputedStyle(document.body, '::before')
    const root = getComputedStyle(document.documentElement)
    const pick = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const s = getComputedStyle(el)
      return {
        bg: s.backgroundColor,
        backdrop: s.backdropFilter || s.webkitBackdropFilter,
        border: s.borderColor,
        radius: s.borderRadius,
      }
    }
    return {
      theme: document.documentElement.getAttribute('data-theme') || 'dark',
      appBgImage: root.getPropertyValue('--app-bg-image').trim(),
      glassFill: root.getPropertyValue('--glass-fill').trim(),
      glassStrong: root.getPropertyValue('--glass-fill-strong').trim(),
      glassControl: root.getPropertyValue('--glass-control-fill').trim(),
      bodyBefore: {
        content: before.content,
        position: before.position,
        bgImage: before.backgroundImage.slice(0, 120),
      },
      topbar: pick('.topbar'),
      bottomnav: pick('.bottomnav'),
      card: pick('.card'),
      serviceCard: pick('.service-card, .media-first-card, .kb-card, .product-card'),
      apptCard: pick('.appt-card'),
      fieldInput: pick('.field input, .field textarea, .field select'),
      modal: pick('.modal-sheet'),
      more: pick('.more-panel, .more-drawer .drawer-panel, .drawer-panel'),
      messengerShell: pick('.messenger-page .messenger-app--page, .messenger-panel'),
      wallpaperKey: localStorage.getItem('zb.home-bg'),
    }
  })
}

async function shot(page, name) {
  const file = path.join(out, `${name}.png`)
  await page.waitForTimeout(450)
  const info = await measure(page)
  await page.screenshot({ path: file, fullPage: false })
  return { name, url: page.url(), info, file }
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t)
    localStorage.setItem('zb.theme', t)
  }, theme)
}

async function setWallpaper(page, id) {
  await page.evaluate((bgId) => {
    localStorage.setItem('zb.home-bg', bgId)
    localStorage.removeItem('zb.home-bg-media')
    // Force CSS var if app already mounted — reload preferred by caller.
  }, id)
}

async function login(page) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.locator('input[type="email"], input[name="email"]').first().fill(email)
  await page.locator('input[type="password"], input[name="password"]').first().fill(password)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 }).catch(() => null),
    page.locator('button[type="submit"]').first().click(),
  ])
  await page.waitForTimeout(800)
}

async function runTheme(browser, theme, viewport, prefix) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: viewport.width <= 430 ? 2 : 1,
  })
  const page = await context.newPage()
  const results = []

  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await setWallpaper(page, 'mist-canyon')
  await setTheme(page, theme)
  await page.reload({ waitUntil: 'domcontentloaded' })
  results.push(await shot(page, `${prefix}-01-login`))

  await page.goto(`${base}/register`, { waitUntil: 'domcontentloaded' })
  await setTheme(page, theme)
  results.push(await shot(page, `${prefix}-02-register`))

  // Wallpaper persistence across logout: login → confirm bg → logout → login again
  await login(page)
  await setTheme(page, theme)
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  results.push(await shot(page, `${prefix}-03-home`))

  await page.goto(`${base}/settings/appearance`, { waitUntil: 'domcontentloaded' })
  await setTheme(page, theme)
  results.push(await shot(page, `${prefix}-04-settings`))

  await page.goto(`${base}/services`, { waitUntil: 'domcontentloaded' })
  await setTheme(page, theme)
  results.push(await shot(page, `${prefix}-05-services`))

  // Generic Modal via Services «Добавить»
  const addBtn = page.getByRole('button', { name: 'Добавить' }).first()
  if (await addBtn.count()) {
    await addBtn.click()
    await page.waitForSelector('.modal-sheet', { timeout: 8000 }).catch(() => null)
    results.push(await shot(page, `${prefix}-05b-services-modal`))
    // Long form scroll / keyboard-ish focus
    const price = page.locator('.modal-sheet input, .modal-sheet textarea').nth(2)
    if (await price.count()) {
      await price.focus()
      await page.waitForTimeout(300)
      results.push(await shot(page, `${prefix}-05c-modal-field-focus`))
    }
    await page.keyboard.press('Escape').catch(() => null)
    await page.waitForTimeout(300)
  } else {
    results.push({ name: `${prefix}-05b-services-modal`, url: page.url(), info: { error: 'Добавить button missing' }, file: null })
  }

  await page.goto(`${base}/clients`, { waitUntil: 'domcontentloaded' })
  await setTheme(page, theme)
  results.push(await shot(page, `${prefix}-06-clients`))

  await page.goto(`${base}/profile`, { waitUntil: 'domcontentloaded' })
  await setTheme(page, theme)
  results.push(await shot(page, `${prefix}-07-profile-form`))

  // MoreDrawer: mobile bottomnav «Ещё» or compact topbar «Меню». Desktop uses sidenav (no drawer).
  await page.goto(`${base}/appointments`, { waitUntil: 'domcontentloaded' })
  await setTheme(page, theme)
  await page.keyboard.press('Escape').catch(() => null)
  const moreTriggers = [
    page.locator('.bottomnav button.nav-tab').filter({ hasText: 'Ещё' }),
    page.getByRole('button', { name: 'Открыть меню' }),
    page.getByRole('button', { name: 'Меню' }),
  ]
  let openedMore = false
  for (const trigger of moreTriggers) {
    if (!(await trigger.count())) continue
    const visible = await trigger.first().isVisible().catch(() => false)
    if (!visible && viewport.width > 900) continue
    try {
      await trigger.first().click({ force: true, timeout: 5000 })
      await page.waitForSelector('.more-panel, .more-drawer .drawer-panel, [role="dialog"].drawer-panel', { timeout: 4000 })
      openedMore = true
      break
    } catch {
      /* try next trigger */
    }
  }
  if (openedMore) {
    results.push(await shot(page, `${prefix}-08-more-drawer`))
    await page.keyboard.press('Escape').catch(() => null)
  } else {
    results.push({
      name: `${prefix}-08-more-drawer`,
      url: page.url(),
      info: { skipped: viewport.width > 900 ? 'desktop sidenav — MoreDrawer not mounted' : 'more trigger not openable' },
      file: null,
    })
  }

  await page.goto(`${base}/messages`, { waitUntil: 'domcontentloaded' })
  await setTheme(page, theme)
  results.push(await shot(page, `${prefix}-10-messages`))

  // Logout wallpaper persistence
  await page.goto(`${base}/profile`, { waitUntil: 'domcontentloaded' })
  const logoutBtn = page.getByRole('button', { name: /Выйти/i }).first()
  let wallpaperAfterLogout = null
  if (await logoutBtn.count()) {
    await logoutBtn.click()
    await page.waitForURL(/login/, { timeout: 15000 }).catch(() => null)
    await page.waitForTimeout(400)
    wallpaperAfterLogout = await page.evaluate(() => ({
      key: localStorage.getItem('zb.home-bg'),
      appBg: getComputedStyle(document.documentElement).getPropertyValue('--app-bg-image').trim(),
      beforeBg: getComputedStyle(document.body, '::before').backgroundImage.slice(0, 160),
    }))
    results.push(await shot(page, `${prefix}-12-login-after-logout`))
  }

  await context.close()
  return { results, wallpaperAfterLogout }
}

const browser = await chromium.launch()
const report = { apiOk: false, mobile: {}, desktop: {} }

try {
  const ping = await fetch(`${api}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  report.apiOk = ping.ok
} catch (e) {
  report.apiOk = false
  report.apiError = String(e)
}

for (const theme of ['dark', 'light']) {
  report.mobile[theme] = await runTheme(browser, theme, { width: 390, height: 844 }, `${theme}-m`)
  report.desktop[theme] = await runTheme(browser, theme, { width: 1280, height: 800 }, `${theme}-d`)
}

// Desktop services + modal extras for both themes (already in runTheme for services)
await browser.close()

fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  out,
  apiOk: report.apiOk,
  darkMobileWallpaper: report.mobile.dark?.wallpaperAfterLogout,
  lightMobileWallpaper: report.mobile.light?.wallpaperAfterLogout,
  shots: [
    ...report.mobile.dark.results,
    ...report.mobile.light.results,
    ...report.desktop.dark.results,
    ...report.desktop.light.results,
  ].map((r) => ({ name: r.name, file: r.file, glassFill: r.info?.glassFill, modal: r.info?.modal, card: r.info?.card })),
}, null, 2))
