# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: salon-x.spec.ts >> Salon-X P0 flows (seeded stack) >> phase6 auto-confirm confirms one client and blacklist still blocks
- Location: e2e\salon-x.spec.ts:1748:3

# Error details

```
Error: {"error":{"code":"forbidden","message":"client is blacklisted for this master","request_id":"5270135b-f9b3-42d6-805a-09e235990a9b"}}


expect(received).toBeTruthy()

Received: false
```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - generic [ref=f1e4]:
    - banner [ref=f1e5]:
      - generic [ref=f1e6]:
        - img "Salon-X" [ref=f1e8]
        - generic [ref=f1e9]: Кабинет владельца салона
      - button "Выйти" [ref=f1e11] [cursor=pointer]
    - main [ref=f1e12]:
      - generic [ref=f1e14]:
        - heading [level=1] [ref=f1e15]:
          - text: Клиент Два
          - button "Карточка клиента" [ref=f1e17] [cursor=pointer]: "?"
        - paragraph [ref=f1e18]: "+79001000002"
        - button "Не соответствует действительности" [ref=f1e19] [cursor=pointer]
      - generic [ref=f1e20]:
        - heading [level=2] [ref=f1e21]:
          - text: Автоподтверждение записей
          - button "Автоподтверждение" [ref=f1e23] [cursor=pointer]: "?"
        - paragraph [ref=f1e24]: Новые записи этого клиента будут подтверждаться автоматически.
        - generic [ref=f1e25]:
          - checkbox "Автоподтверждение для этого клиента" [checked] [ref=f1e26]
          - generic [ref=f1e27]: Автоподтверждение для этого клиента
      - generic [ref=f1e28]:
        - heading "Чёрный список (no-show)" [level=2] [ref=f1e29]
        - paragraph [ref=f1e30]: "No-show: 2 · статус: заблокирован"
        - button "Разблокировать клиента" [ref=f1e31] [cursor=pointer]
      - generic [ref=f1e32]:
        - heading "История посещений" [level=2] [ref=f1e33]
        - generic [ref=f1e34]:
          - article [ref=f1e35]:
            - generic [ref=f1e36]:
              - strong [ref=f1e37]: Стрижка
              - generic [ref=f1e38]: 2 000 ₽
            - paragraph [ref=f1e39]: 26.08.2026, 11:00:00
          - article [ref=f1e40]:
            - generic [ref=f1e41]:
              - strong [ref=f1e42]: Стрижка
              - generic [ref=f1e43]: 2 000 ₽
            - paragraph [ref=f1e44]: 19.08.2026, 11:00:00
      - generic [ref=f1e45]:
        - heading "Заметка" [level=2] [ref=f1e46]
        - generic [ref=f1e47]:
          - generic [ref=f1e48]:
            - generic [ref=f1e49]: Визит
            - combobox "Визит" [ref=f1e50]:
              - option "Выберите" [selected]
              - option "Стрижка · 26.08.2026"
              - option "Стрижка · 19.08.2026"
          - generic [ref=f1e51]:
            - generic [ref=f1e52]: Текст
            - textbox "Текст" [ref=f1e53]
          - button "Сохранить заметку" [ref=f1e54] [cursor=pointer]
      - generic [ref=f1e55]:
        - heading "Составы окрашивания" [level=2] [ref=f1e56]
        - heading "Составов пока нет" [level=2] [ref=f1e58]
        - generic [ref=f1e59]:
          - heading "Новый состав" [level=3] [ref=f1e60]
          - generic [ref=f1e61]:
            - generic [ref=f1e62]: Название
            - textbox [ref=f1e63]
          - generic [ref=f1e64]:
            - generic [ref=f1e65]: Бренд
            - textbox [ref=f1e66]
          - generic [ref=f1e67]:
            - generic [ref=f1e68]: Компоненты через запятую
            - textbox "8.1 30g, 9.13 20g" [ref=f1e69]
          - generic [ref=f1e70]:
            - generic [ref=f1e71]: Окислитель
            - textbox [ref=f1e72]
          - generic [ref=f1e73]:
            - generic [ref=f1e74]: Пропорция
            - textbox "1:2" [ref=f1e75]
          - generic [ref=f1e76]:
            - generic [ref=f1e77]: Комментарий
            - textbox [ref=f1e78]
          - generic [ref=f1e79]:
            - checkbox "Не указывать формулу" [ref=f1e80]
            - generic [ref=f1e81]: Не указывать формулу
          - button "Сохранить состав" [ref=f1e82] [cursor=pointer]
  - navigation "Основная навигация" [ref=f1e83]:
    - link "Сегодня" [ref=f1e84] [cursor=pointer]:
      - /url: /
    - link "Календарь" [ref=f1e85] [cursor=pointer]:
      - /url: /calendar
    - link "Записи" [ref=f1e86] [cursor=pointer]:
      - /url: /appointments
    - button "Ещё" [ref=f1e87] [cursor=pointer]
```

# Test source

```ts
  1690 |     await expect(page.getByRole('link', { name: 'Настройки' })).toBeVisible()
  1691 |     await closeMoreDrawer(page)
  1692 |     await page.getByRole('button', { name: 'Выйти' }).first().click()
  1693 | 
  1694 |     await loginUI(page, 'admin1@demo.local')
  1695 |     await expect(page.locator('.topbar-cabinet')).toHaveText('Кабинет администратора', { timeout: 15_000 })
  1696 |     await moreLinks()
  1697 |     await expect(page.getByRole('link', { name: 'Команда' })).toBeVisible()
  1698 |     await expect(page.getByRole('link', { name: 'Настройки' })).toHaveCount(0)
  1699 |     await expect(page.getByRole('link', { name: 'Аналитика' })).toHaveCount(0)
  1700 |     await closeMoreDrawer(page)
  1701 |     await page.goto('/salon/settings')
  1702 |     await expect(page.getByText('недоступен для вашей роли')).toBeVisible({ timeout: 10_000 })
  1703 |     await page.getByRole('button', { name: 'Выйти' }).first().click()
  1704 | 
  1705 |     await loginUI(page, 'chain1@demo.local')
  1706 |     await expect(page.locator('.topbar-cabinet')).toHaveText('Кабинет владельца сети', { timeout: 15_000 })
  1707 |     await expect(page.getByTestId('chain-branch-switcher').locator('visible=true').first()).toBeVisible({ timeout: 15_000 })
  1708 |   })
  1709 | 
  1710 |   test('phase6 chain owner branch switcher changes staff context', async ({ page }, info) => {
  1711 |     test.skip(!['phone-390', 'laptop-1366'].includes(info.project.name), 'phase6 viewports')
  1712 |     await loginUI(page, 'chain1@demo.local')
  1713 |     const branchSwitch = page.getByTestId('chain-branch-switcher').locator('visible=true').first()
  1714 |     await expect(branchSwitch).toBeVisible({ timeout: 15_000 })
  1715 |     await branchSwitch.selectOption({ label: 'Новосибирск' })
  1716 |     await page.goto('/staff')
  1717 |     await expect(page.getByText(/Сеть Salon-X \(demo\) · Новосибирск/)).toBeVisible({ timeout: 15_000 })
  1718 |     await page.goto('/calendar')
  1719 |     await expect(page.getByTestId('calendar-branch-switcher')).toHaveValue(/.+/)
  1720 |   })
  1721 | 
  1722 |   test('phase6 hints dismiss persists and global off hides them', async ({ page }, info) => {
  1723 |     test.skip(info.project.name !== 'phone-390', 'once')
  1724 |     const email = `p6-hint-${Date.now()}@demo.local`
  1725 |     const reg = await fetch(`${api}/v1/auth/register`, {
  1726 |       method: 'POST',
  1727 |       headers: { 'Content-Type': 'application/json' },
  1728 |       body: JSON.stringify({ email, password, display_name: 'P6 Hints', as_master: false }),
  1729 |     })
  1730 |     expect(reg.ok, await reg.text()).toBeTruthy()
  1731 |     await loginUI(page, email)
  1732 |     await page.goto('/search')
  1733 |     await expect(page.getByTestId('hint-client-booking')).toBeVisible({ timeout: 15_000 })
  1734 |     await page.getByRole('button', { name: 'Запись' }).click()
  1735 |     await page.getByRole('button', { name: 'Больше не показывать' }).click()
  1736 |     await expect(page.getByTestId('hint-client-booking')).toHaveCount(0)
  1737 |     await page.reload()
  1738 |     await expect(page.getByRole('heading', { name: /Поиск/ })).toBeVisible({ timeout: 15_000 })
  1739 |     await expect(page.getByTestId('hint-client-booking')).toHaveCount(0)
  1740 |     await page.goto('/profile')
  1741 |     await expect(page.getByTestId('hints-toggle')).toBeVisible({ timeout: 10_000 })
  1742 |     await page.getByTestId('hints-toggle').click()
  1743 |     await expect(page.getByTestId('hints-toggle')).not.toBeChecked({ timeout: 15_000 })
  1744 |     await page.goto('/shop')
  1745 |     await expect(page.getByTestId('hint-shop-home')).toHaveCount(0)
  1746 |   })
  1747 | 
  1748 |   test('phase6 auto-confirm confirms one client and blacklist still blocks', async ({ page }, info) => {
  1749 |     test.skip(!['phone-390', 'laptop-1366'].includes(info.project.name), 'phase6 viewports')
  1750 |     const master = await apiLogin('master1@demo.local')
  1751 |     const client2 = await apiLogin('client2@demo.local')
  1752 |     const me = await fetch(`${api}/v1/auth/me`, { headers: { Authorization: `Bearer ${client2.access_token}` } })
  1753 |     const clientBody = await me.json() as { id?: string; user?: { id?: string } }
  1754 |     const clientId = clientBody.id ?? clientBody.user?.id
  1755 |     const cardsRes = await fetch(`${api}/v1/clients/mine`, { headers: { Authorization: `Bearer ${master.access_token}` } })
  1756 |     const cards = await cardsRes.json() as { items?: Array<{ id: string; user_id?: string }> }
  1757 |     const card = (cards.items ?? []).find((c) => c.user_id === clientId)
  1758 |     expect(card?.id).toBeTruthy()
  1759 | 
  1760 |     await loginUI(page, 'master1@demo.local')
  1761 |     await page.goto(`/clients/${card!.id}`)
  1762 |     await expect(page.getByTestId('auto-confirm-toggle')).toBeVisible({ timeout: 15_000 })
  1763 |     if (!(await page.getByTestId('auto-confirm-toggle').isChecked())) {
  1764 |       await page.getByText('Автоподтверждение для этого клиента').click()
  1765 |       await expect(page.getByText('Автоподтверждение обновлено')).toBeVisible({ timeout: 10_000 })
  1766 |     }
  1767 | 
  1768 |     const prof = await fetch(`${api}/v1/me/master`, { headers: { Authorization: `Bearer ${master.access_token}` } })
  1769 |     const profBody = await prof.json() as { master?: { id: string }; services?: Array<{ id: string; duration_minutes?: number; name: string }> }
  1770 |     const service = (profBody.services ?? []).find((s) => /стрижк/i.test(s.name)) ?? profBody.services?.[0]
  1771 |     const masterMe = await fetch(`${api}/v1/auth/me`, { headers: { Authorization: `Bearer ${master.access_token}` } })
  1772 |     const masterBody = await masterMe.json() as { id?: string; user?: { id?: string } }
  1773 |     const masterUserId = masterBody.id ?? masterBody.user?.id
  1774 |     let starts: string | undefined
  1775 |     for (let d = 1; d <= 16 && !starts; d++) {
  1776 |       const day = new Date(Date.now() + d * 86400000)
  1777 |       if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue
  1778 |       const slotsRes = await fetch(`${api}/v1/masters/${masterUserId}/slots?date=${day.toISOString().slice(0, 10)}&duration_minutes=${service!.duration_minutes ?? 60}`)
  1779 |       if (!slotsRes.ok) continue
  1780 |       const slots = await slotsRes.json() as { items?: Array<{ starts_at: string }> }
  1781 |       starts = slots.items?.[0]?.starts_at
  1782 |     }
  1783 |     expect(starts).toBeTruthy()
  1784 |     const booked = await fetch(`${api}/v1/appointments`, {
  1785 |       method: 'POST',
  1786 |       headers: { Authorization: `Bearer ${client2.access_token}`, 'Content-Type': 'application/json' },
  1787 |       body: JSON.stringify({ master_id: profBody.master!.id, service_id: service!.id, starts_at: starts }),
  1788 |     })
  1789 |     const bookedText = await booked.text()
> 1790 |     expect(booked.ok, bookedText).toBeTruthy()
       |                                   ^ Error: {"error":{"code":"forbidden","message":"client is blacklisted for this master","request_id":"5270135b-f9b3-42d6-805a-09e235990a9b"}}
  1791 |     const bookedBody = JSON.parse(bookedText) as { status?: string }
  1792 |     expect(bookedBody.status).toBe('confirmed')
  1793 | 
  1794 |     const freshEmail = `p6-ac-${Date.now()}@demo.local`
  1795 |     const reg = await fetch(`${api}/v1/auth/register`, {
  1796 |       method: 'POST',
  1797 |       headers: { 'Content-Type': 'application/json' },
  1798 |       body: JSON.stringify({ email: freshEmail, password, display_name: 'P6 Pending' }),
  1799 |     })
  1800 |     expect(reg.ok).toBeTruthy()
  1801 |     const fresh = await apiLogin(freshEmail)
  1802 |     let starts2: string | undefined
  1803 |     for (let d = 1; d <= 16 && !starts2; d++) {
  1804 |       const day = new Date(Date.now() + d * 86400000)
  1805 |       if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue
  1806 |       const slotsRes = await fetch(`${api}/v1/masters/${masterUserId}/slots?date=${day.toISOString().slice(0, 10)}&duration_minutes=${service!.duration_minutes ?? 60}`)
  1807 |       if (!slotsRes.ok) continue
  1808 |       const slots = await slotsRes.json() as { items?: Array<{ starts_at: string }> }
  1809 |       starts2 = slots.items?.[1]?.starts_at ?? slots.items?.[0]?.starts_at
  1810 |     }
  1811 |     const pending = await fetch(`${api}/v1/appointments`, {
  1812 |       method: 'POST',
  1813 |       headers: { Authorization: `Bearer ${fresh.access_token}`, 'Content-Type': 'application/json' },
  1814 |       body: JSON.stringify({ master_id: profBody.master!.id, service_id: service!.id, starts_at: starts2 }),
  1815 |     })
  1816 |     const pendingText = await pending.text()
  1817 |     expect(pending.ok, pendingText).toBeTruthy()
  1818 |     const pendingBody = JSON.parse(pendingText) as { status?: string }
  1819 |     expect(pendingBody.status).toMatch(/pending/)
  1820 | 
  1821 |     const client3 = await apiLogin('client3@demo.local')
  1822 |     const blocked = await fetch(`${api}/v1/appointments`, {
  1823 |       method: 'POST',
  1824 |       headers: { Authorization: `Bearer ${client3.access_token}`, 'Content-Type': 'application/json' },
  1825 |       body: JSON.stringify({ master_id: profBody.master!.id, service_id: service!.id, starts_at: starts }),
  1826 |     })
  1827 |     expect(blocked.status).toBe(403)
  1828 |     await page.goto(`/masters/${profBody.master!.id}`)
  1829 |   })
  1830 | 
  1831 |   test('phase2 A premium omit_formula is independent of skip_service_scheme', async ({ page }, info) => {
  1832 |     test.skip(info.project.name !== 'phone-390', 'once')
  1833 |     await ensureCompletedWithClient('master4@demo.local', 'client1@demo.local', 'Phase4')
  1834 |     const { appt, master } = await ensureInProgressForClient('premium1@demo.local', 'client1@demo.local', 'Phase4 Premium')
  1835 | 
  1836 |     await loginUI(page, 'premium1@demo.local')
  1837 |     await page.goto(`/appointments/${appt.id}`)
  1838 |     await fillColoringScheme(page)
  1839 |     await expect(page.getByTestId('omit-formula')).toBeVisible({ timeout: 15_000 })
  1840 |     await expect(page.getByTestId('skip-scheme')).not.toBeChecked()
  1841 |     await page.getByTestId('omit-formula').check()
  1842 |     await expect(page.getByTestId('skip-scheme')).not.toBeChecked()
  1843 |     await page.getByTestId('complete-appointment').click()
  1844 |     await expect(page.locator('.badge').filter({ hasText: /заверш/i })).toBeVisible({ timeout: 20_000 })
  1845 |     await expect(page.getByTestId('scheme-summary')).toBeVisible()
  1846 |     await expect(page.getByTestId('scheme-withheld')).toHaveCount(0)
  1847 |     await expect(page.getByTestId('formula-withheld')).toHaveCount(0)
  1848 | 
  1849 |     const owner = await fetchScheme(master.access_token, appt.id)
  1850 |     expect(owner.status, owner.text).toBe(200)
  1851 |     expect(owner.body.exists).toBe(true)
  1852 |     expect(owner.body.skipped).toBe(false)
  1853 |     expect(owner.body.omit_formula).toBe(true)
  1854 |     expect(owner.body.details_redacted).toBe(false)
  1855 |     expect(owner.body.formula_redacted).toBe(false)
  1856 |     expect(String(schemeCategoryFields(owner.body).dye ?? '')).toMatch(/Majirel/)
  1857 |     expect(owner.body.technique).toMatch(/Балаяж/)
  1858 | 
  1859 |     const free = await apiLogin('master4@demo.local')
  1860 |     const peer = await fetchScheme(free.access_token, appt.id)
  1861 |     expect(peer.status, peer.text).toBe(200)
  1862 |     expect(peer.body.exists).toBe(true)
  1863 |     expect(peer.body.skipped).toBe(false)
  1864 |     expect(peer.body.omit_formula).toBe(true)
  1865 |     expect(peer.body.details_redacted).toBe(true)
  1866 |     expect(peer.body.formula_redacted).toBe(true)
  1867 |     expect(schemeCategoryFields(peer.body).dye).toBeUndefined()
  1868 |     expect(peer.body.technique ?? '').toBe('')
  1869 |     expect(peer.text).not.toMatch(/Majirel/i)
  1870 |     expect(peer.text).not.toMatch(/Балаяж/i)
  1871 |   })
  1872 | 
  1873 |   test('phase2 B free master sees visit fact without technical details', async ({ page }, info) => {
  1874 |     test.skip(info.project.name !== 'phone-390', 'once')
  1875 |     await ensureCompletedWithClient('master4@demo.local', 'client1@demo.local', 'Phase4')
  1876 |     const started = await ensureInProgressForClient('premium1@demo.local', 'client1@demo.local', 'Phase4 Premium')
  1877 |     await completeAppointmentApi(started.master.access_token, started.appt.id, PHASE2_FORMULA)
  1878 | 
  1879 |     const owner = await fetchScheme(started.master.access_token, started.appt.id)
  1880 |     expect(owner.body.exists).toBe(true)
  1881 |     expect(owner.body.omit_formula).toBe(true)
  1882 |     expect(owner.body.skipped).toBe(false)
  1883 |     expect(owner.body.details_redacted).toBe(false)
  1884 |     expect(owner.body.formula_redacted).toBe(false)
  1885 | 
  1886 |     const free = await apiLogin('master4@demo.local')
  1887 |     const peer = await fetchScheme(free.access_token, started.appt.id)
  1888 |     expect(peer.status, peer.text).toBe(200)
  1889 |     expect(peer.body.exists).toBe(true)
  1890 |     expect(peer.body.details_redacted).toBe(true)
```