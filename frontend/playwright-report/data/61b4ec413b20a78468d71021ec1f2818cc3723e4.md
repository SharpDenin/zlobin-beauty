# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: salon-x.spec.ts >> Salon-X P0 flows (seeded stack) >> phase3 B onsite search matches district and date only
- Location: e2e\salon-x.spec.ts:1988:3

# Error details

```
Error: {"error":{"code":"conflict","message":"Интервалы режимов работы не должны пересекаться","request_id":"e9b56650-4e3d-4f1f-a5ba-391fd969b965"}}


expect(received).toBe(expected) // Object.is equality

Expected: 201
Received: 409
```

# Test source

```ts
  1904 |     const started = await ensureInProgressForClient('premium1@demo.local', 'client1@demo.local', 'Phase4 Premium')
  1905 |     await completeAppointmentApi(started.master.access_token, started.appt.id, {
  1906 |       ...PHASE2_FORMULA,
  1907 |       omit_formula: false,
  1908 |     })
  1909 | 
  1910 |     const cardRes = await fetch(`${api}/v1/clients/appointment/${started.appt.id}`, {
  1911 |       headers: { Authorization: `Bearer ${started.master.access_token}` },
  1912 |     })
  1913 |     expect(cardRes.ok, await cardRes.clone().text()).toBeTruthy()
  1914 |     const before = await cardRes.json() as { id: string; preferences?: string; display_name?: string; phone?: string | null; email?: string | null }
  1915 |     expect(before.id).toBeTruthy()
  1916 | 
  1917 |     await loginUI(page, 'premium1@demo.local')
  1918 |     await page.goto(`/clients/by-appointment/${started.appt.id}`)
  1919 |     await expect(page.getByTestId('dispute-open')).toBeVisible({ timeout: 15_000 })
  1920 |     await page.getByTestId('dispute-open').click()
  1921 |     await page.getByTestId('dispute-field').selectOption('preferences')
  1922 |     await page.getByTestId('dispute-comment').fill(`E2E phase2 dispute ${Date.now()}`)
  1923 |     await page.getByTestId('dispute-submit').click()
  1924 |     await expect(page.getByTestId('dispute-success')).toBeVisible({ timeout: 15_000 })
  1925 | 
  1926 |     const afterRes = await fetch(`${api}/v1/clients/id/${before.id}`, {
  1927 |       headers: { Authorization: `Bearer ${started.master.access_token}` },
  1928 |     })
  1929 |     expect(afterRes.ok).toBeTruthy()
  1930 |     const after = await afterRes.json() as { preferences?: string; display_name?: string; phone?: string | null; email?: string | null }
  1931 |     expect(after.preferences ?? '').toBe(before.preferences ?? '')
  1932 |     expect(after.display_name).toBe(before.display_name)
  1933 |     expect(after.phone ?? null).toBe(before.phone ?? null)
  1934 |     expect(after.email ?? null).toBe(before.email ?? null)
  1935 | 
  1936 |     await page.getByRole('button', { name: 'Закрыть' }).click()
  1937 |     await page.getByTestId('dispute-open').click()
  1938 |     await page.getByTestId('dispute-field').selectOption('preferences')
  1939 |     await page.getByTestId('dispute-comment').fill('duplicate open')
  1940 |     await page.getByTestId('dispute-submit').click()
  1941 |     await expect(page.getByTestId('dispute-success')).toContainText(/уже зарегистрировано/i)
  1942 |   })
  1943 | 
  1944 |   test('phase3 A multiple work modes appear on calendar and reject overlap', async ({ page }, info) => {
  1945 |     test.skip(info.project.name !== 'phone-390', 'once')
  1946 |     const master = await apiLogin('master1@demo.local')
  1947 |     const headers = { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' }
  1948 |     const orgsRes = await fetch(`${api}/v1/organizations/mine`, { headers })
  1949 |     expect(orgsRes.ok, await orgsRes.clone().text()).toBeTruthy()
  1950 |     const orgs = await orgsRes.json() as { items: Array<{ organization: { id: string }; branches: Array<{ id: string }> }> }
  1951 |     const orgId = orgs.items[0].organization.id
  1952 |     const branchId = orgs.items[0].branches[0].id
  1953 |     const day = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10)
  1954 |     const chairRes = await fetch(`${api}/v1/chairs`, {
  1955 |       method: 'POST', headers,
  1956 |       body: JSON.stringify({ organization_id: orgId, branch_id: branchId, name: `E2E chair ${Date.now()}`, listed_for_rent: true, rent_note: 'тест' }),
  1957 |     })
  1958 |     expect(chairRes.status, await chairRes.clone().text()).toBe(201)
  1959 |     const chair = await chairRes.json() as { id: string }
  1960 |     const chairIv = await fetch(`${api}/v1/me/work-mode-intervals`, {
  1961 |       method: 'POST', headers,
  1962 |       body: JSON.stringify({ mode: 'chair', chair_id: chair.id, starts_at: `${day}T10:00:00+07:00`, ends_at: `${day}T14:00:00+07:00`, timezone: 'Asia/Krasnoyarsk' }),
  1963 |     })
  1964 |     expect(chairIv.status, await chairIv.clone().text()).toBe(201)
  1965 |     const overlap = await fetch(`${api}/v1/me/work-mode-intervals`, {
  1966 |       method: 'POST', headers,
  1967 |       body: JSON.stringify({ mode: 'onsite', city_id: '11111111-1111-4111-8111-111111111001', district_ids: ['11111111-1111-4111-8111-111111111011'], starts_at: `${day}T13:00:00+07:00`, ends_at: `${day}T18:00:00+07:00`, timezone: 'Asia/Krasnoyarsk' }),
  1968 |     })
  1969 |     expect(overlap.status).toBe(409)
  1970 |     const onsite = await fetch(`${api}/v1/me/work-mode-intervals`, {
  1971 |       method: 'POST', headers,
  1972 |       body: JSON.stringify({ mode: 'onsite', city_id: '11111111-1111-4111-8111-111111111001', district_ids: ['11111111-1111-4111-8111-111111111011'], starts_at: `${day}T15:00:00+07:00`, ends_at: `${day}T20:00:00+07:00`, timezone: 'Asia/Krasnoyarsk' }),
  1973 |     })
  1974 |     expect(onsite.status, await onsite.clone().text()).toBe(201)
  1975 |     await loginUI(page, 'master1@demo.local')
  1976 |     await page.goto('/calendar')
  1977 |     await page.getByRole('button', { name: 'Месяц' }).click()
  1978 |     const target = new Date(`${day}T12:00:00+07:00`)
  1979 |     const now = new Date()
  1980 |     const monthsAhead = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth())
  1981 |     for (let i = 0; i < monthsAhead; i++) {
  1982 |       await page.locator('.fc-next-button').click()
  1983 |     }
  1984 |     await expect(page.getByText('В салоне').first()).toBeVisible({ timeout: 20_000 })
  1985 |     await expect(page.getByText('Выезд').first()).toBeVisible()
  1986 |   })
  1987 | 
  1988 |   test('phase3 B onsite search matches district and date only', async ({ page }, info) => {
  1989 |     test.skip(info.project.name !== 'phone-390', 'once')
  1990 |     const master = await apiLogin('master1@demo.local')
  1991 |     const headers = { Authorization: `Bearer ${master.access_token}`, 'Content-Type': 'application/json' }
  1992 |     const day = new Date(Date.now() + 13 * 86400000).toISOString().slice(0, 10)
  1993 |     const created = await fetch(`${api}/v1/me/work-mode-intervals`, {
  1994 |       method: 'POST', headers,
  1995 |       body: JSON.stringify({
  1996 |         mode: 'onsite',
  1997 |         city_id: '11111111-1111-4111-8111-111111111001',
  1998 |         district_ids: ['11111111-1111-4111-8111-111111111011'],
  1999 |         starts_at: `${day}T12:00:00+07:00`,
  2000 |         ends_at: `${day}T20:00:00+07:00`,
  2001 |         timezone: 'Asia/Krasnoyarsk',
  2002 |       }),
  2003 |     })
> 2004 |     expect(created.status, await created.clone().text()).toBe(201)
       |                                                          ^ Error: {"error":{"code":"conflict","message":"Интервалы режимов работы не должны пересекаться","request_id":"e9b56650-4e3d-4f1f-a5ba-391fd969b965"}}
  2005 |     const hit = await fetch(`${api}/v1/masters?city=${encodeURIComponent('Красноярск')}&district_id=11111111-1111-4111-8111-111111111011&available_on=${day}`)
  2006 |     expect(hit.ok).toBeTruthy()
  2007 |     const hitBody = await hit.json() as { items: Array<{ user_id: string; onsite_match?: { badge: string } }> }
  2008 |     expect(hitBody.items.some((m) => m.onsite_match?.badge)).toBeTruthy()
  2009 |     const missDistrict = await fetch(`${api}/v1/masters?city=${encodeURIComponent('Красноярск')}&district_id=11111111-1111-4111-8111-111111111014&available_on=${day}`)
  2010 |     const missBody = await missDistrict.json() as { items: Array<{ onsite_match?: unknown }> }
  2011 |     expect(missBody.items.every((m) => !m.onsite_match)).toBeTruthy()
  2012 |     const otherDay = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10)
  2013 |     const missDay = await fetch(`${api}/v1/masters?city=${encodeURIComponent('Красноярск')}&district_id=11111111-1111-4111-8111-111111111011&available_on=${otherDay}`)
  2014 |     const missDayBody = await missDay.json() as { items: Array<{ onsite_match?: unknown }> }
  2015 |     expect(missDayBody.items.every((m) => !m.onsite_match)).toBeTruthy()
  2016 |     await loginUI(page, 'client1@demo.local')
  2017 |     await page.goto('/search')
  2018 |     await page.locator('#city').fill('Красноярск')
  2019 |     await page.locator('#available_on').fill(day)
  2020 |     await page.locator('#district_id').selectOption('11111111-1111-4111-8111-111111111011')
  2021 |     await page.getByRole('button', { name: 'Искать' }).click()
  2022 |     await expect(page.getByTestId('onsite-badge').first()).toBeVisible({ timeout: 15_000 })
  2023 |   })
  2024 | 
  2025 |   test('phase3 C chair rental then work interval for renter only', async ({ page }, info) => {
  2026 |     test.skip(info.project.name !== 'phone-390', 'once')
  2027 |     const owner = await apiLogin('master1@demo.local')
  2028 |     const renter = await apiLogin('master2@demo.local')
  2029 |     const employee = await apiLogin('employee1@demo.local')
  2030 |     const ownerH = { Authorization: `Bearer ${owner.access_token}`, 'Content-Type': 'application/json' }
  2031 |     const renterH = { Authorization: `Bearer ${renter.access_token}`, 'Content-Type': 'application/json' }
  2032 |     const empH = { Authorization: `Bearer ${employee.access_token}`, 'Content-Type': 'application/json' }
  2033 |     const orgsRes = await fetch(`${api}/v1/organizations/mine`, { headers: ownerH })
  2034 |     const orgs = await orgsRes.json() as { items: Array<{ organization: { id: string }; branches: Array<{ id: string }> }> }
  2035 |     const orgId = orgs.items[0].organization.id
  2036 |     const branchId = orgs.items[0].branches[0].id
  2037 |     const chairRes = await fetch(`${api}/v1/chairs`, {
  2038 |       method: 'POST', headers: ownerH,
  2039 |       body: JSON.stringify({ organization_id: orgId, branch_id: branchId, name: `Rent ${Date.now()}`, listed_for_rent: true }),
  2040 |     })
  2041 |     expect(chairRes.status, await chairRes.clone().text()).toBe(201)
  2042 |     const chair = await chairRes.json() as { id: string }
  2043 |     const dayAt = (offset: number) => new Date(Date.now() + (110 + offset) * 86400000).toISOString().slice(0, 10)
  2044 |     const steal = await fetch(`${api}/v1/me/work-mode-intervals`, {
  2045 |       method: 'POST', headers: renterH,
  2046 |       body: JSON.stringify({ mode: 'chair', chair_id: chair.id, starts_at: `${dayAt(0)}T10:00:00+07:00`, ends_at: `${dayAt(0)}T18:00:00+07:00`, timezone: 'Asia/Krasnoyarsk' }),
  2047 |     })
  2048 |     expect(steal.status).toBe(403)
  2049 |     const staffOk = await fetch(`${api}/v1/me/work-mode-intervals`, {
  2050 |       method: 'POST', headers: empH,
  2051 |       body: JSON.stringify({ mode: 'chair', chair_id: chair.id, starts_at: `${dayAt(1)}T10:00:00+07:00`, ends_at: `${dayAt(1)}T12:00:00+07:00`, timezone: 'Asia/Krasnoyarsk' }),
  2052 |     })
  2053 |     expect(staffOk.status, await staffOk.clone().text()).toBe(201)
  2054 |     const reqLease = await fetch(`${api}/v1/chairs/${chair.id}/leases`, {
  2055 |       method: 'POST', headers: renterH,
  2056 |       body: JSON.stringify({ starts_at: `${dayAt(3)}T00:00:00+07:00`, ends_at: `${dayAt(10)}T00:00:00+07:00` }),
  2057 |     })
  2058 |     expect(reqLease.status, await reqLease.clone().text()).toBe(201)
  2059 |     const lease = await reqLease.json() as { id: string }
  2060 |     const approve = await fetch(`${api}/v1/chair-leases/${lease.id}/approve`, { method: 'POST', headers: ownerH })
  2061 |     expect(approve.status, await approve.clone().text()).toBe(200)
  2062 |     const use = await fetch(`${api}/v1/me/work-mode-intervals`, {
  2063 |       method: 'POST', headers: renterH,
  2064 |       body: JSON.stringify({ mode: 'chair', chair_id: chair.id, starts_at: `${dayAt(4)}T10:00:00+07:00`, ends_at: `${dayAt(4)}T18:00:00+07:00`, timezone: 'Asia/Krasnoyarsk' }),
  2065 |     })
  2066 |     expect(use.status, await use.clone().text()).toBe(201)
  2067 |     const afterLease = await fetch(`${api}/v1/me/work-mode-intervals`, {
  2068 |       method: 'POST', headers: renterH,
  2069 |       body: JSON.stringify({ mode: 'chair', chair_id: chair.id, starts_at: `${dayAt(40)}T10:00:00+07:00`, ends_at: `${dayAt(40)}T18:00:00+07:00`, timezone: 'Asia/Krasnoyarsk' }),
  2070 |     })
  2071 |     expect(afterLease.status).toBe(403)
  2072 |     await loginUI(page, 'master1@demo.local')
  2073 |     await page.goto('/salon/settings')
  2074 |     await expect(page.getByTestId('chair-admin')).toBeVisible({ timeout: 15_000 })
  2075 |   })
  2076 | 
  2077 |   test('phase3 D work_type and profession types stay independent', async () => {
  2078 |     const master = await apiLogin('master1@demo.local')
  2079 |     const res = await fetch(`${api}/v1/me/master`, { headers: { Authorization: `Bearer ${master.access_token}` } })
  2080 |     expect(res.ok).toBeTruthy()
  2081 |     const body = await res.json() as { master?: { work_type?: string; profession_types?: unknown[] } }
  2082 |     expect(body.master?.work_type).toBeTruthy()
  2083 |     expect(Array.isArray(body.master?.profession_types)).toBeTruthy()
  2084 |   })
  2085 | 
  2086 |   test('phase4 client-master messenger and unauthorized access', async ({ page }, info) => {
  2087 |     test.skip(info.project.name !== 'phone-390', 'once')
  2088 |     const client = await apiLogin('client1@demo.local')
  2089 |     const master = await apiLogin('master1@demo.local')
  2090 |     const stranger = await apiLogin('client2@demo.local')
  2091 |     const masterMe = await fetch(`${api}/v1/auth/me`, { headers: { Authorization: `Bearer ${master.access_token}` } })
  2092 |     const masterBody = await masterMe.json() as { id?: string }
  2093 |     const masterUserId = masterBody.id
  2094 |     expect(masterUserId).toBeTruthy()
  2095 |     const profile = await fetch(`${api}/v1/me/master`, { headers: { Authorization: `Bearer ${master.access_token}` } })
  2096 |     const prof = await profile.json() as { master?: { id: string } }
  2097 |     expect(prof.master?.id).toBeTruthy()
  2098 | 
  2099 |     await loginUI(page, 'client1@demo.local')
  2100 |     await page.goto(`/masters/${prof.master!.id}`)
  2101 |     await expect(page.getByTestId('write-master')).toBeVisible({ timeout: 15_000 })
  2102 |     await page.getByTestId('write-master').click()
  2103 |     await expect(page).toHaveURL(/\/messages\//, { timeout: 15_000 })
  2104 |     const hello = `Здравствуйте, хочу записаться ${Date.now()}`
```