import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { apiRequest } from '@/shared/api/client'
import { OwnerStartPage } from '@/features/owner-home/OwnerStartPage'

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
    workType: 'owner',
    orgs: [],
    selectedOrg: { organization: { id: 'org1', name: 'Аура' }, branches: [] },
    selectedBranch: null,
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
  mockedRequest.mockImplementation(async (path: string) => {
    if (path.startsWith('/v1/calendar/appointments')) {
      const start = new Date()
      start.setHours(10, 0, 0, 0)
      return {
        items: [
          {
            id: 'a1',
            service_name: 'Стрижка',
            status: 'confirmed',
            starts_at: start.toISOString(),
            ends_at: new Date(start.getTime() + 3600000).toISOString(),
            price_minor: 200000,
            client_display_name: 'Мария Козлова',
            master_display_name: 'Анна Смирнова',
          },
          {
            id: 'a2',
            service_name: 'Окрашивание',
            status: 'pending_confirmation',
            starts_at: new Date(start.getTime() + 5400000).toISOString(),
            price_minor: 400000,
            client_display_name: 'Елена Соколова',
            master_display_name: 'Ирина',
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
    expect(screen.getByRole('link', { name: 'Запасы' })).toHaveAttribute('href', '/inventory')
    expect(screen.getByRole('link', { name: 'Настройки' })).toHaveAttribute('href', '/salon/settings')
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
})
