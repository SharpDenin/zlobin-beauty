import { test, expect, type Page } from '@playwright/test'

/**
 * Hardened Salon-X P0 e2e.
 * When API is down → skip (no stack). When API is up but seed/login missing → FAIL.
 */
const api = process.env.VITE_API_BASE_URL ?? 'http://localhost:8090'
const password = process.env.SEED_PASSWORD ?? 'Password123!'
const requireSeed = process.env.E2E_REQUIRE_SEED !== '0'

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
  return res.json() as Promise<{ access_token: string }>
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
async function shopProductInStock(token: string, opts?: { skuPrefix?: string; excludeRace?: boolean }) {
  const res = await fetch(`${api}/v1/commerce/shop/products?limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.ok).toBeTruthy()
  const { items } = await res.json() as { items?: Array<{ id: string; sku?: string; available?: number }> }
  return (items ?? []).find((p) => {
    if ((p.available ?? 0) <= 0) return false
    if (opts?.excludeRace !== false && p.sku?.includes('RACE')) return false
    if (opts?.skuPrefix && !p.sku?.startsWith(opts.skuPrefix)) return false
    return true
  })
}

async function salonPickupBranchId(masterToken: string) {
  const orgsRes = await fetch(`${api}/v1/organizations/mine`, {
    headers: { Authorization: `Bearer ${masterToken}` },
  })
  expect(orgsRes.ok).toBeTruthy()
  const orgs = await orgsRes.json() as { items?: Array<{ organization: { type: string }; branches?: Array<{ id: string; pickup_enabled?: boolean }> }> }
  const salon = (orgs.items ?? []).find((i) => i.organization.type !== 'supplier')
  const branch = salon?.branches?.find((b) => b.pickup_enabled !== false) ?? salon?.branches?.[0]
  expect(branch?.id).toBeTruthy()
  return branch!.id
}

test.describe('Salon-X P0 flows (seeded stack)', () => {
  test.beforeEach(async () => {
    await requireApi()
  })

  test('supplier products + analytics + warehouse', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1920', 'two viewports')
    await loginUI(page, 'supplier1@demo.local')
    await page.goto('/supplier/products')
    await expect(page.getByRole('heading', { name: 'Товары' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.product-card, .list-item, a[href*="/supplier/products/"]').first()).toBeVisible({ timeout: 15_000 })
    await page.goto('/supplier/analytics')
    await expect(page.getByRole('heading', { name: 'Аналитика' })).toBeVisible({ timeout: 15_000 })
    await page.goto('/warehouse')
    await expect(page.getByRole('heading', { name: 'Склад', exact: true })).toBeVisible({ timeout: 15_000 })
  })

  test('master knowledge filters + favorite', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/knowledge')
    await expect(page.getByRole('heading', { name: 'База знаний' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Для окрашивания' }).click()
    const article = page.locator('a[href*="/knowledge/"]').first()
    await expect(article).toBeVisible({ timeout: 15_000 })
    await article.click()
    await expect(page.getByRole('button', { name: /избранн/i })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /избранн/i }).click()
  })

  test('representative route and tasks', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'rep1@demo.local')
    await page.goto('/rep')
    await expect(page.getByRole('heading', { name: 'Кабинет представителя' })).toBeVisible({ timeout: 15_000 })
    await page.goto('/rep/map')
    await expect(page.getByRole('heading', { name: 'Карта маршрута' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 15_000 })
  })

  test('salon owner staff + contact policy', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/staff')
    await expect(page.getByRole('heading', { name: /команда/i })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/контактн/i)).toBeVisible()
  })

  test('professional-only hidden from client shop API', async () => {
    const { access_token } = await apiLogin('client1@demo.local')
    const res = await fetch(`${api}/v1/commerce/shop/products`, {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    expect(res.ok).toBeTruthy()
    const data = await res.json() as { items?: Array<{ name: string }> }
    expect((data.items ?? []).some((p) => /Pro Fiber/i.test(p.name))).toBeFalsy()
  })

  test('subscription snapshot exists', async () => {
    const { access_token } = await apiLogin('master1@demo.local')
    const res = await fetch(`${api}/v1/me/subscription`, {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    expect(res.ok).toBeTruthy()
    const snap = await res.json() as { effective_plan?: string; status?: string }
    expect(snap.effective_plan || snap.status).toBeTruthy()
  })

  test('seeded recurring supply is visible to buyer', async () => {
    const { access_token } = await apiLogin('master1@demo.local')
    const orgsRes = await fetch(`${api}/v1/organizations/mine`, {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    expect(orgsRes.ok).toBeTruthy()
    const orgs = await orgsRes.json() as { items?: Array<{ organization: { id: string; type: string } }> }
    const buyer = (orgs.items ?? []).find((item) => item.organization.type !== 'supplier')
    expect(buyer?.organization.id).toBeTruthy()
    const recurring = await fetch(
      `${api}/v1/commerce/recurring?organization_id=${buyer!.organization.id}&role=buyer`,
      { headers: { Authorization: `Bearer ${access_token}` } },
    )
    expect(recurring.ok).toBeTruthy()
    const data = await recurring.json() as { items?: unknown[] }
    expect((data.items ?? []).length).toBeGreaterThan(0)
  })

  test('planner block controls and blacklist status are available', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await expect(page.getByRole('heading', { name: /календарь/i })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '+ Событие' }).click()
    await expect(page.getByRole('heading', { name: 'Новое событие', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Добавить в календарь' })).toBeVisible()

    const client = await apiLogin('client1@demo.local')
    const master = await apiLogin('master1@demo.local')
    const clientMe = await fetch(`${api}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const clientUser = await clientMe.json() as { id?: string; user?: { id?: string } }
    const clientId = clientUser.id ?? clientUser.user?.id
    expect(clientId).toBeTruthy()
    const status = await fetch(`${api}/v1/me/clients/${clientId}/blacklist`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(status.ok).toBeTruthy()
    const body = await status.json() as { blocked?: boolean; no_show_count?: number }
    expect(typeof body.blocked).toBe('boolean')
    expect(typeof body.no_show_count).toBe('number')
  })

  test('client shop catalog is in navigation', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'client1@demo.local')
    await page.goto('/shop')
    await expect(page.getByRole('heading', { name: 'Магазин' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('link', { name: 'Каталог' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Корзина/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Мои заказы' })).toBeVisible()
  })

  test('phase3 client shop checkout end-to-end', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'phase3 primary viewport')
    const client = await apiLogin('client1@demo.local')
    await clearClientCart(client.access_token)
    const inStock = await shopProductInStock(client.access_token)
    expect(inStock?.id).toBeTruthy()
    await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: inStock!.id, qty: 1 }),
    })
    await loginUI(page, 'client1@demo.local')
    await page.goto('/shop/cart')
    await expect(page.getByRole('heading', { name: 'Корзина' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Оформить заказ' })).toBeEnabled({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Оформить заказ' }).click()
    await expect(page.getByRole('heading', { name: 'Оформление заказа' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /Далее · оплата/i }).click()
    await page.getByRole('button', { name: /Далее · сводка/i }).click()
    await page.getByRole('button', { name: 'Подтвердить' }).click()
    await page.getByRole('button', { name: 'Подтвердить заказ' }).click()
    await expect(page.locator('.success-panel').getByText('Готово')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.success-panel').getByText(/^CL-/).first()).toBeVisible()
    await page.locator('.success-panel').getByRole('link', { name: 'Мои заказы' }).click()
    await expect(page.getByRole('heading', { name: 'Мои заказы' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.shop-order').first()).toBeVisible()
  })

  test('phase3 audience security blocks professional product', async () => {
    const master = await apiLogin('master1@demo.local')
    const client = await apiLogin('client1@demo.local')
    const list = await fetch(`${api}/v1/commerce/shop/products?limit=100`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(list.ok).toBeTruthy()
    const products = await list.json() as { items?: Array<{ id: string; name: string }> }
    const pro = (products.items ?? []).find((p) => /Pro Fiber/i.test(p.name))
    expect(pro?.id).toBeTruthy()
    const detail = await fetch(`${api}/v1/commerce/shop/products/${pro!.id}`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    expect(detail.status).toBe(404)
    const cart = await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: pro!.id, qty: 1 }),
    })
    expect(cart.status).toBe(403)
  })

  test('phase3 checkout idempotency key', async () => {
    const client = await apiLogin('client1@demo.local')
    await clearClientCart(client.access_token)
    const product = await shopProductInStock(client.access_token)
    expect(product?.id).toBeTruthy()
    await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: product!.id, qty: 1 }),
    })
    const branchId = await salonPickupBranchId((await apiLogin('master1@demo.local')).access_token)
    const idem = `e2e-idem-${Date.now()}`
    const body = {
      delivery_address: 'E2E Test Address 123',
      payment_method: 'cash',
      pickup_branch_id: branchId,
      confirm_price_changes: true,
    }
    const h = { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json', 'Idempotency-Key': idem }
    const first = await fetch(`${api}/v1/commerce/shop/checkout`, { method: 'POST', headers: h, body: JSON.stringify(body) })
    expect(first.status).toBe(201)
    const result1 = await first.json() as { checkout_group_id?: string; orders?: Array<{ id: string }>; id?: string }
    const second = await fetch(`${api}/v1/commerce/shop/checkout`, { method: 'POST', headers: h, body: JSON.stringify(body) })
    expect(second.status).toBe(201)
    const result2 = await second.json() as { checkout_group_id?: string; orders?: Array<{ id: string }>; id?: string }
    if (result1.checkout_group_id && result2.checkout_group_id) {
      expect(result2.checkout_group_id).toBe(result1.checkout_group_id)
      expect(result2.orders?.map((o) => o.id)).toEqual(result1.orders?.map((o) => o.id))
    } else {
      expect(result2.id ?? result2.orders?.[0]?.id).toBe(result1.id ?? result1.orders?.[0]?.id)
    }
  })

  test('phase3 multi-supplier checkout creates separate orders', async () => {
    const client = await apiLogin('client1@demo.local')
    await clearClientCart(client.access_token)
    const supplier = await apiLogin('supplier1@demo.local')
    const supplier2 = await apiLogin('supplier2@demo.local')
    const list1 = await fetch(`${api}/v1/commerce/shop/products?limit=50`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const { items: all } = await list1.json() as { items?: Array<{ id: string; organization_id: string; sku: string }> }
    const org1Products = (all ?? []).filter((p) => p.sku.startsWith('S1-') && !p.sku.includes('RACE'))
    const org2Products = (all ?? []).filter((p) => p.sku.startsWith('S2-'))
    expect(org1Products.length).toBeGreaterThan(0)
    expect(org2Products.length).toBeGreaterThan(0)
    await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: org1Products[0].id, qty: 1 }),
    })
    await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: org1Products[1].id, qty: 1 }),
    })
    await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: org2Products[0].id, qty: 1 }),
    })
    const branchId = await salonPickupBranchId((await apiLogin('master1@demo.local')).access_token)
    const idem = `e2e-multi-${Date.now()}`
    const checkout = await fetch(`${api}/v1/commerce/shop/checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.access_token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idem,
      },
      body: JSON.stringify({
        delivery_address: 'Multi Supplier Test 456',
        payment_method: 'cash',
        pickup_branch_id: branchId,
        confirm_price_changes: true,
      }),
    })
    expect(checkout.status).toBe(201)
    const result = await checkout.json() as { checkout_group_id: string; orders: Array<{ id: string; supplier_org_id: string }> }
    expect(result.orders.length).toBe(2)
    const orgs = new Set(result.orders.map((o) => o.supplier_org_id))
    expect(orgs.size).toBe(2)

    const dup = await fetch(`${api}/v1/commerce/shop/checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.access_token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idem,
      },
      body: JSON.stringify({
        delivery_address: 'Multi Supplier Test 456',
        payment_method: 'cash',
        pickup_branch_id: branchId,
      }),
    })
    expect(dup.status).toBe(201)
    const dupResult = await dup.json() as { checkout_group_id: string; orders: Array<{ id: string }> }
    expect(dupResult.checkout_group_id).toBe(result.checkout_group_id)
    expect(dupResult.orders.map((o) => o.id)).toEqual(result.orders.map((o) => o.id))

    const sup1OrgRes = await fetch(`${api}/v1/organizations/mine`, {
      headers: { Authorization: `Bearer ${supplier.access_token}` },
    })
    const sup1OrgData = await sup1OrgRes.json() as { items?: Array<{ organization: { id: string; type: string } }> }
    const sup1OrgId = sup1OrgData.items?.find((i) => i.organization.type === 'supplier')?.organization.id
    expect(sup1OrgId).toBeTruthy()

    for (const order of result.orders) {
      const token = order.supplier_org_id === sup1OrgId ? supplier.access_token : supplier2.access_token
      const listRes = await fetch(`${api}/v1/commerce/shop/supplier/orders?organization_id=${order.supplier_org_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(listRes.ok).toBeTruthy()
      const list = await listRes.json() as { items?: Array<{ id: string }> }
      expect((list.items ?? []).some((o) => o.id === order.id)).toBeTruthy()
    }
    const otherSupplierOrders = result.orders.filter((o) => o.supplier_org_id !== sup1OrgId)
    if (otherSupplierOrders.length === 2) {
      expect(otherSupplierOrders[0].supplier_org_id).not.toBe(otherSupplierOrders[1].supplier_org_id)
    }
  })

  test('phase3 cross-role pickup flow', async () => {
    const client = await apiLogin('client1@demo.local')
    await clearClientCart(client.access_token)
    const supplier = await apiLogin('supplier1@demo.local')
    const rep = await apiLogin('rep1@demo.local')
    const salon = await apiLogin('master1@demo.local')
    const product = await shopProductInStock(client.access_token, { skuPrefix: 'S1-', excludeRace: true })
    expect(product?.id).toBeTruthy()
    await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: product!.id, qty: 1 }),
    })
    const branchId = await salonPickupBranchId(salon.access_token)
    const idem = `e2e-cross-${Date.now()}`
    const checkout = await fetch(`${api}/v1/commerce/shop/checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.access_token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idem,
      },
      body: JSON.stringify({
        delivery_address: 'Cross Role Flow Test',
        payment_method: 'cash',
        pickup_branch_id: branchId,
        confirm_price_changes: true,
      }),
    })
    expect(checkout.status).toBe(201)
    const created = await checkout.json() as { orders: Array<{ id: string }> }
    const orderId = created.orders[0].id

    const advance = async (status: string, repUserId?: string) => {
      const body: Record<string, string> = { status }
      if (repUserId) body.rep_user_id = repUserId
      const res = await fetch(`${api}/v1/commerce/shop/supplier/orders/${orderId}/transition`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res.status).toBeLessThan(300)
    }
    await advance('confirmed')
    await advance('picking')
    const me = await fetch(`${api}/v1/me/representative`, { headers: { Authorization: `Bearer ${rep.access_token}` } })
    const repMe = await me.json() as { id: string; user_id: string }
    await advance('in_delivery', repMe.user_id)

    const detail = await fetch(`${api}/v1/commerce/shop/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const orderDetail = await detail.json() as { items: Array<{ product_id: string; qty: number }> }
    const complete = await fetch(`${api}/v1/commerce/rep/deliveries/${orderId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${rep.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: orderDetail.items.map((it) => ({ product_id: it.product_id, qty_delivered: it.qty })),
        note: 'e2e',
        payment_received: true,
        amount_collected_minor: 89000,
      }),
    })
    expect(complete.status).toBeLessThan(300)

    const accept = await fetch(`${api}/v1/commerce/shop/pickup/orders/${orderId}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${salon.access_token}` },
    })
    expect(accept.status).toBeLessThan(300)

    const afterAccept = await fetch(`${api}/v1/commerce/shop/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const ready = await afterAccept.json() as { status: string; status_history?: Array<{ to_status: string }> }
    expect(ready.status).toBe('ready_for_pickup')

    const handover = await fetch(`${api}/v1/commerce/shop/pickup/orders/${orderId}/handover`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${salon.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_received: true }),
    })
    expect(handover.status).toBeLessThan(300)

    const final = await fetch(`${api}/v1/commerce/shop/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const done = await final.json() as { status: string; status_history?: Array<{ to_status: string }> }
    expect(done.status).toBe('received')
    const transitions = (done.status_history ?? []).map((h) => h.to_status)
    expect(transitions).toContain('submitted')
    expect(transitions).toContain('ready_for_pickup')
    expect(transitions).toContain('received')
  })

  test('phase3 price change confirmation', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'phase3 primary viewport')
    const supplier = await apiLogin('supplier1@demo.local')
    const client = await apiLogin('client1@demo.local')
    await clearClientCart(client.access_token)
    const products = await fetch(`${api}/v1/commerce/shop/products?limit=20`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    const { items } = await products.json() as { items?: Array<{ id: string; sku: string; price_minor: number }> }
    const target = (items ?? []).find((p) => p.sku === 'S1-EST-ESX-001') ?? items?.[0]
    expect(target?.id).toBeTruthy()
    const oldPrice = target!.price_minor
    const newPrice = oldPrice + 20000
    await fetch(`${api}/v1/commerce/shop/cart/items`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: target!.id, qty: 1 }),
    })
    const patch = await fetch(`${api}/v1/commerce/products/${target!.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_minor: newPrice }),
    })
    expect(patch.status).toBeLessThan(300)

    await loginUI(page, 'client1@demo.local')
    await page.goto('/shop/checkout')
    await page.getByRole('button', { name: /Далее · оплата/i }).click()
    await page.getByRole('button', { name: /Далее · сводка/i }).click()
    await page.getByRole('button', { name: 'Подтвердить' }).click()
    await page.getByRole('button', { name: 'Подтвердить заказ' }).click()
    await expect(page.getByText(/Цена.*изменилась|Подтвердить новую цену/i).first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Подтвердить новую цену' }).click()
    await expect(page.getByRole('button', { name: 'Подтвердить заказ' })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Подтвердить заказ' }).click()
    await expect(page.locator('.success-panel').getByText('Готово')).toBeVisible({ timeout: 20_000 })
    await fetch(`${api}/v1/commerce/products/${target!.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${supplier.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_minor: oldPrice }),
    })
  })

  test('master dashboard and calendar modes', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible({ timeout: 15_000 })
    await page.goto('/calendar')
    await expect(page.getByRole('button', { name: 'Неделя' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'День' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Месяц' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Список' })).toBeVisible()
  })

  test('subscription page shows trial or plan', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await page.goto('/profile/subscription')
    await expect(page.getByRole('heading', { name: 'Подписка' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Free и Premium' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'TRIAL', exact: true })).toBeVisible()
  })

  test('seed accounts exist when E2E_REQUIRE_SEED', async () => {
    if (!requireSeed) return
    for (const email of [
      'client1@demo.local',
      'client2@demo.local',
      'client3@demo.local',
      'master1@demo.local',
      'master2@demo.local',
      'master3@demo.local',
      'master4@demo.local',
      'chain1@demo.local',
      'mobile1@demo.local',
      'admin1@demo.local',
      'expired1@demo.local',
      'supplier1@demo.local',
      'supplier2@demo.local',
      'rep1@demo.local',
      'rep2@demo.local',
    ]) {
      await apiLogin(email)
    }
  })

  test('blacklisted client is blocked for master1 and has no-show count', async () => {
    const client3 = await apiLogin('client3@demo.local')
    const master = await apiLogin('master1@demo.local')
    const me = await fetch(`${api}/v1/auth/me`, { headers: { Authorization: `Bearer ${client3.access_token}` } })
    const body = await me.json() as { id?: string; user?: { id?: string } }
    const clientId = body.id ?? body.user?.id
    expect(clientId).toBeTruthy()
    const status = await fetch(`${api}/v1/me/clients/${clientId}/blacklist`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(status.ok).toBeTruthy()
    const bl = await status.json() as { blocked?: boolean; no_show_count?: number }
    expect(bl.blocked).toBe(true)
    expect((bl.no_show_count ?? 0)).toBeGreaterThanOrEqual(2)
  })

  test('dashboard PUT/GET round-trip persists layout and colors', async () => {
    const master = await apiLogin('master1@demo.local')
    const widgets = [
      { id: 'alerts', enabled: true, positions: { lg: { x: 0, y: 0, w: 12, h: 5 } } },
      { id: 'calendar', enabled: true, positions: { lg: { x: 0, y: 5, w: 12, h: 18 } } },
      { id: 'today', enabled: true, positions: { lg: { x: 0, y: 23, w: 3, h: 4 } } },
      { id: 'pending', enabled: true, positions: { lg: { x: 3, y: 23, w: 3, h: 4 } } },
      { id: 'clients_today', enabled: true, positions: { lg: { x: 6, y: 23, w: 3, h: 4 } } },
      { id: 'upcoming', enabled: true, positions: { lg: { x: 0, y: 27, w: 6, h: 8 } } },
      { id: 'analytics', enabled: true, positions: { lg: { x: 6, y: 27, w: 6, h: 8 } } },
      { id: 'messages', enabled: false, positions: { lg: { x: 9, y: 23, w: 3, h: 4 } } },
      { id: 'calendar_colors', colors: { personal: '#aa5533' } },
    ]
    const put = await fetch(`${api}/v1/me/dashboard`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ widgets }),
    })
    expect(put.ok, `PUT dashboard ${put.status} ${await put.text()}`).toBeTruthy()
    const get = await fetch(`${api}/v1/me/dashboard`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    expect(get.ok).toBeTruthy()
    const body = await get.json() as { widgets: Array<{ id: string; enabled?: boolean; colors?: Record<string, string> }> }
    expect(body.widgets.find((w) => w.id === 'messages')?.enabled).toBe(false)
    expect(body.widgets.find((w) => w.id === 'calendar_colors')?.colors?.personal).toBe('#aa5533')
  })

  test('owner and admin can load org calendar; client cannot', async () => {
    const master = await apiLogin('master1@demo.local')
    const admin = await apiLogin('admin1@demo.local')
    const client = await apiLogin('client1@demo.local')
    const orgsRes = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    expect(orgsRes.ok).toBeTruthy()
    const orgs = await orgsRes.json() as { items: Array<{ organization: { id: string } }> }
    const orgID = orgs.items[0]?.organization.id
    expect(orgID).toBeTruthy()
    const from = new Date(Date.now() - 7 * 86400000).toISOString()
    const to = new Date(Date.now() + 14 * 86400000).toISOString()
    const qs = `organization_id=${orgID}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    const adminCal = await fetch(`${api}/v1/calendar/appointments?${qs}`, { headers: { Authorization: `Bearer ${admin.access_token}` } })
    expect(adminCal.status, await adminCal.text()).toBe(200)
    const masterCal = await fetch(`${api}/v1/calendar/appointments?${qs}`, { headers: { Authorization: `Bearer ${master.access_token}` } })
    expect(masterCal.status).toBe(200)
    const clientCal = await fetch(`${api}/v1/calendar/appointments?${qs}`, { headers: { Authorization: `Bearer ${client.access_token}` } })
    expect(clientCal.status).toBe(403)
  })

  test('planner block occupies time and cannot overlap', async () => {
    const master = await apiLogin('master1@demo.local')
    const start = new Date(Date.UTC(2026, 11, 15, 4, 0, 0))
    const end = new Date(Date.UTC(2026, 11, 15, 5, 0, 0))
    const payload = {
      title: 'E2E lunch occupancy',
      category: 'break',
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      timezone: 'Asia/Krasnoyarsk',
    }
    const create = await fetch(`${api}/v1/planner/blocks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const created = await create.json() as { id?: string }
    expect(create.status, JSON.stringify(created)).toBeLessThan(300)
    expect(created.id).toBeTruthy()
    const overlap = await fetch(`${api}/v1/planner/blocks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, title: 'E2E overlap', category: 'personal' }),
    })
    expect(overlap.status).toBe(409)
    const del = await fetch(`${api}/v1/planner/blocks/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    expect(del.status).toBe(204)
  })

  test('salon admin lands on operational dashboard and can open staff', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'admin1@demo.local')
    await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('link', { name: 'Найти мастера' })).toHaveCount(0)
    await page.goto('/staff')
    await expect(page.getByRole('heading', { name: /Команда/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('только мастерам')).toHaveCount(0)
  })

  test('dashboard widget toggle survives reload', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'master1@demo.local')
    await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Настроить' }).click()
    const messages = page.locator('.dashboard-setting-row').filter({ hasText: 'Сообщения' }).locator('input[type="checkbox"]')
    await expect(messages).toBeVisible()
    if (await messages.isChecked()) await messages.uncheck()
    await page.getByRole('button', { name: 'Готово' }).click()
    await page.reload()
    await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.widget-drag-handle', { hasText: 'Сообщения' })).toHaveCount(0)
  })

  test('calendar planner block is clickable and editable', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const master = await apiLogin('master1@demo.local')
    const from = new Date(Date.UTC(2026, 7, 17)).toISOString()
    const to = new Date(Date.UTC(2026, 8, 1)).toISOString()
    const listed = await fetch(`${api}/v1/planner/blocks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    const listedBody = await listed.json() as { items?: Array<{ id: string; title: string }> }
    let block = listedBody.items?.find((b) => b.title === 'E2E блок планера')
    if (!block) {
      const start = new Date(Date.UTC(2026, 7, 19, 3, 30, 0))
      const end = new Date(Date.UTC(2026, 7, 19, 4, 30, 0))
      const create = await fetch(`${api}/v1/planner/blocks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'E2E блок планера',
          category: 'task',
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          timezone: 'Asia/Krasnoyarsk',
        }),
      })
      const created = await create.json() as { id?: string }
      expect(create.status, JSON.stringify(created)).toBeLessThan(300)
      block = { id: created.id!, title: 'E2E блок планера' }
    }
    await loginUI(page, 'master1@demo.local')
    await page.goto('/calendar')
    await expect(page.getByRole('button', { name: 'Неделя' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Список' }).click()
    const row = page.locator('.fc-list-event').filter({ hasText: 'E2E блок планера' }).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.scrollIntoViewIfNeeded()
    await row.click({ force: true })
    await expect(page.getByRole('heading', { name: 'Событие планера' })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Удалить событие' }).click()
    await expect(page.getByText('Событие удалено')).toBeVisible()
  })

  test('chain calendar branch switcher is present', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'chain1@demo.local')
    await page.goto('/calendar')
    await expect(page.getByTestId('calendar-branch-switcher')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('calendar-branch-switcher').getByRole('option', { name: 'Новосибирск' }).first()).toBeAttached()
    await page.getByTestId('calendar-branch-switcher').selectOption({ label: 'Новосибирск' })
    await expect(page.getByText(/Asia\/Novosibirsk/)).toBeVisible()
  })

  test('phase2 supplier dashboard analytics team and assign task', async ({ page }, info) => {
    test.skip(!['phone-390', 'phone-430', 'tablet-768', 'laptop-1366', 'desktop-1920'].includes(info.project.name), 'phase2 viewports')
    await loginUI(page, 'supplier1@demo.local')
    await expect(page).toHaveURL(/\/supplier/, { timeout: 20_000 })
    await expect(page.getByText('Выручка сегодня').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Ожидает оплаты').first()).toBeVisible()
    await test.info().attach(`supplier-dashboard-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    await page.goto('/supplier/analytics')
    await expect(page.getByRole('heading', { name: 'Аналитика' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Неделя' }).click()
    await expect(page.getByText('Динамика выручки')).toBeVisible()
    await expect(page.locator('.recharts-surface').first()).toBeVisible({ timeout: 15_000 })
    if (info.project.name === 'laptop-1366') {
      await test.info().attach('supplier-analytics-desktop', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    }

    await page.goto('/supplier/team')
    await expect(page.getByRole('heading', { name: 'Представители' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Елена/).first()).toBeVisible()
    await expect(page.getByText(/Павел/).first()).toBeVisible()
    await test.info().attach(`supplier-team-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    const elena = page.locator('.kb-card').filter({ hasText: 'Елена' }).first()
    await elena.getByRole('button', { name: 'Создать задачу' }).click()
    const taskTitle = `E2E визит ${info.project.name}-${Date.now()}`
    await elena.getByLabel('Название').fill(taskTitle)
    await elena.getByLabel('Тип').selectOption('salon_visit')
    await elena.getByRole('button', { name: 'Создать задачу' }).last().click()
    await expect(page.getByText('Задача назначена')).toBeVisible({ timeout: 15_000 })
    await elena.getByRole('link', { name: 'Открыть' }).click()
    await expect(page.getByRole('heading', { name: /Елена/ })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Задачи' }).click()
    await expect(page.getByText(taskTitle).first()).toBeVisible({ timeout: 15_000 })
    if (info.project.name === 'phone-390') {
      await page.goto('/warehouse')
      await expect(page.getByRole('heading', { name: 'Склад' })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(/доступно|резерв|в пути/).first()).toBeVisible()
    }
  })

  test('phase2 representative dashboard map finance analytics', async ({ page }, info) => {
    test.skip(!['phone-390', 'phone-430', 'tablet-768', 'laptop-1366', 'desktop-1920'].includes(info.project.name), 'phase2 viewports')
    await loginUI(page, 'rep1@demo.local')
    await expect(page).toHaveURL(/\/rep/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Кабинет представителя' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Задач сегодня')).toBeVisible()
    await expect(page.getByText('К получению сегодня')).toBeVisible()
    await test.info().attach(`rep-dashboard-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    await expect(page.locator('.fc, .calendar-wrap').first()).toBeVisible({ timeout: 15_000 })

    await page.goto('/rep/map')
    await expect(page.getByRole('heading', { name: 'Карта маршрута' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.leaflet-overlay-pane svg, .leaflet-pane svg, path.leaflet-interactive').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('ol.list li, .list-item').first()).toBeVisible()
    await test.info().attach(`rep-map-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    await page.goto('/rep/finance')
    await expect(page.getByText('Итого на день')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Получено за месяц')).toBeVisible()
    await test.info().attach(`rep-finance-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    await page.goto('/rep/analytics')
    await expect(page.getByText('Доставки по дням')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.recharts-surface').first()).toBeVisible()
    await test.info().attach(`rep-analytics-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    if (info.project.name === 'phone-390') {
      await page.goto('/warehouse')
      await expect(page.getByRole('heading', { name: 'Склад' })).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.product-card .badge, .badge').filter({ hasText: /Достаточный запас|Низкий запас|Нет в наличии/ }).first()).toBeVisible({ timeout: 15_000 })
    }
  })

  test('phase2 supplier monitoring sees both representatives', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    await loginUI(page, 'supplier1@demo.local')
    await page.goto('/supplier/team')
    await expect(page.getByRole('heading', { name: 'Мониторинг' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Елена/).first()).toBeVisible()
    await expect(page.getByText(/Павел/).first()).toBeVisible()
    await expect(page.getByText(/просроч/i).first()).toBeVisible()
    await expect(page.getByText(/доставок/i).first()).toBeVisible()
    await expect(page.getByText(/собрано/i).first()).toBeVisible()
  })
})
