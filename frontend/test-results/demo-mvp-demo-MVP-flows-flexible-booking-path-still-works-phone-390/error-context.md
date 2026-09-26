# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: demo-mvp.spec.ts >> demo MVP flows >> flexible booking path still works
- Location: e2e\demo-mvp.spec.ts:69:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('button.slot:not(.empty)').first()
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for locator('button.slot:not(.empty)').first()

```

```yaml
- banner:
  - img "Salon-X"
  - text: Salon-X
  - button "Выйти"
- main:
  - img "Анна Волкова": АВ
  - heading "Анна Волкова Запись" [level=1]:
    - text: Анна Волкова
    - button "Запись": "?"
  - text: Красноярск Владелец точки
  - paragraph: Колорист, Парикмахер
  - paragraph: "Колорист с 7-летней практикой: сложный блонд, балаяж и бережное тонирование. Работаю в собственном ателье в центре Красноярска."
  - button "Написать"
  - heading "Работы" [level=2]
  - figure "Формула в работе":
    - img "Формула в работе": ФО
    - text: Формула в работе
  - figure "Уход после цвета":
    - img "Уход после цвета": УХ
    - text: Уход после цвета
  - figure "Сложный блонд":
    - img "Сложный блонд": СЛ
    - text: Сложный блонд
  - heading "Запись" [level=2]
  - text: Услуга Дата Время Итого
  - heading "Нет свободных окон" [level=2]
  - paragraph: Выберите другую дату.
  - button "—" [disabled]
  - button "Назад"
  - button "К подтверждению" [disabled]
  - heading "Отзывы" [level=2]
  - text: Пока нет опубликованных отзывов
- navigation "Основная навигация":
  - link "Главная":
    - /url: /
  - link "Мастера":
    - /url: /search
  - link "Магазин":
    - /url: /shop
  - link "Записи":
    - /url: /appointments
  - button "Ещё"
```

# Test source

```ts
  10  | async function apiHealthy(): Promise<boolean> {
  11  |   try {
  12  |     const res = await fetch(`${api}/healthz`, { signal: AbortSignal.timeout(4000) })
  13  |     return res.ok
  14  |   } catch {
  15  |     return false
  16  |   }
  17  | }
  18  | 
  19  | async function requireApi() {
  20  |   if (!(await apiHealthy())) {
  21  |     test.skip(true, `API unhealthy at ${api} — start docker stack to run these tests`)
  22  |   }
  23  | }
  24  | 
  25  | async function loginUI(page: Page, email: string) {
  26  |   await page.goto('/login')
  27  |   await page.getByLabel('Email').fill(email)
  28  |   await page.getByLabel('Пароль').fill(password)
  29  |   await page.getByRole('button', { name: 'Войти' }).click()
  30  |   await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  31  | }
  32  | 
  33  | async function apiLogin(email: string) {
  34  |   const res = await fetch(`${api}/v1/auth/login`, {
  35  |     method: 'POST',
  36  |     headers: { 'Content-Type': 'application/json' },
  37  |     body: JSON.stringify({ email, password }),
  38  |   })
  39  |   expect(res.ok, `login ${email} → ${res.status}`).toBeTruthy()
  40  |   return res.json() as Promise<{ access_token: string; user: { id: string } }>
  41  | }
  42  | 
  43  | test.describe('demo MVP flows', () => {
  44  |   test.beforeEach(async () => {
  45  |     await requireApi()
  46  |   })
  47  | 
  48  |   test('search defaults to Красноярск; other cities toggle shows Новосибирск master', async ({ page }, info) => {
  49  |     test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1920', 'two viewports')
  50  |     await loginUI(page, 'client1@demo.local')
  51  | 
  52  |     await page.goto('/search')
  53  |     await expect(page.getByRole('heading', { name: /Поиск/i })).toBeVisible({ timeout: 10_000 })
  54  | 
  55  |     const city = page.getByRole('textbox', { name: 'Город', exact: true })
  56  |     await expect(city).toHaveValue(/Красноярск/i)
  57  | 
  58  |     await page.getByRole('button', { name: /Искать|Найти/i }).click()
  59  |     await expect(page.locator('a.list-item').first()).toBeVisible({ timeout: 15_000 })
  60  |     await expect(page.getByText('Анна Волкова').first()).toBeVisible({ timeout: 10_000 })
  61  |     await expect(page.getByText('Иван Белов')).toHaveCount(0)
  62  | 
  63  |     await page.getByText('Показывать мастеров из других городов').click()
  64  |     await page.getByRole('button', { name: /Искать|Найти/i }).click()
  65  |     await expect(page.getByText('Иван Белов').first()).toBeVisible({ timeout: 15_000 })
  66  |     await expect(page.getByText('Новосибирск').first()).toBeVisible()
  67  |   })
  68  | 
  69  |   test('flexible booking path still works', async ({ page }, info) => {
  70  |     test.skip(info.project.name !== 'phone-390', 'once')
  71  |     await loginUI(page, 'client2@demo.local')
  72  | 
  73  |     await page.goto('/search')
  74  |     const city = page.getByRole('textbox', { name: 'Город', exact: true })
  75  |     if (await city.count()) {
  76  |       await city.fill('Красноярск')
  77  |     }
  78  |     await page.getByRole('button', { name: /Искать|Найти/i }).click()
  79  | 
  80  |     const anna = page.locator('a.list-item').filter({ hasText: /Анна/i }).first()
  81  |     await expect(anna).toBeVisible({ timeout: 15_000 })
  82  |     await anna.click()
  83  |     await expect(page.locator('main h1, .service-card').first()).toBeVisible({ timeout: 15_000 })
  84  | 
  85  |     const flexible = page.locator('.service-card').filter({ hasText: /Стрижка/i }).first()
  86  |     if (await flexible.count()) {
  87  |       await flexible.click()
  88  |     } else {
  89  |       const anyFlexible = page.locator('.service-card').filter({ hasNotText: /Фиксированное окно/i }).first()
  90  |       await expect(anyFlexible).toBeVisible({ timeout: 10_000 })
  91  |       await anyFlexible.click()
  92  |     }
  93  | 
  94  |     const next = page.getByRole('button', { name: /Далее/i })
  95  |     if (await next.count()) await next.first().click()
  96  | 
  97  |     const dateInput = page.locator('input[type="date"]').first()
  98  |     await expect(dateInput).toBeVisible({ timeout: 10_000 })
  99  |     const d = new Date()
  100 |     for (let i = 1; i <= 14; i++) {
  101 |       const cand = new Date(d.getTime() + i * 86400000)
  102 |       if (cand.getDay() === 0 || cand.getDay() === 6) continue
  103 |       await dateInput.fill(cand.toISOString().slice(0, 10))
  104 |       break
  105 |     }
  106 |     const toTime = page.getByRole('button', { name: /К времени|Далее/i })
  107 |     if (await toTime.count()) await toTime.first().click()
  108 | 
  109 |     const slot = page.locator('button.slot:not(.empty)').first()
> 110 |     await expect(slot).toBeVisible({ timeout: 15_000 })
      |                        ^ Error: expect(locator).toBeVisible() failed
  111 |     await slot.click()
  112 |     const toConfirm = page.getByRole('button', { name: /К подтверждению|Далее/i })
  113 |     if (await toConfirm.count()) await toConfirm.first().click()
  114 | 
  115 |     const confirm = page.getByRole('button', { name: /Записаться|Подтвердить|Отправить|Создать запись/i })
  116 |     await expect(confirm.first()).toBeVisible({ timeout: 10_000 })
  117 |     await confirm.first().click()
  118 |     await expect(page.getByText(/создан|ожида|подтвержд|успешн/i).first()).toBeVisible({ timeout: 15_000 })
  119 |   })
  120 | 
  121 |   test('fixed occurrence UI elements when available', async ({ page }, info) => {
  122 |     test.skip(info.project.name !== 'phone-390', 'once')
  123 |     await loginUI(page, 'client1@demo.local')
  124 | 
  125 |     await page.goto('/search')
  126 |     await page.getByRole('button', { name: /Искать|Найти/i }).click()
  127 |     const anna = page.locator('a.list-item').filter({ hasText: /Анна/i }).first()
  128 |     await expect(anna).toBeVisible({ timeout: 15_000 })
  129 |     await anna.click()
  130 | 
  131 |     const fixedCard = page.locator('.service-card').filter({ hasText: /Фиксированное окно|мастер-класс/i }).first()
  132 |     await expect(fixedCard).toBeVisible({ timeout: 15_000 })
  133 |     await fixedCard.click()
  134 |     const next = page.getByRole('button', { name: /Далее/i })
  135 |     if (await next.count()) await next.first().click()
  136 | 
  137 |     const occurrence = page.locator('.occurrence-card').first()
  138 |     await expect(occurrence).toBeVisible({ timeout: 15_000 })
  139 |     await expect(page.getByText(/мест:/i).first()).toBeVisible()
  140 |     await occurrence.click()
  141 |     await expect(occurrence).toHaveClass(/selected/)
  142 |   })
  143 | 
  144 |   test('cosmetics checkout has pickup branch selection (no UUID)', async ({ page }, info) => {
  145 |     test.skip(info.project.name !== 'phone-390', 'once')
  146 |     await loginUI(page, 'master1@demo.local')
  147 | 
  148 |     await page.goto('/cosmetics')
  149 |     await expect(page.getByRole('heading', { name: /Косметика|Поставщик/i })).toBeVisible({ timeout: 10_000 })
  150 |     await expect(page.getByText(/UUID|supplier_org_id|xxxxxxxx-xxxx/i)).toHaveCount(0)
  151 | 
  152 |     const supplier = page.locator('a.list-item, a.card, .cards-grid a').filter({ hasText: /Поставщик|Профи|Бьюти/i }).first()
  153 |     await expect(supplier).toBeVisible({ timeout: 15_000 })
  154 |     await supplier.click()
  155 | 
  156 |     const addBtn = page.getByRole('button', { name: /В корзину|Добавить/i }).first()
  157 |     await expect(addBtn).toBeVisible({ timeout: 15_000 })
  158 |     await addBtn.click()
  159 | 
  160 |     const openCart = page.getByRole('button', { name: /Корзина|Оформить|Заказ/i }).first()
  161 |     if (await openCart.count()) await openCart.click()
  162 | 
  163 |     await expect(page.getByRole('heading', { name: /Филиал получения/i })).toBeVisible({ timeout: 15_000 })
  164 |     await expect(page.getByLabel(/Поиск филиала/i)).toBeVisible()
  165 |     await expect(page.getByText(/UUID|xxxxxxxx-xxxx/i)).toHaveCount(0)
  166 |     const branchCard = page.locator('.branch-select-card, button.list-item').filter({ hasText: /Красноярск|центр|север|Москва|склад/i }).first()
  167 |     await expect(branchCard).toBeVisible({ timeout: 10_000 })
  168 |     await branchCard.click()
  169 |     await expect(page.getByText(/Выбран|Получение:/i).first()).toBeVisible()
  170 |   })
  171 | 
  172 |   test('knowledge article page renders', async ({ page }, info) => {
  173 |     test.skip(info.project.name !== 'phone-390', 'once')
  174 |     await loginUI(page, 'master1@demo.local')
  175 | 
  176 |     await page.goto('/knowledge')
  177 |     await expect(page.getByRole('heading', { name: /База|знани/i })).toBeVisible({ timeout: 10_000 })
  178 | 
  179 |     const articleLink = page.locator('a[href^="/knowledge/"]').first()
  180 |     await expect(articleLink).toBeVisible({ timeout: 15_000 })
  181 |     await articleLink.click()
  182 |     await expect(page).toHaveURL(/\/knowledge\/[^/]+/, { timeout: 10_000 })
  183 |     await expect(page.locator('main h1')).toBeVisible({ timeout: 10_000 })
  184 |     await expect(page.locator('main')).not.toContainText(/Статья не найдена/)
  185 |     await expect(page.locator('main .card, main .ProseMirror, main article, main section').first()).toBeVisible()
  186 |   })
  187 | 
  188 |   test('suppliers list has no UUID field for masters', async ({ page }, info) => {
  189 |     test.skip(info.project.name !== 'phone-390', 'once')
  190 |     await loginUI(page, 'master1@demo.local')
  191 |     await page.goto('/cosmetics')
  192 |     await expect(page.getByRole('heading', { name: /Косметика|Поставщик/i })).toBeVisible({ timeout: 10_000 })
  193 |     await expect(page.getByText(/UUID|supplier_org_id|xxxxxxxx-xxxx/i)).toHaveCount(0)
  194 |     await expect(page.locator('main')).toBeVisible()
  195 |   })
  196 | 
  197 |   test('supplier products page usable', async ({ page }, info) => {
  198 |     test.skip(info.project.name !== 'desktop-1920', 'once')
  199 |     await loginUI(page, 'supplier1@demo.local')
  200 |     await page.goto('/supplier/products')
  201 |     await expect(page.getByRole('heading', { name: /Товар/i })).toBeVisible({ timeout: 10_000 })
  202 |     await expect(page.getByText(/UUID организации/i)).toHaveCount(0)
  203 |   })
  204 | 
  205 |   test('API suppliers published after seed', async () => {
  206 |     const auth = await apiLogin('master1@demo.local')
  207 |     const res = await fetch(`${api}/v1/suppliers`, {
  208 |       headers: { Authorization: `Bearer ${auth.access_token}` },
  209 |     })
  210 |     expect(res.ok).toBeTruthy()
```