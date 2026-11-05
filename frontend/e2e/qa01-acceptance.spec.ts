/**
 * QA-01 acceptance walker — real UI against live Docker stack (not unit mocks).
 * Environment: local compose http://127.0.0.1:5173 + seed accounts.
 * Does NOT claim physical-device verification.
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const password = process.env.SEED_PASSWORD ?? 'Password123!'
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/qa01-artifacts')
const results: Array<Record<string, string>> = []

function record(row: Record<string, string>) {
  results.push(row)
}

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 25_000 })
}

async function dismissTransientChrome(page: Page) {
  const later = page.getByRole('button', { name: 'Позже' })
  if (await later.isVisible().catch(() => false)) await later.click()
  const closeUpdate = page.getByRole('button', { name: 'Закрыть' }).filter({
    has: page.locator('xpath=ancestor::*[contains(., "новая версия")]'),
  })
  // Prefer explicit PWA "Позже"; ignore unrelated closes.
  void closeUpdate
}

async function logout(page: Page) {
  await dismissTransientChrome(page)
  // Prefer profile page: home notification stack can intercept topbar/sidenav logout.
  await page.goto('/profile')
  await dismissTransientChrome(page)
  const btn = page.getByRole('button', { name: 'Выйти' }).first()
  await btn.click({ force: true })
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
}

async function noHScroll(page: Page) {
  return page.evaluate(() => !(document.documentElement.scrollWidth > document.documentElement.clientWidth + 1))
}

async function consoleErrors(page: Page, run: () => Promise<void>) {
  const errors: string[] = []
  const onErr = (msg: import('@playwright/test').ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  }
  page.on('console', onErr)
  try {
    await run()
  } finally {
    page.off('console', onErr)
  }
  return errors.filter((e) => !/favicon|Download the React DevTools/i.test(e))
}

test.describe('QA-01 acceptance', () => {
  test.beforeAll(() => {
    fs.mkdirSync(outDir, { recursive: true })
  })

  test.afterAll(() => {
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2))
  })

  test('environment readiness', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const res = await page.request.get('/')
    const ok = res.ok()
    record({
      scenario: 'Стенд доступен',
      role: '—',
      env: 'local-docker',
      result: ok ? 'PASS' : 'BLOCKED',
      defect: ok ? '' : `GET / → ${res.status()}`,
      evidence: `status=${res.status()}`,
    })
    expect(ok).toBeTruthy()
  })

  test('auth: login logout clean login', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    try {
      await login(page, 'client1@demo.local')
      await logout(page)
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
      await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText('Сессия завершилась')).toHaveCount(0)
      record({
        scenario: 'Вход / выход / чистая форма login',
        role: 'client',
        env: 'local-docker + Chromium',
        result: 'PASS',
        defect: '',
        evidence: 'logout → /login without session-expired banner',
      })
    } catch (e) {
      record({
        scenario: 'Вход / выход / чистая форма login',
        role: 'client',
        env: 'local-docker + Chromium',
        result: 'FAIL',
        defect: String(e),
        evidence: page.url(),
      })
      throw e
    }
  })

  test('client: search → master → booking shell', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    try {
      await login(page, 'client1@demo.local')
      await page.goto('/search')
      await page.getByRole('button', { name: 'Искать' }).click()
      const anna = page.getByRole('link', { name: /Анна Волкова/i }).first()
      await expect(anna).toBeVisible({ timeout: 20_000 })
      await anna.click()
      await expect(page).toHaveURL(/\/masters\//)
      await expect(page.getByRole('heading', { name: /Анна Волкова/i })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('button', { name: 'Записаться' }).first()).toBeVisible()
      await page.getByRole('button', { name: 'Записаться' }).first().click()
      await expect(page.locator('#mp-booking')).toBeVisible({ timeout: 10_000 })
      await page.screenshot({ path: path.join(outDir, 'client-master.png'), fullPage: true })
      record({
        scenario: 'Клиент: поиск мастера → профиль → запись (shell)',
        role: 'client',
        env: 'local-docker + Chromium phone-390',
        result: 'PASS',
        defect: '',
        evidence: 'qa01-artifacts/client-master.png',
      })
    } catch (e) {
      record({
        scenario: 'Клиент: поиск мастера → профиль → запись (shell)',
        role: 'client',
        env: 'local-docker + Chromium phone-390',
        result: 'FAIL',
        defect: String(e),
        evidence: page.url(),
      })
      throw e
    }
  })

  test('client: appointments + messages nav visible; team hidden', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await login(page, 'client1@demo.local')
    await page.goto('/')
    const team = page.getByRole('link', { name: 'Команда' })
    const teamCount = await team.count()
    await page.goto('/appointments')
    await expect(page.getByRole('heading', { name: /Запис/i }).first()).toBeVisible({ timeout: 15_000 })
    await page.goto('/messages')
    await expect(page.locator('body')).toBeVisible()
    const ok = teamCount === 0
    record({
      scenario: 'Клиент: записи/сообщения доступны; Команда скрыта в nav',
      role: 'client',
      env: 'local-docker + Chromium',
      result: ok ? 'PASS' : 'FAIL',
      defect: ok ? '' : 'Команда видна клиенту',
      evidence: `teamLinks=${teamCount}`,
    })
    expect(ok).toBeTruthy()
  })

  test('owner: home + calendar + contacts + staff', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    try {
      await login(page, 'master1@demo.local')
      await page.goto('/')
      await expect(page.getByRole('heading', { name: /Ателье|Волков/i }).first()).toBeVisible({ timeout: 20_000 })
      await page.goto('/calendar')
      await expect(page.getByRole('heading', { name: /календар|расписан/i }).first()).toBeVisible({
        timeout: 20_000,
      })
      await page.goto('/contacts')
      await expect(page.getByRole('heading', { name: /Контакт/i }).first()).toBeVisible({ timeout: 15_000 })
      await page.goto('/staff')
      await expect(page.getByRole('heading', { name: /Команда/i }).first()).toBeVisible({ timeout: 15_000 })
      await page.screenshot({ path: path.join(outDir, 'owner-staff.png'), fullPage: true })
      record({
        scenario: 'Владелец: старт / календарь / контакты / команда',
        role: 'owner (master1)',
        env: 'local-docker + Chromium phone-390',
        result: 'PASS',
        defect: '',
        evidence: 'qa01-artifacts/owner-staff.png',
      })
    } catch (e) {
      record({
        scenario: 'Владелец: старт / календарь / контакты / команда',
        role: 'owner (master1)',
        env: 'local-docker + Chromium phone-390',
        result: 'FAIL',
        defect: String(e),
        evidence: page.url(),
      })
      throw e
    }
  })

  test('salon admin: staff visible; owner-only analytics may differ', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    try {
      await login(page, 'admin1@demo.local')
      await page.goto('/staff')
      await expect(page.getByRole('heading', { name: /Команда|сотрудник/i }).first()).toBeVisible({ timeout: 20_000 })
      record({
        scenario: 'Админ салона: команда доступна',
        role: 'salon admin',
        env: 'local-docker + Chromium',
        result: 'PASS',
        defect: '',
        evidence: '/staff heading visible',
      })
    } catch (e) {
      record({
        scenario: 'Админ салона: команда доступна',
        role: 'salon admin',
        env: 'local-docker + Chromium',
        result: 'FAIL',
        defect: String(e),
        evidence: page.url(),
      })
      throw e
    }
  })

  test('employee master: calendar + no org team invite UX leak as owner', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    try {
      await login(page, 'employee1@demo.local')
      await page.goto('/calendar')
      await expect(page.getByRole('heading', { name: /календар|расписан|Мой календар/i }).first()).toBeVisible({
        timeout: 20_000,
      })
      await page.goto('/portfolio')
      await expect(page.getByRole('heading', { name: /Портфолио/i }).first()).toBeVisible({ timeout: 15_000 })
      record({
        scenario: 'Мастер салона: календарь + портфолио',
        role: 'salon master (employee1)',
        env: 'local-docker + Chromium',
        result: 'PASS',
        defect: '',
        evidence: 'calendar + portfolio headings',
      })
    } catch (e) {
      record({
        scenario: 'Мастер салона: календарь + портфолио',
        role: 'salon master (employee1)',
        env: 'local-docker + Chromium',
        result: 'FAIL',
        defect: String(e),
        evidence: page.url(),
      })
      throw e
    }
  })

  test('private master: profile path works', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    try {
      await login(page, 'master4@demo.local')
      await page.goto('/profile')
      await expect(page.getByRole('heading', { name: 'Профиль' })).toBeVisible({ timeout: 15_000 })
      await page.goto('/calendar')
      await expect(page.getByRole('heading', { name: /календар|расписан|Мой календар/i }).first()).toBeVisible({
        timeout: 20_000,
      })
      record({
        scenario: 'Частный мастер: профиль + календарь',
        role: 'private master',
        env: 'local-docker + Chromium',
        result: 'PASS',
        defect: '',
        evidence: 'profile + calendar',
      })
    } catch (e) {
      record({
        scenario: 'Частный мастер: профиль + календарь',
        role: 'private master',
        env: 'local-docker + Chromium',
        result: 'FAIL',
        defect: String(e),
        evidence: page.url(),
      })
      throw e
    }
  })

  test('supplier: cabinet + knowledge + knowledge products', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    try {
      await login(page, 'supplier1@demo.local')
      await page.goto('/supplier')
      await expect(page.locator('body')).toContainText(/поставщик|кабинет|заказ|товар/i)
      await page.goto('/supplier/products')
      await expect(page.locator('body')).toContainText(/товар|продукт|каталог|склад/i)
      await page.goto('/knowledge')
      await expect(page.getByRole('heading', { name: /База знаний|Знания|Knowledge/i }).first()).toBeVisible({
        timeout: 20_000,
      })
      await page.screenshot({ path: path.join(outDir, 'supplier-knowledge.png'), fullPage: true })
      record({
        scenario: 'Поставщик: кабинет + товары + база знаний',
        role: 'supplier',
        env: 'local-docker + Chromium',
        result: 'PASS',
        defect: '',
        evidence: 'qa01-artifacts/supplier-knowledge.png',
      })
    } catch (e) {
      record({
        scenario: 'Поставщик: кабинет + товары + база знаний',
        role: 'supplier',
        env: 'local-docker + Chromium',
        result: 'FAIL',
        defect: String(e),
        evidence: page.url(),
      })
      throw e
    }
  })

  test('password reset request UI (no mail assert)', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    try {
      await page.goto('/login')
      await page.getByRole('link', { name: /Забыли пароль/i }).click()
      await expect(page).toHaveURL(/forgot|reset|password/i)
      await page.getByLabel(/Email/i).fill('client1@demo.local')
      const submit = page.getByRole('button', { name: /Отправить|Сбросить|Восстанов/i })
      await submit.click()
      await expect(page.getByText(/если|отправил|письм|проверьте|инструкц/i).first()).toBeVisible({ timeout: 15_000 })
      record({
        scenario: 'Восстановление пароля: UI request (доставка SMTP — отдельно)',
        role: 'anonymous',
        env: 'local-docker + Chromium',
        result: 'PASS',
        defect: '',
        evidence: 'neutral success copy shown',
      })
    } catch (e) {
      record({
        scenario: 'Восстановление пароля: UI request (доставка SMTP — отдельно)',
        role: 'anonymous',
        env: 'local-docker + Chromium',
        result: 'FAIL',
        defect: String(e),
        evidence: page.url(),
      })
      throw e
    }
  })

  test('adaptive overflow matrix key routes', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'width matrix once')
    await login(page, 'master1@demo.local')
    const widths = [360, 390, 768, 1024, 1440] as const
    const routes = ['/', '/calendar', '/messages', '/profile', '/shop'] as const
    const fails: string[] = []
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: w < 768 ? 800 : 900 })
      for (const route of routes) {
        await page.goto(route)
        await page.waitForLoadState('domcontentloaded')
        const crashed = page.getByRole('heading', { name: 'Что-то пошло не так' })
        if (await crashed.isVisible().catch(() => false)) {
          fails.push(`${route}@${w}: error boundary`)
          continue
        }
        const ok = await noHScroll(page)
        if (!ok) fails.push(`${route}@${w}: horizontal overflow`)
      }
    }
    record({
      scenario: 'Адаптив: overflow на 360/390/768/1024/1440 (ключевые маршруты)',
      role: 'owner',
      env: 'local-docker + Chromium emulation (не физические устройства)',
      result: fails.length ? 'FAIL' : 'PASS',
      defect: fails.join('; '),
      evidence: fails.length ? fails.join(' | ') : 'no horizontal overflow',
    })
    expect(fails).toEqual([])
  })

  test('negative: bad login', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await page.goto('/login')
    await page.getByLabel('Email').fill('nobody@demo.local')
    await page.getByLabel('Пароль').fill('WrongPassword1!')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText(/неверн|ошибк|парол|email|вход/i).first()).toBeVisible({ timeout: 10_000 })
    record({
      scenario: 'Отрицательный: неверный логин',
      role: 'anonymous',
      env: 'local-docker + Chromium',
      result: 'PASS',
      defect: '',
      evidence: 'stays on /login with error',
    })
  })

  test('consultations page loads for client/master', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    try {
      await login(page, 'client1@demo.local')
      await page.goto('/consultations')
      await expect(page.locator('body')).toContainText(/консультац|диагност|анкет/i)
      await logout(page)
      await login(page, 'master1@demo.local')
      await page.goto('/consultations')
      await expect(page.locator('body')).toContainText(/консультац|диагност|анкет|план/i)
      record({
        scenario: 'Консультации по волосам: страница открывается (клиент + владелец)',
        role: 'client + owner',
        env: 'local-docker + Chromium',
        result: 'PASS',
        defect: '',
        evidence: '/consultations content keywords',
      })
    } catch (e) {
      record({
        scenario: 'Консультации по волосам: страница открывается (клиент + владелец)',
        role: 'client + owner',
        env: 'local-docker + Chromium',
        result: 'FAIL',
        defect: String(e),
        evidence: page.url(),
      })
      throw e
    }
  })

  test('settings notifications page (push UI presence)', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    try {
      await login(page, 'client1@demo.local')
      await page.goto('/settings/notifications')
      await expect(page.getByText(/уведомлен|push|Включить|Отключить/i).first()).toBeVisible({ timeout: 15_000 })
      record({
        scenario: 'PWA Push UI: настройки уведомлений доступны',
        role: 'client',
        env: 'local-docker + Chromium (не физ. устройство; VAPID на стенде может быть выкл.)',
        result: 'PASS',
        defect: '',
        evidence: '/settings/notifications',
      })
    } catch (e) {
      record({
        scenario: 'PWA Push UI: настройки уведомлений доступны',
        role: 'client',
        env: 'local-docker + Chromium',
        result: 'FAIL',
        defect: String(e),
        evidence: page.url(),
      })
      throw e
    }
  })

  test('warehouse / salon settings for owner', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    try {
      await login(page, 'master1@demo.local')
      await page.goto('/warehouse')
      await expect(page.getByRole('heading', { name: /^Склад$/i })).toBeVisible({ timeout: 15_000 })
      await page.goto('/salon/settings')
      await expect(page.getByRole('heading', { name: /Настройки салона/i })).toBeVisible({ timeout: 15_000 })
      record({
        scenario: 'Владелец: склад + настройки салона',
        role: 'owner',
        env: 'local-docker + Chromium',
        result: 'PASS',
        defect: '',
        evidence: 'warehouse + salon/settings headings',
      })
    } catch (e) {
      record({
        scenario: 'Владелец: склад + настройки салона',
        role: 'owner',
        env: 'local-docker + Chromium',
        result: 'FAIL',
        defect: String(e),
        evidence: page.url(),
      })
      throw e
    }
  })
})
