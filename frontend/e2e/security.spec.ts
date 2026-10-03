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

async function login(email: string) {
  const res = await fetch(`${api}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(res.ok, `login ${email} → ${res.status}`).toBeTruthy()
  return res.json() as Promise<{ access_token: string; user?: { id: string } }>
}

test.describe('object-level authorization', () => {
  test('strangers cannot read or mutate another salon appointment, portfolio, planner or contact', async ({}, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)

    const owner = await login('master1@demo.local')
    const stranger = await login('master2@demo.local')
    const client = await login('client2@demo.local')
    const supplier = await login('supplier1@demo.local')

    const orgsRes = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${owner.access_token}` } })
    expect(orgsRes.ok).toBeTruthy()
    const orgs = await orgsRes.json() as { items: Array<{ organization: { id: string } }> }
    const orgID = orgs.items[0]?.organization.id
    expect(orgID).toBeTruthy()
    const from = new Date(Date.now() - 7 * 86400000).toISOString()
    const to = new Date(Date.now() + 14 * 86400000).toISOString()
    const qs = `organization_id=${orgID}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`

    const ownerCal = await fetch(`${api}/v1/calendar/appointments?${qs}`, { headers: { Authorization: `Bearer ${owner.access_token}` } })
    expect(ownerCal.status).toBe(200)
    const strangerCal = await fetch(`${api}/v1/calendar/appointments?${qs}`, { headers: { Authorization: `Bearer ${stranger.access_token}` } })
    expect(strangerCal.status).toBe(403)
    const supplierCal = await fetch(`${api}/v1/calendar/appointments?${qs}`, { headers: { Authorization: `Bearer ${supplier.access_token}` } })
    expect(supplierCal.status).toBe(403)
    const clientCal = await fetch(`${api}/v1/calendar/appointments?${qs}`, { headers: { Authorization: `Bearer ${client.access_token}` } })
    expect(clientCal.status).toBe(403)

    const mine = await fetch(`${api}/v1/appointments/mine?role=master`, { headers: { Authorization: `Bearer ${owner.access_token}` } })
    expect(mine.ok).toBeTruthy()
    const appts = await mine.json() as { items?: Array<{ id: string }> }
    const apptId = appts.items?.[0]?.id
    expect(apptId, 'seeded owner appointments').toBeTruthy()
    const stolenGet = await fetch(`${api}/v1/appointments/${apptId}`, { headers: { Authorization: `Bearer ${stranger.access_token}` } })
    expect([403, 404]).toContain(stolenGet.status)
    const stolenCancel = await fetch(`${api}/v1/appointments/${apptId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${stranger.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'idor' }),
    })
    expect([403, 404]).toContain(stolenCancel.status)

    const port = await fetch(`${api}/v1/me/master/portfolio`, { headers: { Authorization: `Bearer ${owner.access_token}` } })
    expect(port.ok).toBeTruthy()
    const items = await port.json() as { items?: Array<{ id: string }> }
    const itemId = items.items?.[0]?.id
    if (itemId) {
      const stolenPatch = await fetch(`${api}/v1/me/master/portfolio/${itemId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${stranger.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'взлом' }),
      })
      expect([403, 404]).toContain(stolenPatch.status)
      const stolenDel = await fetch(`${api}/v1/me/master/portfolio/${itemId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${stranger.access_token}` },
      })
      expect([403, 404]).toContain(stolenDel.status)
    }

    const blocks = await fetch(
      `${api}/v1/planner/blocks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { Authorization: `Bearer ${owner.access_token}` } },
    )
    expect(blocks.ok).toBeTruthy()
    const blockList = await blocks.json() as { items?: Array<{ id: string }> }
    const blockId = blockList.items?.[0]?.id
    if (blockId) {
      const stolenBlock = await fetch(`${api}/v1/planner/blocks/${blockId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${stranger.access_token}` },
      })
      expect([403, 404]).toContain(stolenBlock.status)
    }

    const contacts = await fetch(`${api}/v1/contacts`, { headers: { Authorization: `Bearer ${owner.access_token}` } })
    expect(contacts.ok).toBeTruthy()
    const contactList = await contacts.json() as { items?: Array<{ id: string }> }
    const contactId = contactList.items?.[0]?.id
    if (contactId) {
      const stolenContact = await fetch(`${api}/v1/contacts/${contactId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${stranger.access_token}` },
      })
      expect([403, 404]).toContain(stolenContact.status)
    }

    const internal = await fetch(`${api}/v1/internal/appointments?organization_id=${orgID}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
    expect(internal.status).toBe(404)

    const portMedia = await fetch(`${api}/v1/me/master/portfolio`, { headers: { Authorization: `Bearer ${owner.access_token}` } })
    const portBody = await portMedia.json() as { items?: Array<{ id: string; media_id?: string }> }
    const mediaId = portBody.items?.find((it) => it.media_id)?.media_id
    if (mediaId) {
      const stolenMediaDel = await fetch(`${api}/v1/media/${mediaId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${stranger.access_token}` },
      })
      expect([403, 404]).toContain(stolenMediaDel.status)
      const clientMediaDel = await fetch(`${api}/v1/media/${mediaId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${client.access_token}` },
      })
      expect([403, 404]).toContain(clientMediaDel.status)
    }

    const invites = await fetch(`${api}/v1/organizations/${orgID}/invites`, {
      headers: { Authorization: `Bearer ${stranger.access_token}` },
    })
    expect(invites.status).toBe(403)
    const clientInvites = await fetch(`${api}/v1/organizations/${orgID}/invites`, {
      headers: { Authorization: `Bearer ${client.access_token}` },
    })
    expect(clientInvites.status).toBe(403)
    const supplierInvites = await fetch(`${api}/v1/organizations/${orgID}/invites`, {
      headers: { Authorization: `Bearer ${supplier.access_token}` },
    })
    expect(supplierInvites.status).toBe(403)

    const kb = await fetch(`${api}/v1/knowledge?limit=5`, { headers: { Authorization: `Bearer ${owner.access_token}` } })
    if (kb.ok) {
      const articles = await kb.json() as { items?: Array<{ id: string }> }
      const articleId = articles.items?.[0]?.id
      if (articleId) {
        const stolenKb = await fetch(`${api}/v1/knowledge/${articleId}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${client.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'взлом', content: 'взлом' }),
        })
        expect([403, 404]).toContain(stolenKb.status)
        const strangerKb = await fetch(`${api}/v1/knowledge/${articleId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${stranger.access_token}` },
        })
        expect([403, 404, 405]).toContain(strangerKb.status)
        const stealPublish = await fetch(`${api}/v1/knowledge/${articleId}/unpublish`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${client.access_token}` },
        })
        expect([403, 404]).toContain(stealPublish.status)
      }
    }

    const orders = await fetch(`${api}/v1/commerce/supplier-orders`, {
      headers: { Authorization: `Bearer ${owner.access_token}` },
    })
    if (orders.ok) {
      const orderList = await orders.json() as { items?: Array<{ id: string }> }
      const orderId = orderList.items?.[0]?.id
      if (orderId) {
        const stolenOrder = await fetch(`${api}/v1/commerce/supplier-orders/${orderId}`, {
          headers: { Authorization: `Bearer ${client.access_token}` },
        })
        expect([403, 404]).toContain(stolenOrder.status)
        const strangerOrder = await fetch(`${api}/v1/commerce/supplier-orders/${orderId}`, {
          headers: { Authorization: `Bearer ${stranger.access_token}` },
        })
        expect([403, 404]).toContain(strangerOrder.status)
      }
    }

    const shopOrders = await fetch(`${api}/v1/commerce/shop/orders`, {
      headers: { Authorization: `Bearer ${owner.access_token}` },
    })
    if (shopOrders.ok) {
      const shopList = await shopOrders.json() as { items?: Array<{ id: string }> }
      const shopId = shopList.items?.[0]?.id
      if (shopId) {
        const stolenShop = await fetch(`${api}/v1/commerce/shop/orders/${shopId}`, {
          headers: { Authorization: `Bearer ${client.access_token}` },
        })
        expect([403, 404]).toContain(stolenShop.status)
      }
    }
  })
})
