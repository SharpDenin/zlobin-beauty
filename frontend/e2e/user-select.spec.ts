import { test, expect, type Page } from '@playwright/test'

async function loginUI(page: Page, email: string) {
  const password = process.env.SEED_PASSWORD ?? 'Password123!'
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

async function computedUserSelect(page: Page, locator: ReturnType<Page['locator']>) {
  return locator.first().evaluate((el) => {
    const style = getComputedStyle(el)
    return (style.userSelect || '').toLowerCase()
  })
}

async function selectAllValue(locator: ReturnType<Page['locator']>) {
  return locator.first().evaluate((el) => {
    const input = el as HTMLInputElement
    input.focus()
    input.setSelectionRange(0, input.value.length)
    return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)
  })
}

test.describe('PWA user-select policy', () => {
  test('login chrome is non-selectable; email/password stay selectable', async ({ page }, info) => {
    test.skip(!['phone-390', 'laptop-1366'].includes(info.project.name), 'mobile + desktop')
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible({ timeout: 15_000 })

    const heading = page.getByRole('heading', { name: 'Вход' })
    const submit = page.getByRole('button', { name: 'Войти' })
    const email = page.locator('#email')
    const password = page.locator('#password')

    expect(await computedUserSelect(page, heading)).toMatch(/none/)
    expect(await computedUserSelect(page, submit)).toMatch(/none/)
    expect(await computedUserSelect(page, email)).toMatch(/text|auto|all/)
    expect(await computedUserSelect(page, password)).toMatch(/text|auto|all/)

    // type=email does not support setSelectionRange in Chromium; password does.
    await password.fill('Password123!')
    expect(await selectAllValue(password)).toBe('Password123!')
  })

  test('authenticated nav stays non-selectable; search fields stay editable', async ({ page }, info) => {
    test.skip(!['phone-390', 'laptop-1366'].includes(info.project.name), 'mobile + desktop')
    await loginUI(page, 'client1@demo.local')
    await page.goto('/search')
    await expect(page.getByRole('heading', { name: /Поиск мастера/i })).toBeVisible({ timeout: 15_000 })

    const heading = page.getByRole('heading', { name: /Поиск мастера/i })
    const searchBtn = page.getByRole('button', { name: 'Искать' })
    const city = page.locator('#city')
    const q = page.locator('#q')

    expect(await computedUserSelect(page, heading)).toMatch(/none/)
    expect(await computedUserSelect(page, searchBtn)).toMatch(/none/)
    expect(await computedUserSelect(page, city)).toMatch(/text|auto|all/)
    expect(await computedUserSelect(page, q)).toMatch(/text|auto|all/)

    await city.fill('Красноярск')
    expect(await selectAllValue(city)).toBe('Красноярск')
  })
})
