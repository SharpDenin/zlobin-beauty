import { test, expect, type Page } from '@playwright/test'

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

async function apiLogin(email: string) {
  const res = await fetch(`${api}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(res.ok, `login ${email} → ${res.status}`).toBeTruthy()
  return res.json() as Promise<{ access_token: string }>
}

async function loginUI(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

async function clearClientCart(token: string) {
  const cart = await fetch(`${api}/v1/commerce/shop/cart`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!cart.ok) return
  const data = await cart.json() as { items?: Array<{ product_id: string }> }
  for (const it of data.items ?? []) {
    await fetch(`${api}/v1/commerce/shop/cart/items/${it.product_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
  }
}

async function shopProductInStock(token: string) {
  const res = await fetch(`${api}/v1/commerce/shop/products?limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.ok).toBeTruthy()
  const { items } = await res.json() as { items?: Array<{ id: string; sku?: string; available?: number }> }
  return (items ?? []).find((p) => (p.available ?? 0) > 0 && p.sku?.startsWith('S1-') && !p.sku.includes('RACE'))
}

async function salonPickupBranchId(masterToken: string) {
  const orgsRes = await fetch(`${api}/v1/organizations/mine`, {
    headers: { Authorization: `Bearer ${masterToken}` },
  })
  const orgs = await orgsRes.json() as {
    items?: Array<{ organization: { type: string }; branches?: Array<{ id: string; pickup_enabled?: boolean }> }>
  }
  const salon = (orgs.items ?? []).find((i) => i.organization.type !== 'supplier') ?? orgs.items?.[0]
  const branch = (salon?.branches ?? []).find((b) => b.pickup_enabled !== false) ?? salon?.branches?.[0]
  expect(branch?.id).toBeTruthy()
  return branch!.id
}

/** API setup only — brings a client order to status received for UI return. */
async function createReceivedOrder(opts?: { clientEmail?: string; marker?: string }) {
  const clientEmail = opts?.clientEmail ?? 'client2@demo.local'
  const marker = opts?.marker ?? `UI-RET-${Date.now()}`
  const client = await apiLogin(clientEmail)
  await clearClientCart(client.access_token)
  const supplier = await apiLogin('supplier1@demo.local')
  const salon = await apiLogin('master1@demo.local')
  const product = await shopProductInStock(client.access_token)
  expect(product?.id).toBeTruthy()
  await fetch(`${api}/v1/commerce/shop/cart/items`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_id: product!.id, qty: 1 }),
  })
  const branchId = await salonPickupBranchId(salon.access_token)
  const deliveryAddress = `UI Return ${marker}`
  const checkout = await fetch(`${api}/v1/commerce/shop/checkout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${client.access_token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `e2e-ui-return-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    },
    body: JSON.stringify({
      delivery_address: deliveryAddress,
      payment_method: 'cash',
      pickup_branch_id: branchId,
      confirm_price_changes: true,
    }),
  })
  expect(checkout.status).toBe(201)
  const created = await checkout.json() as {
    orders: Array<{ id: string; order_number?: string; total_minor: number }>
  }
  const orderId = created.orders[0].id
  const totalMinor = created.orders[0].total_minor

  for (const status of ['confirmed', 'picking', 'in_delivery', 'delivered'] as const) {
    const res = await fetch(`${api}/v1/commerce/shop/supplier/orders/${orderId}/transition`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    expect(res.status, `transition ${status}`).toBeLessThan(300)
  }
  expect((await fetch(`${api}/v1/commerce/shop/pickup/orders/${orderId}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${salon.access_token}` },
  })).status).toBeLessThan(300)
  expect((await fetch(`${api}/v1/commerce/shop/pickup/orders/${orderId}/handover`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${salon.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ payment_received: true }),
  })).status).toBeLessThan(300)

  const detail = await fetch(`${api}/v1/commerce/shop/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${client.access_token}` },
  })
  const body = await detail.json() as { status: string; order_number?: string }
  expect(body.status).toBe('received')
  return {
    orderId,
    orderNumber: body.order_number ?? created.orders[0].order_number ?? orderId,
    totalMinor,
    deliveryAddress,
  }
}

async function assertNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  expect(overflow).toBe(false)
}

async function openReturnModalForOrder(page: Page, deliveryAddress: string) {
  await page.goto('/supplier/client-orders')
  await expect(page.getByRole('heading', { name: 'Заказы клиентов' })).toBeVisible({ timeout: 15_000 })
  const card = page.locator('article.card').filter({ hasText: deliveryAddress }).filter({
    has: page.getByRole('button', { name: 'Оформить возврат' }),
  }).first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.getByRole('button', { name: 'Оформить возврат' }).click()
  await expect(page.getByRole('heading', { name: 'Полный возврат заказа' })).toBeVisible()
  return card
}

test.describe('SHOP-02 return UI', () => {
  test('supplier completes return via real UI clicks', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'primary UI viewport')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    const order = await createReceivedOrder({ clientEmail: 'client2@demo.local', marker: `MAIN-${Date.now()}` })
    const amountFmt = Math.round(order.totalMinor / 100).toLocaleString('ru-RU').replace(/\s/g, '[\\s\\u00a0\\u202f]')

    await loginUI(page, 'supplier1@demo.local')
    await openReturnModalForOrder(page, order.deliveryAddress)

    const modal = page.locator('.modal-sheet').filter({ hasText: 'Полный возврат заказа' })
    await expect(modal.getByText(order.orderNumber)).toBeVisible()
    await expect(modal.getByText(new RegExp(`${amountFmt}.*₽`))).toBeVisible()
    await expect(modal.getByText(/необратим/i)).toBeVisible()

    const confirm = page.getByRole('button', { name: 'Подтвердить возврат' })
    await expect(confirm).toBeDisabled()
    await page.getByLabel('Причина возврата').fill('ab')
    await expect(confirm).toBeDisabled()
    await page.getByLabel('Причина возврата').fill('UI e2e return reason')
    await expect(confirm).toBeEnabled()
    await confirm.click()

    await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'Возврат оформлен' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Полный возврат заказа' })).toHaveCount(0)

    const updated = page.locator('article.card').filter({ hasText: order.deliveryAddress }).first()
    await expect(updated.locator('.badge').filter({ hasText: 'Возврат' })).toBeVisible()
    await expect(updated.getByText(/возврат зафиксирован/i)).toBeVisible()
    await expect(updated.getByText(/Оплата:.*Возврат/i)).toBeVisible()
    await expect(updated.getByRole('button', { name: 'Оформить возврат' })).toHaveCount(0)

    // Buyer must not see/initiate return action
    const logout = page.getByRole('button', { name: 'Выйти' })
    if (await logout.isVisible().catch(() => false)) {
      await logout.click()
    } else {
      await page.context().clearCookies()
      await page.evaluate(() => localStorage.clear())
    }
    await loginUI(page, 'client2@demo.local')
    await page.goto('/shop/orders')
    await expect(page.getByRole('heading', { name: 'Мои заказы' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Оформить возврат' })).toHaveCount(0)
    // Client API cannot return either
    const clientTok = await apiLogin('client2@demo.local')
    const forbidden = await fetch(`${api}/v1/commerce/shop/supplier/orders/${order.orderId}/return`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientTok.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'client ui attempt' }),
    })
    expect(forbidden.status).toBeGreaterThanOrEqual(400)
  })

  test('return modal adaptive widths 360–1440', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'single worker drives all widths')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    const order = await createReceivedOrder({ clientEmail: 'client1@demo.local', marker: `ADAPT-${Date.now()}` })
    await loginUI(page, 'supplier1@demo.local')

    const widths = [360, 390, 768, 1024, 1440] as const
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 })
      await openReturnModalForOrder(page, order.deliveryAddress)

      const dialog = page.locator('.modal-sheet').filter({ hasText: 'Полный возврат заказа' })
      await expect(dialog).toBeVisible()
      await expect(page.getByLabel('Причина возврата')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Отмена' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Подтвердить возврат' })).toBeVisible()

      const reason = page.getByLabel('Причина возврата')
      await reason.click()
      await reason.fill(`adaptive ${width}`)
      const box = await reason.boundingBox()
      expect(box, `reason touch target @${width}`).toBeTruthy()
      expect((box?.height ?? 0) >= 24).toBeTruthy()

      const cancelBox = await page.getByRole('button', { name: 'Отмена' }).boundingBox()
      expect((cancelBox?.height ?? 0) >= 32).toBeTruthy()

      await assertNoPageOverflow(page)
      const clipped = await page.evaluate(() => {
        const sheet = document.querySelector('.modal-sheet')
        if (!sheet) return true
        const r = sheet.getBoundingClientRect()
        return r.left < -1 || r.right > window.innerWidth + 1 || r.top < -1
      })
      expect(clipped, `modal clipped @${width}`).toBe(false)

      await page.getByRole('button', { name: 'Отмена' }).click()
      await expect(page.getByRole('heading', { name: 'Полный возврат заказа' })).toHaveCount(0)
    }

    // Complete return once after adaptive checks so the order is not left open
    await page.setViewportSize({ width: 390, height: 844 })
    await openReturnModalForOrder(page, order.deliveryAddress)
    await page.getByLabel('Причина возврата').fill('adaptive suite cleanup return')
    await page.getByRole('button', { name: 'Подтвердить возврат' }).click()
    await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'Возврат оформлен' })).toBeVisible({ timeout: 15_000 })
  })
})
