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
  const body = await res.json()
  expect(res.ok, `login ${email}`).toBeTruthy()
  return body as { access_token: string; user: { id: string } }
}

async function loginUI(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

test.describe('master specializations picker', () => {
  test.beforeEach(async () => {
    if (!(await apiHealthy())) test.skip(true, `API unhealthy at ${api}`)
  })

  test('cabinet multi-select saves specializations (phone + desktop)', async ({ page }, info) => {
    test.skip(
      info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280',
      'phone-390 and desktop-1280',
    )

    const master = await apiLogin('master1@demo.local')
    const me = await fetch(`${api}/v1/me/master`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    const meText = await me.text()
    expect(me.ok, meText).toBeTruthy()
    const profile = JSON.parse(meText) as {
      master: {
        id: string
        user_id?: string
        display_name: string
        city: string
        bio: string
        specializations: string[]
        experience_years: number
        education?: string
        work_type?: string
        work_types?: string[]
        published: boolean
        organization_id?: string
        branch_id?: string | null
        profession_types?: Array<{ id: string; slug: string }>
        photo_media_id?: string | null
      }
    }
    const types = profile.master.profession_types ?? []
    expect(types.length, 'master1 needs profession types').toBeGreaterThan(0)

    await loginUI(page, 'master1@demo.local')
    await page.goto('/master')
    await expect(page.getByTestId('specialization-picker')).toBeVisible({ timeout: 15_000 })

    // Ensure draft fields satisfy basic validation before save.
    await page.getByLabel('Имя в поиске').fill(profile.master.display_name || 'Мастер Demo')
    await page.getByLabel('Город').fill(profile.master.city || 'Красноярск')
    const bio = page.getByLabel('О себе')
    if ((await bio.inputValue()).trim().length < 10) {
      await bio.fill('Профессиональный мастер салона красоты для E2E.')
    }

    await page.getByTestId('specialization-picker-trigger').click()
    const menu = page.getByTestId('specialization-picker-menu')
    await expect(menu).toBeVisible()
    const option = menu.locator('[role="option"][aria-selected="false"] button').first()
    await expect(option).toBeVisible()
    const optionTestId = await option.getAttribute('data-testid')
    expect(optionTestId?.startsWith('spec-option-')).toBeTruthy()
    const optionLabel = optionTestId!.slice('spec-option-'.length)
    await option.click()
    await expect(page.getByTestId(`spec-chip-${optionLabel}`)).toBeVisible()

    // Close menu by clicking outside
    await page.getByLabel('Имя в поиске').click()
    await expect(menu).toHaveCount(0)

    const saveResp = page.waitForResponse(
      (r) => r.url().includes('/v1/me/master') && r.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: 'Сохранить профиль' }).click()
    const saved = await saveResp
    expect(saved.ok(), await saved.text()).toBeTruthy()
    await expect(page.getByText(/Профиль мастера сохранён|сохранено/i).first()).toBeVisible({
      timeout: 10_000,
    })

    const after = await fetch(`${api}/v1/me/master`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    const afterBody = await after.json()
    expect(after.ok).toBeTruthy()
    const specs = (afterBody as { master: { specializations: string[] } }).master.specializations ?? []
    expect(specs).toContain(optionLabel)

    await page.goto(`/masters/${profile.master.id}`)
    await expect(page.getByTestId('master-public-specializations')).toContainText(optionLabel, {
      timeout: 15_000,
    })
  })

  test('backend rejects specialization outside selected profession catalog', async ({}, info) => {
    test.skip(info.project.name !== 'phone-390', 'API once')
    const master = await apiLogin('master1@demo.local')
    const me = await fetch(`${api}/v1/me/master`, {
      headers: { Authorization: `Bearer ${master.access_token}` },
    })
    const body = await me.json() as {
      master: {
        display_name: string
        city: string
        bio: string
        experience_years: number
        education?: string
        work_type?: string
        work_types?: string[]
        published: boolean
        organization_id?: string
        branch_id?: string | null
        photo_media_id?: string | null
        profession_types?: Array<{ id: string }>
        specializations?: string[]
      }
    }
    const m = body.master
    const typeIds = (m.profession_types ?? []).map((t) => t.id)
    expect(typeIds.length).toBeGreaterThan(0)

    const put = await fetch(`${api}/v1/me/master`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${master.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        organization_id: m.organization_id,
        branch_id: m.branch_id,
        display_name: m.display_name,
        city: m.city || 'Красноярск',
        bio: m.bio || 'Профессиональный мастер салона красоты',
        experience_years: m.experience_years || 1,
        education: m.education ?? '',
        work_type: m.work_type || 'private_practice',
        work_types: m.work_types?.length ? m.work_types : ['private_practice'],
        profession_type_ids: typeIds,
        published: false,
        photo_media_id: m.photo_media_id,
        specializations: ['НесуществующаяСпециализацияXYZ'],
      }),
    })
    expect(put.status).toBe(400)
  })
})
