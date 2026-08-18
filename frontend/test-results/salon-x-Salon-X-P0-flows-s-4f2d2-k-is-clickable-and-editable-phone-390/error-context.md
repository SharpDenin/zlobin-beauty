# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: salon-x.spec.ts >> Salon-X P0 flows (seeded stack) >> calendar planner block is clickable and editable
- Location: e2e\salon-x.spec.ts:787:3

# Error details

```
Error: {"error":{"code":"conflict","message":"planner block overlaps an appointment","request_id":"025917c5-1f1a-4caa-8b4d-26d97f4ce858"}}

expect(received).toBeLessThan(expected)

Expected: < 300
Received:   409
```

# Test source

```ts
  712 |     const master = await apiLogin('master1@demo.local')
  713 |     const admin = await apiLogin('admin1@demo.local')
  714 |     const client = await apiLogin('client1@demo.local')
  715 |     const orgsRes = await fetch(`${api}/v1/organizations/mine`, { headers: { Authorization: `Bearer ${master.access_token}` } })
  716 |     expect(orgsRes.ok).toBeTruthy()
  717 |     const orgs = await orgsRes.json() as { items: Array<{ organization: { id: string } }> }
  718 |     const orgID = orgs.items[0]?.organization.id
  719 |     expect(orgID).toBeTruthy()
  720 |     const from = new Date(Date.now() - 7 * 86400000).toISOString()
  721 |     const to = new Date(Date.now() + 14 * 86400000).toISOString()
  722 |     const qs = `organization_id=${orgID}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  723 |     const adminCal = await fetch(`${api}/v1/calendar/appointments?${qs}`, { headers: { Authorization: `Bearer ${admin.access_token}` } })
  724 |     expect(adminCal.status, await adminCal.text()).toBe(200)
  725 |     const masterCal = await fetch(`${api}/v1/calendar/appointments?${qs}`, { headers: { Authorization: `Bearer ${master.access_token}` } })
  726 |     expect(masterCal.status).toBe(200)
  727 |     const clientCal = await fetch(`${api}/v1/calendar/appointments?${qs}`, { headers: { Authorization: `Bearer ${client.access_token}` } })
  728 |     expect(clientCal.status).toBe(403)
  729 |   })
  730 | 
  731 |   test('planner block occupies time and cannot overlap', async () => {
  732 |     const master = await apiLogin('master1@demo.local')
  733 |     const start = new Date(Date.UTC(2026, 11, 15, 4, 0, 0))
  734 |     const end = new Date(Date.UTC(2026, 11, 15, 5, 0, 0))
  735 |     const payload = {
  736 |       title: 'E2E lunch occupancy',
  737 |       category: 'break',
  738 |       starts_at: start.toISOString(),
  739 |       ends_at: end.toISOString(),
  740 |       timezone: 'Asia/Krasnoyarsk',
  741 |     }
  742 |     const create = await fetch(`${api}/v1/planner/blocks`, {
  743 |       method: 'POST',
  744 |       headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
  745 |       body: JSON.stringify(payload),
  746 |     })
  747 |     const created = await create.json() as { id?: string }
  748 |     expect(create.status, JSON.stringify(created)).toBeLessThan(300)
  749 |     expect(created.id).toBeTruthy()
  750 |     const overlap = await fetch(`${api}/v1/planner/blocks`, {
  751 |       method: 'POST',
  752 |       headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
  753 |       body: JSON.stringify({ ...payload, title: 'E2E overlap', category: 'personal' }),
  754 |     })
  755 |     expect(overlap.status).toBe(409)
  756 |     const del = await fetch(`${api}/v1/planner/blocks/${created.id}`, {
  757 |       method: 'DELETE',
  758 |       headers: { Authorization: `Bearer ${master.access_token}` },
  759 |     })
  760 |     expect(del.status).toBe(204)
  761 |   })
  762 | 
  763 |   test('salon admin lands on operational dashboard and can open staff', async ({ page }, info) => {
  764 |     test.skip(info.project.name !== 'phone-390', 'once')
  765 |     await loginUI(page, 'admin1@demo.local')
  766 |     await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible({ timeout: 15_000 })
  767 |     await expect(page.getByRole('link', { name: 'Найти мастера' })).toHaveCount(0)
  768 |     await page.goto('/staff')
  769 |     await expect(page.getByRole('heading', { name: /Команда/ })).toBeVisible({ timeout: 15_000 })
  770 |     await expect(page.getByText('только мастерам')).toHaveCount(0)
  771 |   })
  772 | 
  773 |   test('dashboard widget toggle survives reload', async ({ page }, info) => {
  774 |     test.skip(info.project.name !== 'phone-390', 'once')
  775 |     await loginUI(page, 'master1@demo.local')
  776 |     await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible({ timeout: 15_000 })
  777 |     await page.getByRole('button', { name: 'Настроить' }).click()
  778 |     const messages = page.locator('.dashboard-setting-row').filter({ hasText: 'Сообщения' }).locator('input[type="checkbox"]')
  779 |     await expect(messages).toBeVisible()
  780 |     if (await messages.isChecked()) await messages.uncheck()
  781 |     await page.getByRole('button', { name: 'Готово' }).click()
  782 |     await page.reload()
  783 |     await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible({ timeout: 15_000 })
  784 |     await expect(page.locator('.widget-drag-handle', { hasText: 'Сообщения' })).toHaveCount(0)
  785 |   })
  786 | 
  787 |   test('calendar planner block is clickable and editable', async ({ page }, info) => {
  788 |     test.skip(info.project.name !== 'phone-390', 'once')
  789 |     const master = await apiLogin('master1@demo.local')
  790 |     const from = new Date(Date.UTC(2026, 7, 17)).toISOString()
  791 |     const to = new Date(Date.UTC(2026, 8, 1)).toISOString()
  792 |     const listed = await fetch(`${api}/v1/planner/blocks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
  793 |       headers: { Authorization: `Bearer ${master.access_token}` },
  794 |     })
  795 |     const listedBody = await listed.json() as { items?: Array<{ id: string; title: string }> }
  796 |     let block = listedBody.items?.find((b) => b.title === 'E2E блок планера')
  797 |     if (!block) {
  798 |       const start = new Date(Date.UTC(2026, 7, 19, 3, 30, 0))
  799 |       const end = new Date(Date.UTC(2026, 7, 19, 4, 30, 0))
  800 |       const create = await fetch(`${api}/v1/planner/blocks`, {
  801 |         method: 'POST',
  802 |         headers: { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' },
  803 |         body: JSON.stringify({
  804 |           title: 'E2E блок планера',
  805 |           category: 'task',
  806 |           starts_at: start.toISOString(),
  807 |           ends_at: end.toISOString(),
  808 |           timezone: 'Asia/Krasnoyarsk',
  809 |         }),
  810 |       })
  811 |       const created = await create.json() as { id?: string }
> 812 |       expect(create.status, JSON.stringify(created)).toBeLessThan(300)
      |                                                      ^ Error: {"error":{"code":"conflict","message":"planner block overlaps an appointment","request_id":"025917c5-1f1a-4caa-8b4d-26d97f4ce858"}}
  813 |       block = { id: created.id!, title: 'E2E блок планера' }
  814 |     }
  815 |     await loginUI(page, 'master1@demo.local')
  816 |     await page.goto('/calendar')
  817 |     await expect(page.getByRole('button', { name: 'Неделя' })).toBeVisible({ timeout: 15_000 })
  818 |     await page.getByRole('button', { name: 'Список' }).click()
  819 |     const row = page.locator('.fc-list-event').filter({ hasText: 'E2E блок планера' }).first()
  820 |     await expect(row).toBeVisible({ timeout: 15_000 })
  821 |     await row.scrollIntoViewIfNeeded()
  822 |     await row.click({ force: true })
  823 |     await expect(page.getByRole('heading', { name: 'Событие планера' })).toBeVisible({ timeout: 10_000 })
  824 |     await page.getByRole('button', { name: 'Удалить событие' }).click()
  825 |     await expect(page.getByText('Событие удалено')).toBeVisible()
  826 |   })
  827 | 
  828 |   test('chain calendar branch switcher is present', async ({ page }, info) => {
  829 |     test.skip(info.project.name !== 'phone-390', 'once')
  830 |     await loginUI(page, 'chain1@demo.local')
  831 |     await page.goto('/calendar')
  832 |     await expect(page.getByTestId('calendar-branch-switcher')).toBeVisible({ timeout: 15_000 })
  833 |     await expect(page.getByTestId('calendar-branch-switcher').getByRole('option', { name: 'Новосибирск' }).first()).toBeAttached()
  834 |     await page.getByTestId('calendar-branch-switcher').selectOption({ label: 'Новосибирск' })
  835 |     await expect(page.getByText(/Asia\/Novosibirsk/)).toBeVisible()
  836 |   })
  837 | 
  838 |   test('phase2 supplier dashboard analytics team and assign task', async ({ page }, info) => {
  839 |     test.skip(!['phone-390', 'phone-430', 'tablet-768', 'laptop-1366', 'desktop-1920'].includes(info.project.name), 'phase2 viewports')
  840 |     await loginUI(page, 'supplier1@demo.local')
  841 |     await expect(page).toHaveURL(/\/supplier/, { timeout: 20_000 })
  842 |     await expect(page.getByText('Выручка сегодня').first()).toBeVisible({ timeout: 15_000 })
  843 |     await expect(page.getByText('Ожидает оплаты').first()).toBeVisible()
  844 |     await test.info().attach(`supplier-dashboard-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  845 | 
  846 |     await page.goto('/supplier/analytics')
  847 |     await expect(page.getByRole('heading', { name: 'Аналитика' })).toBeVisible({ timeout: 15_000 })
  848 |     await page.getByRole('button', { name: 'Неделя' }).click()
  849 |     await expect(page.getByText('Динамика выручки')).toBeVisible()
  850 |     await expect(page.locator('.recharts-surface').first()).toBeVisible({ timeout: 15_000 })
  851 |     if (info.project.name === 'laptop-1366') {
  852 |       await test.info().attach('supplier-analytics-desktop', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  853 |     }
  854 | 
  855 |     await page.goto('/supplier/team')
  856 |     await expect(page.getByRole('heading', { name: 'Представители' })).toBeVisible({ timeout: 15_000 })
  857 |     await expect(page.getByText(/Елена/).first()).toBeVisible()
  858 |     await expect(page.getByText(/Павел/).first()).toBeVisible()
  859 |     await test.info().attach(`supplier-team-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  860 | 
  861 |     const elena = page.locator('.kb-card').filter({ hasText: 'Елена' }).first()
  862 |     await elena.getByRole('button', { name: 'Создать задачу' }).click()
  863 |     const taskTitle = `E2E визит ${info.project.name}-${Date.now()}`
  864 |     await elena.getByLabel('Название').fill(taskTitle)
  865 |     await elena.getByLabel('Тип').selectOption('salon_visit')
  866 |     await elena.getByRole('button', { name: 'Создать задачу' }).last().click()
  867 |     await expect(page.getByText('Задача назначена')).toBeVisible({ timeout: 15_000 })
  868 |     await elena.getByRole('link', { name: 'Открыть' }).click()
  869 |     await expect(page.getByRole('heading', { name: /Елена/ })).toBeVisible({ timeout: 15_000 })
  870 |     await page.getByRole('button', { name: 'Задачи' }).click()
  871 |     await expect(page.getByText(taskTitle).first()).toBeVisible({ timeout: 15_000 })
  872 |     if (info.project.name === 'phone-390') {
  873 |       await page.goto('/warehouse')
  874 |       await expect(page.getByRole('heading', { name: 'Склад' })).toBeVisible({ timeout: 15_000 })
  875 |       await expect(page.getByText(/доступно|резерв|в пути/).first()).toBeVisible()
  876 |     }
  877 |   })
  878 | 
  879 |   test('phase2 representative dashboard map finance analytics', async ({ page }, info) => {
  880 |     test.skip(!['phone-390', 'phone-430', 'tablet-768', 'laptop-1366', 'desktop-1920'].includes(info.project.name), 'phase2 viewports')
  881 |     await loginUI(page, 'rep1@demo.local')
  882 |     await expect(page).toHaveURL(/\/rep/, { timeout: 20_000 })
  883 |     await expect(page.getByRole('heading', { name: 'Кабинет представителя' })).toBeVisible({ timeout: 15_000 })
  884 |     await expect(page.getByText('Задач сегодня')).toBeVisible()
  885 |     await expect(page.getByText('К получению сегодня')).toBeVisible()
  886 |     await test.info().attach(`rep-dashboard-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  887 |     await expect(page.locator('.fc, .calendar-wrap').first()).toBeVisible({ timeout: 15_000 })
  888 | 
  889 |     await page.goto('/rep/map')
  890 |     await expect(page.getByRole('heading', { name: 'Карта маршрута' })).toBeVisible({ timeout: 15_000 })
  891 |     await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 15_000 })
  892 |     await expect(page.locator('.leaflet-overlay-pane svg, .leaflet-pane svg, path.leaflet-interactive').first()).toBeVisible({ timeout: 15_000 })
  893 |     await expect(page.locator('ol.list li, .list-item').first()).toBeVisible()
  894 |     await test.info().attach(`rep-map-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  895 | 
  896 |     await page.goto('/rep/finance')
  897 |     await expect(page.getByText('Итого на день')).toBeVisible({ timeout: 15_000 })
  898 |     await expect(page.getByText('Получено за месяц')).toBeVisible()
  899 |     await test.info().attach(`rep-finance-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  900 | 
  901 |     await page.goto('/rep/analytics')
  902 |     await expect(page.getByText('Доставки по дням')).toBeVisible({ timeout: 15_000 })
  903 |     await expect(page.locator('.recharts-surface').first()).toBeVisible()
  904 |     await test.info().attach(`rep-analytics-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  905 |     if (info.project.name === 'phone-390') {
  906 |       await page.goto('/warehouse')
  907 |       await expect(page.getByRole('heading', { name: 'Склад' })).toBeVisible({ timeout: 15_000 })
  908 |       await expect(page.locator('.product-card .badge, .badge').filter({ hasText: /Достаточный запас|Низкий запас|Нет в наличии/ }).first()).toBeVisible({ timeout: 15_000 })
  909 |     }
  910 |   })
  911 | 
  912 |   test('phase2 supplier monitoring sees both representatives', async ({ page }, info) => {
```