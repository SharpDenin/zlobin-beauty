import { test, expect, type Page } from '@playwright/test'

const api = process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8090'

async function dismissPwa(page: Page) {
  const later = page.getByRole('button', { name: /Позже|Закрыть/i })
  if (await later.first().isVisible({ timeout: 1500 }).catch(() => false)) {
    await later.first().click().catch(() => undefined)
  }
}

async function fillContacts(page: Page, name: string, email: string) {
  await page.getByLabel('Имя').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('Password123!')
  await page.getByRole('button', { name: 'Далее' }).click()
}

async function pickRole(page: Page, role: 'Клиент' | 'Мастер') {
  await expect(page.getByText('Кто вы?')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('radio', { name: role }).check()
  await page.getByRole('button', { name: 'Далее' }).click()
}

async function pickMasterFormats(page: Page) {
  await expect(page.getByTestId('work-format-picker')).toBeVisible({ timeout: 15_000 })
  // ProfessionTypePicker checkboxes are outside the work-format fieldset.
  const profession = page.getByRole('checkbox', { name: 'Барбер' })
  await expect(profession).toBeVisible({ timeout: 15_000 })
  await profession.check()
  const format = page.getByTestId('work-format-picker').getByRole('checkbox').first()
  if (!(await format.isChecked())) await format.check()
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page.getByRole('heading', { name: 'Салон' })).toBeVisible({ timeout: 15_000 })
}

async function enableCreateSalon(page: Page) {
  // Custom switch track intercepts native checkbox clicks — click the label text.
  await page.locator('label[for="create_salon"]').click()
  await expect(page.getByTestId('create-salon-form')).toBeVisible({ timeout: 5_000 })
}

test.describe('ORG/REG registration flows A–C', () => {
  test('A: master without salon reaches master cabinet', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const suffix = Date.now()
    await page.goto('/register')
    await dismissPwa(page)
    await fillContacts(page, `E2E Master A ${suffix}`, `e2e.reg.a.${suffix}@example.com`)
    await pickRole(page, 'Мастер')
    await pickMasterFormats(page)
    await page.getByRole('button', { name: 'Завершить' }).click()
    await expect(page).toHaveURL(/\/master/, { timeout: 30_000 })
    await dismissPwa(page)
    // On phone the mode switch lives in the drawer; master route + profile form = master access.
    await expect(page.getByRole('heading', { name: /Профиль мастера/i }).first()).toBeVisible({ timeout: 15_000 })
    const rolesA = await page.evaluate(() => {
      try {
        return (JSON.parse(localStorage.getItem('zb.auth') || '{}') as { user?: { roles?: string[] } }).user?.roles ?? []
      } catch {
        return []
      }
    })
    expect(rolesA).toContain('master')
  })

  test('B: master creates salon and keeps master mode', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const suffix = Date.now()
    await page.goto('/register')
    await dismissPwa(page)
    await fillContacts(page, `E2E Master B ${suffix}`, `e2e.reg.b.${suffix}@example.com`)
    await pickRole(page, 'Мастер')
    await pickMasterFormats(page)
    await enableCreateSalon(page)
    await page.getByLabel(/Название салона/i).fill(`Салон B ${suffix}`)
    await page.getByLabel('Город').fill('Красноярск')
    await page.getByRole('button', { name: /Создать салон/i }).click()
    await expect(page).toHaveURL(/\/master/, { timeout: 30_000 })
    await dismissPwa(page)
    await expect(page.getByRole('heading', { name: /Профиль мастера/i }).first()).toBeVisible({ timeout: 15_000 })
    const rolesB = await page.evaluate(() => {
      try {
        return (JSON.parse(localStorage.getItem('zb.auth') || '{}') as { user?: { roles?: string[] } }).user?.roles ?? []
      } catch {
        return []
      }
    })
    expect(rolesB).toContain('master')
    await page.goto('/settings/salons')
    await dismissPwa(page)
    await expect(page.getByTestId('settings-salons')).toBeVisible()
    await expect(page.getByTestId('settings-salons').getByText(`Салон B ${suffix}`)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('settings-salons').getByText('Активный')).toBeVisible()
    await expect(page.getByTestId('settings-salons').getByText(/Без филиалов/)).toBeVisible()
  })

  test('C: client creates salon — owner without master mode', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const suffix = Date.now()
    await page.goto('/register')
    await dismissPwa(page)
    await fillContacts(page, `E2E Owner C ${suffix}`, `e2e.reg.c.${suffix}@example.com`)
    await pickRole(page, 'Клиент')
    await expect(page.getByRole('heading', { name: 'Салон' })).toBeVisible()
    await enableCreateSalon(page)
    await page.getByLabel(/Название салона/i).fill(`Салон C ${suffix}`)
    await page.getByLabel('Город').fill('Красноярск')
    await page.getByRole('button', { name: /Создать салон/i }).click()
    await expect(page).toHaveURL(/\/$|\/owner|\/dashboard/, { timeout: 30_000 })
    await dismissPwa(page)
    // Owner shell: InteractionModeSwitch is hidden when canUseMasterMode=false
    await expect(page.getByRole('radio', { name: 'Мастер' })).toHaveCount(0)
    await page.goto('/settings/salons')
    await dismissPwa(page)
    await expect(page.getByTestId('settings-salons').getByText(`Салон C ${suffix}`)).toBeVisible({ timeout: 15_000 })
    const token = await page.evaluate(() => {
      try {
        return (JSON.parse(localStorage.getItem('zb.auth') || '{}') as { accessToken?: string }).accessToken
      } catch {
        return null
      }
    })
    expect(token).toBeTruthy()
    const meMaster = await fetch(`${api}/v1/me/master`, { headers: { Authorization: `Bearer ${token}` } })
    expect([404, 400, 403]).toContain(meMaster.status)
  })
})

test.describe('ORG settings salons switch + responsive', () => {
  test('D: two salons switch persists selected org', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-390', 'once')
    const suffix = Date.now()
    const reg = await fetch(`${api}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `e2e.switch.${suffix}@example.com`,
        password: 'Password123!',
        display_name: `Switcher ${suffix}`,
        as_master: false,
      }),
    }).then((r) => r.json())
    const token = reg.access_token as string
    const org1 = await fetch(`${api}/v1/organizations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Switch One ${suffix}`, city: 'Красноярск', type: 'salon' }),
    }).then((r) => r.json())
    const org2 = await fetch(`${api}/v1/organizations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Switch Two ${suffix}`, city: 'Новосибирск', type: 'salon', branch_name: 'Центр', address_line: 'Ленина 1' }),
    }).then((r) => r.json())

    // Seed auth once; do not re-write sx.selectedOrg on every navigation/reload.
    await page.addInitScript((auth) => {
      if (!localStorage.getItem('zb.auth')) {
        localStorage.setItem('zb.auth', JSON.stringify({
          accessToken: auth.accessToken,
          refreshToken: auth.refreshToken,
          user: auth.user,
        }))
      }
    }, {
      accessToken: token,
      refreshToken: reg.refresh_token ?? 'r',
      user: reg.user,
    })

    await page.goto('/settings/salons')
    await dismissPwa(page)
    await page.evaluate((id) => localStorage.setItem('sx.selectedOrg', id), org1.organization.id)
    await page.reload()
    await dismissPwa(page)
    const salons = page.getByTestId('settings-salons')
    await expect(salons.getByText(`Switch One ${suffix}`)).toBeVisible({ timeout: 15_000 })
    await expect(salons.getByText(`Switch Two ${suffix}`)).toBeVisible()
    await salons.getByRole('button', { name: 'Выбрать' }).click()
    await expect.poll(async () => page.evaluate(() => localStorage.getItem('sx.selectedOrg'))).toBe(org2.organization.id)
    await page.reload()
    await dismissPwa(page)
    await expect.poll(async () => page.evaluate(() => localStorage.getItem('sx.selectedOrg'))).toBe(org2.organization.id)
    await expect(page.getByTestId('settings-salons').getByText(`Switch Two ${suffix}`)).toBeVisible()
    await expect(page.getByTestId('settings-salons').getByText('Активный')).toBeVisible()
  })

  for (const width of [360, 390, 768, 1024, 1440] as const) {
    test(`responsive register+salons @${width}`, async ({ page }, info) => {
      test.skip(info.project.name !== 'phone-390', 'viewport override once')
      await page.setViewportSize({ width, height: width >= 1024 ? 900 : 800 })
      await page.goto('/register')
      await dismissPwa(page)
      await expect(page.getByRole('heading', { name: 'Регистрация' })).toBeVisible()
      const overflowReg = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
      expect(overflowReg).toBe(false)
      await expect(page.getByRole('button', { name: 'Далее' })).toBeVisible()
      // walk to formats for master to check hints
      await fillContacts(page, `Resp ${width}`, `e2e.resp.${width}.${Date.now()}@example.com`)
      await pickRole(page, 'Мастер')
      await expect(page.getByTestId('work-format-picker')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(/принимаете клиентов|процент|территории клиента|кресло/i).first()).toBeVisible()
      const overflowFormats = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
      expect(overflowFormats).toBe(false)
      // Settings salons layout (logged-out redirects to login — check shell width only on register path above;
      // for authenticated salons page use a lightweight API session).
      const suffix = Date.now()
      const reg = await fetch(`${api}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `e2e.resp.salons.${width}.${suffix}@example.com`,
          password: 'Password123!',
          display_name: `Resp Salons ${width}`,
          as_master: false,
        }),
      }).then((r) => r.json())
      await page.evaluate((session) => {
        localStorage.setItem('zb.auth', JSON.stringify(session))
      }, { accessToken: reg.access_token, refreshToken: reg.refresh_token ?? 'r', user: reg.user })
      await page.goto('/settings/salons')
      await dismissPwa(page)
      await expect(page.getByTestId('settings-salons')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('settings-create-salon')).toBeVisible()
      const overflowSalons = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
      expect(overflowSalons).toBe(false)
      const ctaBox = await page.getByTestId('settings-create-salon').boundingBox()
      expect(ctaBox?.height ?? 0).toBeGreaterThanOrEqual(40)
    })
  }
})
