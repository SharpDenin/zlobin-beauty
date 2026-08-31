import { test, expect } from '@playwright/test'

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

async function loginUI(page: import('@playwright/test').Page, email: string) {
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
  if (!res.ok) return null
  return res.json() as Promise<{ access_token: string }>
}

async function assertNoPageOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  expect(overflow).toBe(false)
}

test.describe('knowledge editor', () => {
  test('supplier opens article, edits, saves and keeps related audience', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1920', 'key viewports')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    const session = await apiLogin('supplier1@demo.local')
    if (!session) test.skip(true, 'seed login unavailable')

    const list = await fetch(`${api}/v1/me/knowledge?limit=50`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    expect(list.ok).toBeTruthy()
    const body = await list.json() as { items: Array<{ id: string; title: string }> }
    expect(body.items.length).toBeGreaterThan(0)

    let articles: Array<{ id: string; title: string }> = []
    for (const item of body.items) {
      if (/e2e|^p13-/i.test(item.title)) continue
      const detail = await fetch(`${api}/v1/knowledge/${item.id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!detail.ok) continue
      const full = await detail.json() as { id: string; title: string; content?: unknown }
      const hasDoc = full.content && (typeof full.content === 'object' || (typeof full.content === 'string' && full.content.length > 8))
      if (hasDoc) articles.push({ id: full.id, title: full.title })
    }
    expect(articles.length, 'seed knowledge article with content').toBeGreaterThan(0)
    const article = articles[info.project.name.includes('desktop') ? Math.min(1, articles.length - 1) : 0]

    await loginUI(page, 'supplier1@demo.local')
    await page.goto('/knowledge')
    await expect(page.getByRole('heading', { name: 'База знаний' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('kb-article').first()).toBeVisible()
    await assertNoPageOverflow(page)

    await page.goto(`/knowledge/${article.id}/edit`)
    await expect(page.getByTestId('kb-editor')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel('Название статьи')).toBeVisible()
    await expect(page.getByRole('toolbar', { name: 'Форматирование' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Сохранить черновик' })).toBeEnabled({ timeout: 10_000 })
    const related = page.getByTestId('kb-related-product').first()
    if (await related.count()) {
      await expect(related).toBeVisible()
      await expect(related.getByText(/Для домашнего ухода|Только для салонов/)).toBeVisible()
      await expect(page.getByText('professional_only')).toHaveCount(0)
    }
    await assertNoPageOverflow(page)

    const title = page.getByLabel('Название статьи')
    const current = await title.inputValue()
    const marker = `P13-${info.project.name}`
    const next = current.includes(marker) ? current.replace(new RegExp(`\\s*${marker}$`), '') : `${current} ${marker}`
    await title.fill(next)
    const editor = page.locator('.tiptap')
    await editor.click()
    await page.keyboard.type(' PHASE13')
    await expect(page.getByRole('button', { name: 'Сохранить черновик' })).toBeEnabled({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Сохранить черновик' }).click()
    await expect(page.getByRole('status')).toContainText(/Черновик сохранён|Материал опубликован/, { timeout: 15_000 })

    await page.reload()
    await expect(page.getByTestId('kb-editor')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel('Название статьи')).toHaveValue(next)

    const publish = page.getByRole('button', { name: 'Опубликовать' })
    if (await publish.isEnabled()) {
      await publish.click()
      await expect(page.getByRole('status')).toContainText(/опубликован/i, { timeout: 15_000 })
    }
  })
})

test.describe('supplier catalog', () => {
  test('supplier catalog loads with filters and human audience', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1920', 'key viewports')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
    if (!(await apiLogin('supplier1@demo.local'))) test.skip(true, 'seed login unavailable')

    await loginUI(page, 'supplier1@demo.local')
    await page.goto('/supplier/products')
    await expect(page.getByRole('heading', { name: /Товары/ })).toBeVisible({ timeout: 15_000 })
    await assertNoPageOverflow(page)
    await expect(page.locator('.shop-product-card, .product-card').filter({
      hasText: /Для домашнего ухода|Только для салонов/,
    }).first()).toBeVisible()
    await expect(page.getByText('professional_only')).toHaveCount(0)

    if (info.project.name === 'phone-390') {
      await page.getByRole('button', { name: /Фильтры/ }).click()
      await expect(page.getByRole('dialog', { name: 'Фильтры' })).toBeVisible()
      await page.getByRole('button', { name: 'Закрыть' }).click()
    }

    await page.locator('.shop-product-card, .product-card').first().click()
    await expect(page.getByRole('heading', { name: /Редактирование|Новый товар/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Для домашнего ухода')).toBeVisible()
    await assertNoPageOverflow(page)
  })
})
