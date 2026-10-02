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
  })
})
