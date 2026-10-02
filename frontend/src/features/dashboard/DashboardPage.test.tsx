import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { apiRequest } from '@/shared/api/client'
import { DashboardPage } from '@/pages/DashboardPage'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    accessToken: 't',
    user: { id: 'u1', display_name: 'Алексей Петров', city: 'Москва', roles: ['master'] },
  }),
}))

vi.mock('@/shared/lib/cabinet', () => ({
  useCabinet: () => ({
    kind: 'private_master',
    label: 'Частный мастер',
    workType: 'independent',
    master: { display_name: 'Алексей Петров', city: 'Москва', work_type: 'independent' },
    orgs: [],
    selectedOrg: null,
    selectedBranch: null,
    setSelectedOrgId: () => undefined,
    setSelectedBranchId: () => undefined,
    ready: true,
    can: (feature: string) => ['calendar', 'clients', 'services', 'cosmetics', 'analytics'].includes(feature),
    primary: [],
    secondary: [],
    side: [],
  }),
}))

vi.mock('@/pages/CalendarPage', () => ({
  CalendarPage: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="calendar-embedded">{embedded ? 'embedded-calendar' : 'calendar'}</div>
  ),
}))

vi.mock('react-grid-layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-grid-layout')>()
  return {
    ...actual,
    useContainerWidth: () => ({
      width: 1200,
      containerRef: { current: null },
      mounted: true,
    }),
  }
})

const mockedRequest = vi.mocked(apiRequest)

const defaultWidgets = [
  { id: 'alerts', enabled: true, positions: { lg: { x: 0, y: 0, w: 12, h: 5 } } },
  { id: 'calendar', enabled: true, positions: { lg: { x: 0, y: 5, w: 12, h: 18 } } },
  { id: 'today', enabled: true, positions: { lg: { x: 0, y: 23, w: 3, h: 4 } } },
  { id: 'pending', enabled: true, positions: { lg: { x: 3, y: 23, w: 3, h: 4 } } },
  { id: 'upcoming', enabled: true, positions: { lg: { x: 0, y: 27, w: 6, h: 8 } } },
  { id: 'analytics', enabled: true, positions: { lg: { x: 6, y: 27, w: 6, h: 8 } } },
]

function mockApis() {
  mockedRequest.mockImplementation(async (path: string) => {
    if (path === '/v1/me/dashboard') return { widgets: defaultWidgets }
    if (path === '/v1/me/subscription') {
      return { status: 'trial', trial_ends_at: '2026-12-01T00:00:00.000Z', effective_plan: 'premium' }
    }
    if (path === '/v1/me/master') {
      return {
        master: {
          display_name: 'Алексей Петров',
          city: 'Москва',
          work_type: 'independent',
          published: true,
          profession_types: [{ id: '1', slug: 'colorist', name: 'Колорист' }],
          rating_avg: 4.9,
          rating_count: 12,
        },
      }
    }
    if (path.startsWith('/v1/appointments/mine') || path.startsWith('/v1/calendar/appointments')) {
      return {
        items: [
          {
            id: 'a1',
            service_name: 'Стрижка',
            status: 'confirmed',
            starts_at: new Date().toISOString(),
            ends_at: new Date(Date.now() + 3600000).toISOString(),
            price_minor: 200000,
            client_user_id: 'c1',
          },
        ],
      }
    }
    if (path.startsWith('/v1/notifications')) return { items: [] }
    if (path.startsWith('/v1/planner/blocks')) return { items: [] }
    if (path.startsWith('/v1/commerce/supplier-orders')) return { items: [] }
    return {}
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <DashboardPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }),
  })
  mockedRequest.mockReset()
  mockApis()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DashboardPage', () => {
  it('shows Главная hierarchy without Кабинет, and clients-today inside analytics', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('dashboard-hero')).toBeInTheDocument())
    expect(screen.getByText('Главная')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Сегодня' })).toBeInTheDocument()
    expect(screen.getByText('Частный мастер', { selector: '.dashboard-page-head .muted' })).toBeInTheDocument()
    expect(screen.queryByText(/Кабинет/i)).toBeNull()
    expect(document.querySelector('.trial-banner')).toBeNull()
    expect(screen.getByTestId('dashboard-premium-pill')).toHaveTextContent(/Пробный период до|Premium|Free/)

    const analytics = await screen.findByTestId('dashboard-analytics')
    expect(within(analytics).getByTestId('analytics-clients-today')).toHaveTextContent('Клиенты сегодня')
    // Клиенты сегодня must not appear as a standalone metric tile widget.
    expect(document.querySelector('[data-widget="clients_today"]')).toBeNull()
    expect(screen.queryByText('Клиенты сегодня', { selector: '.dashboard-metric span' })).toBeNull()
  })

  it('view mode has no drag handles; edit mode shows them and sticky bar', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('dashboard-edit')).toBeInTheDocument())
    expect(screen.queryByTestId('drag-handle-alerts')).toBeNull()
    expect(screen.queryByTestId('dashboard-edit-bar')).toBeNull()

    fireEvent.click(screen.getByTestId('dashboard-edit'))
    expect(screen.getByTestId('dashboard-edit-bar')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-edit-active')).toBeInTheDocument()
    expect(screen.getByTestId('drag-handle-alerts')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-page').className).toContain('dashboard-page--editing')
  })

  it('cancel discards draft layout changes', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('dashboard-edit')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('dashboard-edit'))

    const alertsToggle = screen.getByLabelText('Важное') as HTMLInputElement
    expect(alertsToggle.checked).toBe(true)
    fireEvent.click(alertsToggle)
    expect(alertsToggle.checked).toBe(false)

    fireEvent.click(screen.getByTestId('dashboard-cancel'))
    expect(window.confirm).toHaveBeenCalled()
    expect(screen.queryByTestId('dashboard-edit-bar')).toBeNull()

    fireEvent.click(screen.getByTestId('dashboard-edit'))
    expect((screen.getByLabelText('Важное') as HTMLInputElement).checked).toBe(true)
  })
})
