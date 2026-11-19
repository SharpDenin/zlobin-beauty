import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { apiRequest } from '@/shared/api/client'
import { OwnerStartPage } from '@/features/owner-home/OwnerStartPage'
import { wallTimeInTimezoneToUtcIso, ymdInTimezone } from '@/shared/lib/time'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    accessToken: 't',
    user: { id: 'u1', display_name: 'Ольга Владелец', email: 'owner1@demo.local', city: 'Красноярск', roles: ['salon_owner'] },
  }),
}))

vi.mock('@/shared/lib/cabinet', () => ({
  useCabinet: () => ({
    kind: 'salon_owner',
    label: 'Владелец салона',
    workType: 'private_practice',
    workTypes: ['private_practice'],
    capabilities: {
      isClient: true,
      isMaster: true,
      isSalonOwner: true,
      isSalonAdmin: false,
      isSalonMasterMember: false,
      isChainOps: false,
      isSupplier: false,
      isSupplierRep: false,
      isPlatformAdmin: false,
      legacyOwnerShell: null,
      identityOwnerClaim: false,
      workFormats: ['private_practice'],
      hasLegacyEmployeeFormat: false,
    },
    interactionMode: 'master',
    setInteractionMode: () => undefined,
    canUseMasterMode: true,
    orgs: [],
    selectedOrg: {
      organization: { id: 'org1', name: 'Аура', city: 'Красноярск' },
      branches: [{ id: 'b1', name: 'Центр', city: 'Красноярск', timezone: 'Asia/Krasnoyarsk' }],
    },
    selectedBranch: { id: 'b1', name: 'Центр', city: 'Красноярск', timezone: 'Asia/Krasnoyarsk' },
    setSelectedOrgId: () => undefined,
    setSelectedBranchId: () => undefined,
    ready: true,
    can: (feature: string) => ['staff', 'reports', 'cosmetics', 'salon_settings', 'calendar'].includes(feature),
    primary: [],
    secondary: [],
    side: [],
  }),
}))

const mockedRequest = vi.mocked(apiRequest)

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <OwnerStartPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: String(query).includes('max-width'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
  mockedRequest.mockImplementation(async (path: string) => {
    if (path === '/v1/notifications' || path === '/v1/notifications/bubbles') {
      return {
        items: [
          {
            id: 'n-appt',
            type: 'appointment.confirmed',
            title: 'Запись подтверждена',
            body: 'Стрижка',
            entity_type: 'appointment',
            entity_id: 'a1',
            read_at: null,
            created_at: '2026-08-30T10:00:00.000Z',
          },
          {
            id: 'n-chat',
            type: 'new_message',
            title: 'Новое сообщение от Анна',
            body: 'Привет',
            entity_type: 'conversation',
            entity_id: 'c1',
            read_at: null,
            created_at: '2026-08-30T11:00:00.000Z',
          },
        ],
      }
    }
    if (path.startsWith('/v1/conversations')) {
      return { items: [] }
    }
    if (path.startsWith('/v1/calendar/appointments')) {
      const tz = 'Asia/Krasnoyarsk'
      const today = ymdInTimezone(new Date(), tz)
      const [y, m, d] = today.split('-').map(Number)
      const startsAt = wallTimeInTimezoneToUtcIso(y, m, d, 10, 0, 0, tz)
      const endsAt = wallTimeInTimezoneToUtcIso(y, m, d, 11, 0, 0, tz)
      const pendingAt = wallTimeInTimezoneToUtcIso(y, m, d, 11, 30, 0, tz)
      return {
        items: [
          {
            id: 'a1',
            service_name: 'Стрижка',
            status: 'confirmed',
            starts_at: startsAt,
            ends_at: endsAt,
            price_minor: 200000,
            client_display_name: 'Мария Козлова',
            master_display_name: 'Анна Смирнова',
            location_timezone: tz,
            location_city: 'Красноярск',
          },
          {
            id: 'a2',
            service_name: 'Окрашивание',
            status: 'pending_confirmation',
            starts_at: pendingAt,
            price_minor: 400000,
            client_display_name: 'Елена Соколова',
            master_display_name: 'Ирина',
            location_timezone: tz,
            location_city: 'Красноярск',
          },
        ],
      }
    }
    if (path.startsWith('/v1/reports/salon')) {
      return { current: { turnover_minor: 1840000, completed_count: 3, master_load_percent: 65 } }
    }
    if (path === '/v1/me/master') {
      return { master: { display_name: 'Ольга Владелец' } }
    }
    return {}
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OwnerStartPage', () => {
  it('shows salon hierarchy, people in bookings, schedule CTA and management tiles', async () => {
    renderPage()
    expect(screen.getByTestId('owner-start-page')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Аура' })).toBeInTheDocument()
    expect(screen.getByText('Владелец')).toBeInTheDocument()
    expect(screen.getByText('Демо-данные')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Мария К.')).toBeInTheDocument())
    expect(screen.getByText(/Стрижка · Анна/)).toBeInTheDocument()
    expect(screen.getByText(/записи ждут подтверждения|запись ждёт подтверждения/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Открыть расписание/ })).toHaveAttribute('href', '/calendar')
    expect(screen.getByRole('link', { name: 'Команда' })).toHaveAttribute('href', '/staff')
    expect(screen.getByRole('link', { name: 'Финансы' })).toHaveAttribute('href', '/reports')
	expect(screen.getByRole('link', { name: 'Склад' })).toHaveAttribute('href', '/inventory')
    expect(screen.getByRole('link', { name: 'Настройки салона' })).toHaveAttribute('href', '/salon/settings')
    expect(screen.queryByText(/Кабинет/i)).toBeNull()
    expect(screen.getByText(/2\s?000\s?₽/)).toBeInTheDocument()
  })

  it('lets the owner pick another day in the week strip', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Мария К.')).toBeInTheDocument())
    const options = screen.getAllByRole('option')
    const other = options.find((el) => el.getAttribute('aria-selected') !== 'true')
    expect(other).toBeTruthy()
    fireEvent.click(other!)
    expect(other).toHaveAttribute('aria-selected', 'true')
  })

  it('notification bubbles expose appointment alert (compact rail)', async () => {
    // Baseline after notifications redesign: rail is <aside>, not a text "notes" region.
    // Appointment alert must remain reachable; chat may also appear as a separate bubble.
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('notification-bubbles')).toBeInTheDocument()
    })
    expect(screen.getByTestId('notif-dot-n-appt')).toHaveAccessibleName(/Запись подтверждена/)
  })
})
