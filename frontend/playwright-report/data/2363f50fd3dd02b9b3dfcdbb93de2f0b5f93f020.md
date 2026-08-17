# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: salon-x.spec.ts >> Salon-X P0 flows (seeded stack) >> chain calendar branch switcher is present
- Location: e2e\salon-x.spec.ts:368:3

# Error details

```
Error: expect(locator).toBeAttached() failed

Locator: getByRole('option', { name: 'Новосибирск' })
Expected: attached
Error: strict mode violation: getByRole('option', { name: 'Новосибирск' }) resolved to 2 elements:
    1) <option value="01a01083-5ca3-79ca-94a6-7fc33560aaeb">Новосибирск</option> aka getByTestId('calendar-branch-switcher')
    2) <option value="01a01136-f444-7c24-9fa4-da7ec80a3e46">Новосибирск</option> aka getByTestId('calendar-branch-switcher')

Call log:
  - Expect "toBeAttached" with timeout 5000ms
  - waiting for getByRole('option', { name: 'Новосибирск' })

```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - generic [ref=f1e4]:
    - banner [ref=f1e5]:
      - generic [ref=f1e6]:
        - generic [ref=f1e7]: Salon-X
        - generic [ref=f1e8]: Кабинет владельца сети
      - button "Выйти" [ref=f1e10] [cursor=pointer]
    - main [ref=f1e11]:
      - generic [ref=f1e12]:
        - generic [ref=f1e13]:
          - generic [ref=f1e14]:
            - paragraph [ref=f1e15]: Расписание
            - heading "Календарь салона" [level=1] [ref=f1e16]
            - paragraph [ref=f1e17]:
              - text: "Часовой пояс: Asia/Krasnoyarsk. Переносите события мышкой — при конфликте изменение отменится."
              - button "Работа с расписанием" [ref=f1e19] [cursor=pointer]: "?"
          - generic [ref=f1e20]:
            - link "Рабочие часы" [ref=f1e21] [cursor=pointer]:
              - /url: /master
            - button "+ Событие" [ref=f1e22] [cursor=pointer]
        - generic [ref=f1e23]:
          - generic [ref=f1e24]:
            - generic [ref=f1e25]: Мастер
            - combobox [ref=f1e26]:
              - option "Все мастера" [selected]
              - option "Сеть Salon-X"
          - generic [ref=f1e27]:
            - generic [ref=f1e28]: Филиал
            - combobox [ref=f1e29]:
              - option "Все филиалы" [selected]
              - option "Красноярск"
              - option "Новосибирск"
              - option "Новосибирск"
        - generic [ref=f1e30]:
          - generic "Режим календаря" [ref=f1e31]:
            - button "День" [ref=f1e32] [cursor=pointer]
            - button "Неделя" [ref=f1e33] [cursor=pointer]
            - button "Месяц" [ref=f1e34] [cursor=pointer]
            - button "Список" [ref=f1e35] [cursor=pointer]
          - button "Цвета и категории" [ref=f1e36] [cursor=pointer]
        - generic [ref=f1e37]:
          - button "✦ Запись клиента" [ref=f1e38] [cursor=pointer]:
            - generic [ref=f1e39]: ✦
            - text: Запись клиента
          - button "✓ Задача" [ref=f1e40] [cursor=pointer]:
            - generic [ref=f1e41]: ✓
            - text: Задача
          - button "◆ Операционное" [ref=f1e42] [cursor=pointer]:
            - generic [ref=f1e43]: ◆
            - text: Операционное
          - button "◎ Сотрудники" [ref=f1e44] [cursor=pointer]:
            - generic [ref=f1e45]: ◎
            - text: Сотрудники
        - generic [ref=f1e47]:
          - generic [ref=f1e48]:
            - generic [ref=f1e49]:
              - generic [ref=f1e50]:
                - button "Пред" [ref=f1e51] [cursor=pointer]:
                  - img [ref=f1e52]: 
                - button "След" [ref=f1e53] [cursor=pointer]:
                  - img [ref=f1e54]: 
              - button "Сегодня" [disabled] [ref=f1e55] [cursor=pointer]
            - heading "18 августа 2026 г." [level=2] [ref=f1e57]
          - generic "18 августа 2026 г." [ref=f1e58]:
            - grid [ref=f1e60]:
              - rowgroup [ref=f1e61]:
                - row [ref=f1e66]:
                  - columnheader "вторник" [ref=f1e67]
              - rowgroup [ref=f1e70]:
                - generic [ref=f1e73]:
                  - table [ref=f1e75]:
                    - rowgroup [ref=f1e78]:
                      - row [ref=f1e79]:
                        - cell [ref=f1e80]:
                          - generic [ref=f1e81]: "10"
                        - cell [ref=f1e83]
                      - row [ref=f1e84]:
                        - cell [ref=f1e85]
                        - cell [ref=f1e86]
                      - row [ref=f1e87]:
                        - cell [ref=f1e88]:
                          - generic [ref=f1e89]: "11"
                        - cell [ref=f1e91]
                      - row [ref=f1e92]:
                        - cell [ref=f1e93]
                        - cell [ref=f1e94]
                      - row [ref=f1e95]:
                        - cell [ref=f1e96]:
                          - generic [ref=f1e97]: "12"
                        - cell [ref=f1e99]
                      - row [ref=f1e100]:
                        - cell [ref=f1e101]
                        - cell [ref=f1e102]
                      - row [ref=f1e103]:
                        - cell [ref=f1e104]:
                          - generic [ref=f1e105]: "13"
                        - cell [ref=f1e107]
                      - row [ref=f1e108]:
                        - cell [ref=f1e109]
                        - cell [ref=f1e110]
                      - row [ref=f1e111]:
                        - cell [ref=f1e112]:
                          - generic [ref=f1e113]: "14"
                        - cell [ref=f1e115]
                      - row [ref=f1e116]:
                        - cell [ref=f1e117]
                        - cell [ref=f1e118]
                      - row [ref=f1e119]:
                        - cell [ref=f1e120]:
                          - generic [ref=f1e121]: "15"
                        - cell [ref=f1e123]
                      - row [ref=f1e124]:
                        - cell [ref=f1e125]
                        - cell [ref=f1e126]
                      - row [ref=f1e127]:
                        - cell [ref=f1e128]:
                          - generic [ref=f1e129]: "16"
                        - cell [ref=f1e131]
                      - row [ref=f1e132]:
                        - cell [ref=f1e133]
                        - cell [ref=f1e134]
                      - row [ref=f1e135]:
                        - cell [ref=f1e136]:
                          - generic [ref=f1e137]: "17"
                        - cell [ref=f1e139]
                      - row [ref=f1e140]:
                        - cell [ref=f1e141]
                        - cell [ref=f1e142]
                      - row [ref=f1e143]:
                        - cell [ref=f1e144]:
                          - generic [ref=f1e145]: "18"
                        - cell [ref=f1e147]
                      - row [ref=f1e148]:
                        - cell [ref=f1e149]
                        - cell [ref=f1e150]
                  - row [ref=f1e154]:
                    - gridcell [ref=f1e157]
  - navigation "Основная навигация" [ref=f1e160]:
    - link "Сегодня" [ref=f1e161] [cursor=pointer]:
      - /url: /
    - link "Календарь" [ref=f1e162] [cursor=pointer]:
      - /url: /calendar
    - link "Записи" [ref=f1e163] [cursor=pointer]:
      - /url: /appointments
    - button "Ещё" [ref=f1e164] [cursor=pointer]
```

# Test source

```ts
  273 |     const start = new Date(Date.UTC(2026, 11, 15, 4, 0, 0))
  274 |     const end = new Date(Date.UTC(2026, 11, 15, 5, 0, 0))
  275 |     const payload = {
  276 |       title: 'E2E lunch occupancy',
  277 |       category: 'break',
  278 |       starts_at: start.toISOString(),
  279 |       ends_at: end.toISOString(),
  280 |       timezone: 'Asia/Krasnoyarsk',
  281 |     }
  282 |     const create = await fetch(`${api}/v1/planner/blocks`, {
  283 |       method: 'POST',
  284 |       headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
  285 |       body: JSON.stringify(payload),
  286 |     })
  287 |     const created = await create.json() as { id?: string }
  288 |     expect(create.status, JSON.stringify(created)).toBeLessThan(300)
  289 |     expect(created.id).toBeTruthy()
  290 |     const overlap = await fetch(`${api}/v1/planner/blocks`, {
  291 |       method: 'POST',
  292 |       headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
  293 |       body: JSON.stringify({ ...payload, title: 'E2E overlap', category: 'personal' }),
  294 |     })
  295 |     expect(overlap.status).toBe(409)
  296 |     const del = await fetch(`${api}/v1/planner/blocks/${created.id}`, {
  297 |       method: 'DELETE',
  298 |       headers: { Authorization: `Bearer ${master.access_token}` },
  299 |     })
  300 |     expect(del.status).toBe(204)
  301 |   })
  302 | 
  303 |   test('salon admin lands on operational dashboard and can open staff', async ({ page }, info) => {
  304 |     test.skip(info.project.name !== 'phone-390', 'once')
  305 |     await loginUI(page, 'admin1@demo.local')
  306 |     await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible({ timeout: 15_000 })
  307 |     await expect(page.getByRole('link', { name: 'Найти мастера' })).toHaveCount(0)
  308 |     await page.goto('/staff')
  309 |     await expect(page.getByRole('heading', { name: /Команда/ })).toBeVisible({ timeout: 15_000 })
  310 |     await expect(page.getByText('только мастерам')).toHaveCount(0)
  311 |   })
  312 | 
  313 |   test('dashboard widget toggle survives reload', async ({ page }, info) => {
  314 |     test.skip(info.project.name !== 'phone-390', 'once')
  315 |     await loginUI(page, 'master1@demo.local')
  316 |     await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible({ timeout: 15_000 })
  317 |     await page.getByRole('button', { name: 'Настроить' }).click()
  318 |     const messages = page.locator('.dashboard-setting-row').filter({ hasText: 'Сообщения' }).locator('input[type="checkbox"]')
  319 |     await expect(messages).toBeVisible()
  320 |     if (await messages.isChecked()) await messages.uncheck()
  321 |     await page.getByRole('button', { name: 'Готово' }).click()
  322 |     await page.reload()
  323 |     await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible({ timeout: 15_000 })
  324 |     await expect(page.locator('.widget-drag-handle', { hasText: 'Сообщения' })).toHaveCount(0)
  325 |   })
  326 | 
  327 |   test('calendar planner block is clickable and editable', async ({ page }, info) => {
  328 |     test.skip(info.project.name !== 'phone-390', 'once')
  329 |     const master = await apiLogin('master1@demo.local')
  330 |     const from = new Date(Date.UTC(2026, 7, 17)).toISOString()
  331 |     const to = new Date(Date.UTC(2026, 8, 1)).toISOString()
  332 |     const listed = await fetch(`${api}/v1/planner/blocks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
  333 |       headers: { Authorization: `Bearer ${master.access_token}` },
  334 |     })
  335 |     const listedBody = await listed.json() as { items?: Array<{ id: string; title: string }> }
  336 |     let block = listedBody.items?.find((b) => b.title === 'E2E блок планера')
  337 |     if (!block) {
  338 |       const start = new Date(Date.UTC(2026, 7, 19, 3, 30, 0))
  339 |       const end = new Date(Date.UTC(2026, 7, 19, 4, 30, 0))
  340 |       const create = await fetch(`${api}/v1/planner/blocks`, {
  341 |         method: 'POST',
  342 |         headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
  343 |         body: JSON.stringify({
  344 |           title: 'E2E блок планера',
  345 |           category: 'task',
  346 |           starts_at: start.toISOString(),
  347 |           ends_at: end.toISOString(),
  348 |           timezone: 'Asia/Krasnoyarsk',
  349 |         }),
  350 |       })
  351 |       const created = await create.json() as { id?: string }
  352 |       expect(create.status, JSON.stringify(created)).toBeLessThan(300)
  353 |       block = { id: created.id!, title: 'E2E блок планера' }
  354 |     }
  355 |     await loginUI(page, 'master1@demo.local')
  356 |     await page.goto('/calendar')
  357 |     await expect(page.getByRole('button', { name: 'Неделя' })).toBeVisible({ timeout: 15_000 })
  358 |     await page.getByRole('button', { name: 'Список' }).click()
  359 |     const row = page.locator('.fc-list-event').filter({ hasText: 'E2E блок планера' }).first()
  360 |     await expect(row).toBeVisible({ timeout: 15_000 })
  361 |     await row.scrollIntoViewIfNeeded()
  362 |     await row.click({ force: true })
  363 |     await expect(page.getByRole('heading', { name: 'Событие планера' })).toBeVisible({ timeout: 10_000 })
  364 |     await page.getByRole('button', { name: 'Удалить событие' }).click()
  365 |     await expect(page.getByText('Событие удалено')).toBeVisible()
  366 |   })
  367 | 
  368 |   test('chain calendar branch switcher is present', async ({ page }, info) => {
  369 |     test.skip(info.project.name !== 'phone-390', 'once')
  370 |     await loginUI(page, 'chain1@demo.local')
  371 |     await page.goto('/calendar')
  372 |     await expect(page.getByTestId('calendar-branch-switcher')).toBeVisible({ timeout: 15_000 })
> 373 |     await expect(page.getByRole('option', { name: 'Новосибирск' })).toBeAttached()
      |                                                                     ^ Error: expect(locator).toBeAttached() failed
  374 |     await page.getByTestId('calendar-branch-switcher').selectOption({ label: 'Новосибирск' })
  375 |     await expect(page.getByText(/Asia\/Novosibirsk/)).toBeVisible()
  376 |   })
  377 | 
  378 |   test('phase2 supplier dashboard analytics team and assign task', async ({ page }, info) => {
  379 |     test.skip(!['phone-390', 'phone-430', 'tablet-768', 'laptop-1366', 'desktop-1920'].includes(info.project.name), 'phase2 viewports')
  380 |     await loginUI(page, 'supplier1@demo.local')
  381 |     await expect(page).toHaveURL(/\/supplier/, { timeout: 20_000 })
  382 |     await expect(page.getByText('Выручка сегодня').first()).toBeVisible({ timeout: 15_000 })
  383 |     await expect(page.getByText('Ожидает оплаты').first()).toBeVisible()
  384 |     await test.info().attach(`supplier-dashboard-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  385 | 
  386 |     await page.goto('/supplier/analytics')
  387 |     await expect(page.getByRole('heading', { name: 'Аналитика' })).toBeVisible({ timeout: 15_000 })
  388 |     await page.getByRole('button', { name: 'Неделя' }).click()
  389 |     await expect(page.getByText('Динамика выручки')).toBeVisible()
  390 |     await expect(page.locator('.recharts-surface').first()).toBeVisible({ timeout: 15_000 })
  391 |     if (info.project.name === 'laptop-1366') {
  392 |       await test.info().attach('supplier-analytics-desktop', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  393 |     }
  394 | 
  395 |     await page.goto('/supplier/team')
  396 |     await expect(page.getByRole('heading', { name: 'Представители' })).toBeVisible({ timeout: 15_000 })
  397 |     await expect(page.getByText(/Елена/).first()).toBeVisible()
  398 |     await expect(page.getByText(/Павел/).first()).toBeVisible()
  399 |     await test.info().attach(`supplier-team-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  400 | 
  401 |     const elena = page.locator('.kb-card').filter({ hasText: 'Елена' }).first()
  402 |     await elena.getByRole('button', { name: 'Создать задачу' }).click()
  403 |     const taskTitle = `E2E визит ${info.project.name}-${Date.now()}`
  404 |     await elena.getByLabel('Название').fill(taskTitle)
  405 |     await elena.getByLabel('Тип').selectOption('salon_visit')
  406 |     await elena.getByRole('button', { name: 'Создать задачу' }).last().click()
  407 |     await expect(page.getByText('Задача назначена')).toBeVisible({ timeout: 15_000 })
  408 |     await elena.getByRole('link', { name: 'Открыть' }).click()
  409 |     await expect(page.getByRole('heading', { name: /Елена/ })).toBeVisible({ timeout: 15_000 })
  410 |     await page.getByRole('button', { name: 'Задачи' }).click()
  411 |     await expect(page.getByText(taskTitle).first()).toBeVisible({ timeout: 15_000 })
  412 |     if (info.project.name === 'phone-390') {
  413 |       await page.goto('/warehouse')
  414 |       await expect(page.getByRole('heading', { name: 'Склад' })).toBeVisible({ timeout: 15_000 })
  415 |       await expect(page.getByText(/доступно|резерв|в пути/).first()).toBeVisible()
  416 |     }
  417 |   })
  418 | 
  419 |   test('phase2 representative dashboard map finance analytics', async ({ page }, info) => {
  420 |     test.skip(!['phone-390', 'phone-430', 'tablet-768', 'laptop-1366', 'desktop-1920'].includes(info.project.name), 'phase2 viewports')
  421 |     await loginUI(page, 'rep1@demo.local')
  422 |     await expect(page).toHaveURL(/\/rep/, { timeout: 20_000 })
  423 |     await expect(page.getByRole('heading', { name: 'Кабинет представителя' })).toBeVisible({ timeout: 15_000 })
  424 |     await expect(page.getByText('Задач сегодня')).toBeVisible()
  425 |     await expect(page.getByText('К получению сегодня')).toBeVisible()
  426 |     await test.info().attach(`rep-dashboard-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  427 |     await expect(page.locator('.fc, .calendar-wrap').first()).toBeVisible({ timeout: 15_000 })
  428 | 
  429 |     await page.goto('/rep/map')
  430 |     await expect(page.getByRole('heading', { name: 'Карта маршрута' })).toBeVisible({ timeout: 15_000 })
  431 |     await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 15_000 })
  432 |     await expect(page.locator('.leaflet-overlay-pane svg, .leaflet-pane svg, path.leaflet-interactive').first()).toBeVisible({ timeout: 15_000 })
  433 |     await expect(page.locator('ol.list li, .list-item').first()).toBeVisible()
  434 |     await test.info().attach(`rep-map-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  435 | 
  436 |     await page.goto('/rep/finance')
  437 |     await expect(page.getByText('Итого на день')).toBeVisible({ timeout: 15_000 })
  438 |     await expect(page.getByText('Получено за месяц')).toBeVisible()
  439 |     await test.info().attach(`rep-finance-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  440 | 
  441 |     await page.goto('/rep/analytics')
  442 |     await expect(page.getByText('Доставки по дням')).toBeVisible({ timeout: 15_000 })
  443 |     await expect(page.locator('.recharts-surface').first()).toBeVisible()
  444 |     await test.info().attach(`rep-analytics-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  445 |     if (info.project.name === 'phone-390') {
  446 |       await page.goto('/warehouse')
  447 |       await expect(page.getByRole('heading', { name: 'Склад' })).toBeVisible({ timeout: 15_000 })
  448 |       await expect(page.locator('.product-card .badge, .badge').filter({ hasText: /Достаточный запас|Низкий запас|Нет в наличии/ }).first()).toBeVisible({ timeout: 15_000 })
  449 |     }
  450 |   })
  451 | 
  452 |   test('phase2 supplier monitoring sees both representatives', async ({ page }, info) => {
  453 |     test.skip(info.project.name !== 'phone-390', 'once')
  454 |     await loginUI(page, 'supplier1@demo.local')
  455 |     await page.goto('/supplier/team')
  456 |     await expect(page.getByRole('heading', { name: 'Мониторинг' })).toBeVisible({ timeout: 15_000 })
  457 |     await expect(page.getByText(/Елена/).first()).toBeVisible()
  458 |     await expect(page.getByText(/Павел/).first()).toBeVisible()
  459 |     await expect(page.getByText(/просроч/i).first()).toBeVisible()
  460 |     await expect(page.getByText(/доставок/i).first()).toBeVisible()
  461 |     await expect(page.getByText(/собрано/i).first()).toBeVisible()
  462 |   })
  463 | })
  464 | 
```