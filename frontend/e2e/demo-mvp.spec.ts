import { test, expect, type Page } from '@playwright/test'

/**
 * Demo MVP flows against a seeded stack.
 * API down → skip. API up + missing seed/login → FAIL (no soft-skip of core scenarios).
 */
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

async function requireApi() {
  if (!(await apiHealthy())) {
    test.skip(true, `API unhealthy at ${api} — start docker stack to run these tests`)
  }
}

async function loginUI(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

async function apiLogin(email: string) {
  const res = await fetch(`${api}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(res.ok, `login ${email} → ${res.status}`).toBeTruthy()
  return res.json() as Promise<{ access_token: string; user: { id: string } }>
}

test.describe('demo MVP flows', () => {
  test.beforeEach(async () => {
    await requireApi()
  })

  test('search defaults to Красноярск; other cities toggle shows Новосибирск master', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1920', 'two viewports')
    await loginUI(page, 'client1@demo.local')

    await page.goto('/search')
    await expect(page.getByRole('heading', { name: /Поиск/i })).toBeVisible({ timeout: 10_000 })

    const city = page.getByRole('textbox', { name: 'Город', exact: true })
    await expect(city).toHaveValue(/Красноярск/i)

    await page.getByRole('button', { name: /Искать|Найти/i }).click()
    await expect(page.locator('a.list-item').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Анна Волкова').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Иван Белов')).toHaveCount(0)

    await page.getByText('Показывать мастеров из других городов').click()
    await page.getByRole('button', { name: /Искать|Найти/i }).click()
    await expect(page.getByText('Иван Белов').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Новосибирск').first()).toBeVisible()
  })

  test('flexible booking path still works', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'client1@demo.local')

    await page.goto('/search')
    const city = page.getByRole('textbox', { name: 'Город', exact: true })
    if (await city.count()) {
      await city.fill('Красноярск')
    }
    await page.getByRole('button', { name: /Искать|Найти/i }).click()

    const anna = page.locator('a.list-item').filter({ hasText: /Анна/i }).first()
    await expect(anna).toBeVisible({ timeout: 15_000 })
    await anna.click()
    await page.locator('#mp-booking').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('mp-service').first()).toBeVisible({ timeout: 15_000 })

    const flexible = page.getByTestId('mp-service').filter({ hasText: /Стрижка/i }).first()
    await expect(flexible).toBeVisible({ timeout: 10_000 })
    await flexible.click()

    const next = page.getByRole('button', { name: /Далее/i })
    if (await next.count()) await next.first().click()

    const dateInput = page.locator('input[type="date"]').first()
    await expect(dateInput).toBeVisible({ timeout: 10_000 })
    const d = new Date()
    for (let i = 1; i <= 14; i++) {
      const cand = new Date(d.getTime() + i * 86400000)
      if (cand.getDay() === 0 || cand.getDay() === 6) continue
      await dateInput.fill(cand.toISOString().slice(0, 10))
      break
    }
    const toTime = page.getByRole('button', { name: /К времени|Далее/i })
    if (await toTime.count()) await toTime.first().click()

    const slot = page.locator('button.slot:not(.empty)').first()
    await expect(slot).toBeVisible({ timeout: 15_000 })
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
    await loginUI(page, 'client1@demo.local')

    await page.goto('/search')
    await page.getByRole('button', { name: /Искать|Найти/i }).click()
    const anna = page.locator('a.list-item').filter({ hasText: /Анна/i }).first()
    await expect(anna).toBeVisible({ timeout: 15_000 })
    await anna.click()

    const fixedCard = page.getByTestId('mp-service').filter({ hasText: /Фиксированное окно|мастер-класс|МК/i }).first()
    await expect(fixedCard).toBeVisible({ timeout: 15_000 })
    await fixedCard.click()
    const next = page.getByRole('button', { name: /Далее/i })
    if (await next.count()) await next.first().click()

    const occurrence = page.locator('.occurrence-card').first()
    await expect(occurrence).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/мест:/i).first()).toBeVisible()
    await occurrence.click()
    await expect(occurrence).toHaveClass(/selected/)
  })

  test('cosmetics checkout has pickup branch selection (no UUID)', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')

    await page.goto('/cosmetics')
    await expect(page.getByRole('heading', { name: /Косметика|Поставщик/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/UUID|supplier_org_id|xxxxxxxx-xxxx/i)).toHaveCount(0)

    const supplier = page.locator('a.list-item, a.card, .cards-grid a').filter({ hasText: /Поставщик|Профи|Бьюти/i }).first()
    await expect(supplier).toBeVisible({ timeout: 15_000 })
    await supplier.click()

    const addBtn = page.getByRole('button', { name: /В корзину|Добавить/i }).first()
    await expect(addBtn).toBeVisible({ timeout: 15_000 })
    await addBtn.click()

    const openCart = page.getByRole('button', { name: /Корзина|Оформить|Заказ/i }).first()
    if (await openCart.count()) await openCart.click()

    await expect(page.getByRole('heading', { name: /Филиал получения/i })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel(/Поиск филиала/i)).toBeVisible()
    await expect(page.getByText(/UUID|xxxxxxxx-xxxx/i)).toHaveCount(0)
    const branchCard = page.locator('.branch-select-card, button.list-item').filter({ hasText: /Красноярск|центр|север|Москва|склад/i }).first()
    await expect(branchCard).toBeVisible({ timeout: 10_000 })
    await branchCard.click()
    await expect(page.getByText(/Выбран|Получение:/i).first()).toBeVisible()
  })

  test('knowledge article page renders', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')

    await page.goto('/knowledge')
    await expect(page.getByRole('heading', { name: /База|знани/i })).toBeVisible({ timeout: 10_000 })

    const articleLink = page.locator('a[href^="/knowledge/"]').first()
    await expect(articleLink).toBeVisible({ timeout: 15_000 })
    await articleLink.click()
    await expect(page).toHaveURL(/\/knowledge\/[^/]+/, { timeout: 10_000 })
    await expect(page.locator('main h1')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('main')).not.toContainText(/Статья не найдена/)
    await expect(page.locator('main .card, main .ProseMirror, main article, main section').first()).toBeVisible()
  })

  test('suppliers list has no UUID field for masters', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/cosmetics')
    await expect(page.getByRole('heading', { name: /Косметика|Поставщик/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/UUID|supplier_org_id|xxxxxxxx-xxxx/i)).toHaveCount(0)
    await expect(page.locator('main')).toBeVisible()
  })

  test('supplier products page usable', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1920', 'once')
    await loginUI(page, 'supplier1@demo.local')
    await page.goto('/supplier/products')
    await expect(page.getByRole('heading', { name: /Товар/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/UUID организации/i)).toHaveCount(0)
  })

  test('API suppliers published after seed', async () => {
    const auth = await apiLogin('master1@demo.local')
    const res = await fetch(`${api}/v1/suppliers`, {
      headers: { Authorization: `Bearer ${auth.access_token}` },
    })
    expect(res.ok).toBeTruthy()
    const data = await res.json() as { items: unknown[] }
    expect(Array.isArray(data.items)).toBeTruthy()
    expect(data.items.length).toBeGreaterThan(0)
  })

  test('knowledge list loads for master', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/knowledge')
    await expect(page.getByRole('heading', { name: /База|знани/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('a[href^="/knowledge/"]').first()).toBeVisible({ timeout: 15_000 })
  })
})
