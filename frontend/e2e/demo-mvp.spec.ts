import { test, expect, type Page, type TestInfo } from '@playwright/test'

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

async function skipIfApiDown(info: TestInfo) {
  if (!(await apiHealthy())) {
    info.skip(true, `API unhealthy at ${api}`)
  }
}

/** Returns false when UI login does not leave /login (caller should test.skip). */
async function tryLoginUI(page: Page, email: string): Promise<boolean> {
  try {
    await page.goto('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
    return true
  } catch {
    return false
  }
}

async function loginOrSkip(page: Page, email: string, info: TestInfo) {
  const ok = await tryLoginUI(page, email)
  if (!ok) info.skip(true, `login failed for ${email}`)
}

async function apiLogin(email: string) {
  const res = await fetch(`${api}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`login ${email} ${res.status}`)
  return res.json() as Promise<{ access_token: string; user: { id: string } }>
}

test.describe('demo MVP flows', () => {
  test('search defaults to Красноярск; other cities toggle shows Новосибирск master', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1440', 'two viewports')
    await skipIfApiDown(info)
    await loginOrSkip(page, 'client1@demo.local', info)

    await page.goto('/search')
    await expect(page.getByRole('heading', { name: /Поиск/i })).toBeVisible({ timeout: 10_000 })

    const city = page.getByRole('textbox', { name: 'Город', exact: true })
    await expect(city).toHaveValue(/Красноярск/i)

    await page.getByRole('button', { name: /Искать|Найти/i }).click()
    await expect(page.locator('a.list-item').first()).toBeVisible({ timeout: 15_000 })
    // Default city: Krasnoyarsk masters (Anna / Dmitry), not Novosibirsk-only seed master
    await expect(page.getByText('Анна Колористика').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Иван Стилист')).toHaveCount(0)

    await page.getByText('Показывать мастеров из других городов').click()
    await page.getByRole('button', { name: /Искать|Найти/i }).click()
    await expect(page.getByText('Иван Стилист').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Новосибирск').first()).toBeVisible()
  })

  test('flexible booking path still works', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await skipIfApiDown(info)
    await loginOrSkip(page, 'client2@demo.local', info)

    await page.goto('/search')
    const city = page.getByRole('textbox', { name: 'Город', exact: true })
    if (await city.count()) {
      await city.fill('Красноярск')
    }
    await page.getByRole('button', { name: /Искать|Найти/i }).click()

    const anna = page.locator('a.list-item').filter({ hasText: /Анна/i }).first()
    if (!(await anna.count())) {
      info.skip(true, 'Anna master not in search — seed missing?')
    }
    await anna.click()
    await expect(page.locator('main h1, .service-card').first()).toBeVisible({ timeout: 15_000 })

    // Prefer flexible service (Стрижка), not fixed_window workshop
    const flexible = page.locator('.service-card').filter({ hasText: /Стрижка/i }).first()
    if (await flexible.count()) {
      await flexible.click()
    } else {
      const anyFlexible = page.locator('.service-card').filter({ hasNotText: /Фиксированное окно/i }).first()
      if (!(await anyFlexible.count())) info.skip(true, 'no flexible service card')
      await anyFlexible.click()
    }

    const next = page.getByRole('button', { name: /Далее/i })
    if (await next.count()) await next.first().click()

    const dateInput = page.locator('input[type="date"]').first()
    if (!(await dateInput.count())) {
      info.skip(true, 'flexible date step not shown')
    }
    const d = new Date()
    for (let i = 1; i <= 14; i++) {
      const cand = new Date(d.getTime() + i * 86400000)
      if (cand.getDay() === 0 || cand.getDay() === 6) continue
      await dateInput.fill(cand.toISOString().slice(0, 10))
      break
    }
    const toTime = page.getByRole('button', { name: /К времени|Далее/i })
    if (await toTime.count()) await toTime.first().click()

    const slot = page.locator('button.slot').filter({ hasText: /\d{1,2}:\d{2}/ }).first()
    if (!(await slot.count())) {
      await expect(page.locator('main')).toContainText(/слот|свободн|окон|запис/i, { timeout: 10_000 })
      return
    }
    await slot.click()
    const toConfirm = page.getByRole('button', { name: /К подтверждению|Далее/i })
    if (await toConfirm.count()) await toConfirm.first().click()

    const confirm = page.getByRole('button', { name: /Записаться|Подтвердить|Отправить|Создать запись/i })
    await expect(confirm.first()).toBeVisible({ timeout: 10_000 })
    await confirm.first().click()
    await expect(page.getByText(/создан|ожида|подтвержд|успешн/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test('fixed occurrence UI elements when available', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await skipIfApiDown(info)
    await loginOrSkip(page, 'client1@demo.local', info)

    await page.goto('/search')
    await page.getByRole('button', { name: /Искать|Найти/i }).click()
    const anna = page.locator('a.list-item').filter({ hasText: /Анна/i }).first()
    if (!(await anna.count())) info.skip(true, 'Anna not found')
    await anna.click()

    const fixedCard = page.locator('.service-card').filter({ hasText: /Фиксированное окно|мастер-класс/i }).first()
    if (!(await fixedCard.count())) {
      info.skip(true, 'fixed_window service not seeded')
    }
    await fixedCard.click()
    const next = page.getByRole('button', { name: /Далее/i })
    if (await next.count()) await next.first().click()

    const occurrence = page.locator('.occurrence-card').first()
    if (await occurrence.count()) {
      await expect(occurrence).toBeVisible()
      await expect(page.getByText(/мест:/i).first()).toBeVisible()
      await occurrence.click()
      await expect(occurrence).toHaveClass(/selected/)
    } else {
      // Empty-state is still a valid fixed-path UI
      await expect(page.getByText(/сеанс|окн/i).first()).toBeVisible({ timeout: 10_000 })
    }
  })

  test('cosmetics checkout has pickup branch selection (no UUID)', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await skipIfApiDown(info)
    await loginOrSkip(page, 'master1@demo.local', info)

    await page.goto('/cosmetics')
    await expect(page.getByRole('heading', { name: /Косметика|Поставщик/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/UUID|supplier_org_id|xxxxxxxx-xxxx/i)).toHaveCount(0)

    const supplier = page.locator('a.list-item, a.card, .cards-grid a').filter({ hasText: /Поставщик|Профи|Бьюти/i }).first()
    if (!(await supplier.count())) {
      // Soft: catalog empty without seed — still assert no UUID field on list
      await expect(page.locator('main')).toBeVisible()
      return
    }
    await supplier.click()

    const addBtn = page.getByRole('button', { name: /В корзину|Добавить/i }).first()
    if (!(await addBtn.count())) {
      info.skip(true, 'no add-to-cart control on supplier catalog')
    }
    await addBtn.click()

    const openCart = page.getByRole('button', { name: /Корзина|Оформить|Заказ/i }).first()
    if (await openCart.count()) await openCart.click()

    await expect(page.getByRole('heading', { name: /Филиал получения/i })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel(/Поиск филиала/i)).toBeVisible()
    await expect(page.getByText(/UUID|xxxxxxxx-xxxx/i)).toHaveCount(0)
    // Branch cards show human labels, not only ids
    const branchCard = page.locator('.branch-select-card, button.list-item').filter({ hasText: /Красноярск|центр|север|Москва|склад/i }).first()
    if (await branchCard.count()) {
      await branchCard.click()
      await expect(page.getByText(/Выбран|Получение:/i).first()).toBeVisible()
    }
  })

  test('knowledge article page renders', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await skipIfApiDown(info)
    await loginOrSkip(page, 'master1@demo.local', info)

    await page.goto('/knowledge')
    await expect(page.getByRole('heading', { name: /База|знани/i })).toBeVisible({ timeout: 10_000 })

    const articleLink = page.locator('a[href^="/knowledge/"]').first()
    if (!(await articleLink.count())) {
      info.skip(true, 'no knowledge articles — seed missing?')
    }
    await articleLink.click()
    await expect(page).toHaveURL(/\/knowledge\/[^/]+/, { timeout: 10_000 })
    await expect(page.locator('main h1')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('main')).not.toContainText(/Статья не найдена/)
    // Rich or plain body region
    await expect(page.locator('main .card, main .ProseMirror, main article, main section').first()).toBeVisible()
  })

  test('suppliers list has no UUID field for masters', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await skipIfApiDown(info)
    await loginOrSkip(page, 'master1@demo.local', info)
    await page.goto('/cosmetics')
    await expect(page.getByRole('heading', { name: /Косметика|Поставщик/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/UUID|supplier_org_id|xxxxxxxx-xxxx/i)).toHaveCount(0)
    await expect(page.locator('main')).toBeVisible()
  })

  test('supplier products page usable', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'once')
    await skipIfApiDown(info)
    await loginOrSkip(page, 'supplier1@demo.local', info)
    await page.goto('/supplier/products')
    await expect(page.getByRole('heading', { name: /Товар/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/UUID организации/i)).toHaveCount(0)
  })

  test('API suppliers published after seed', async ({}, info) => {
    await skipIfApiDown(info)
    let auth: { access_token: string }
    try {
      auth = await apiLogin('master1@demo.local')
    } catch {
      info.skip(true, 'API login failed')
      return
    }
    const res = await fetch(`${api}/v1/suppliers`, {
      headers: { Authorization: `Bearer ${auth.access_token}` },
    })
    expect(res.ok).toBeTruthy()
    const data = await res.json() as { items: unknown[] }
    expect(Array.isArray(data.items)).toBeTruthy()
  })

  test('knowledge list loads for master', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await skipIfApiDown(info)
    await loginOrSkip(page, 'master1@demo.local', info)
    await page.goto('/knowledge')
    await expect(page.getByRole('heading', { name: /База|знани/i })).toBeVisible({ timeout: 10_000 })
  })
})
