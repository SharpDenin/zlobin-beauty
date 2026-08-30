import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { apiRequest, ApiError } from '@/shared/api/client'
import { MultiServiceBookingDialog } from '@/pages/MultiServiceBookingDialog'
import { resetOverlayLockForTests } from '@/shared/ui/overlayLock'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

const mockedRequest = vi.mocked(apiRequest)

const first = {
  id: 'cut',
  name: 'Стрижка',
  duration_minutes: 40,
  price_minor: 350000,
  booking_mode: 'flexible',
}

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MultiServiceBookingDialog
          open
          organizationId="org-1"
          firstService={first}
          token="t"
          onClose={() => undefined}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
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
})

afterEach(() => {
  cleanup()
  resetOverlayLockForTests()
  vi.restoreAllMocks()
})

const plansPayload = {
  timezone: 'Asia/Krasnoyarsk',
  total_price_minor: 1000000,
  recommended_order: ['cut', 'color'],
  horizon_days: 7,
  items: [
    {
      starts_at: '2026-09-01T03:00:00.000Z',
      ends_at: '2026-09-01T05:10:00.000Z',
      wait_minutes: 0,
      total_minutes: 130,
      same_master: true,
      legs: [
        {
          service_id: 'cut',
          service_name: 'Стрижка',
          master_id: 'm1',
          master_user_id: 'u1',
          master_display_name: 'Анна',
          starts_at: '2026-09-01T03:00:00.000Z',
          ends_at: '2026-09-01T03:40:00.000Z',
          duration_minutes: 40,
          price_minor: 350000,
        },
        {
          service_id: 'color',
          service_name: 'Окрашивание',
          master_id: 'm1',
          master_user_id: 'u1',
          master_display_name: 'Анна',
          starts_at: '2026-09-01T03:40:00.000Z',
          ends_at: '2026-09-01T05:10:00.000Z',
          duration_minutes: 90,
          price_minor: 650000,
        },
      ],
    },
  ],
}

describe('MultiServiceBookingDialog', () => {
  it('loads salon services then plans after the second pick', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/services?')) {
        return {
          items: [
            { id: 'cut', name: 'Стрижка', duration_minutes: 40, price_minor: 350000 },
            { id: 'color', name: 'Окрашивание', duration_minutes: 90, price_minor: 650000, category: 'колористика' },
          ],
        }
      }
      if (path === '/v1/appointments/plans') return plansPayload
      throw new Error(path)
    })
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Две услуги' })).toBeInTheDocument()
    await screen.findByText('Окрашивание')
    fireEvent.click(screen.getByRole('button', { name: /Окрашивание/ }))
    await screen.findByText('Найденные варианты')
    expect(screen.getAllByText('Анна').length).toBeGreaterThan(0)
  })

  it('shows a loading state while plans calculate', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/services?')) {
        return { items: [{ id: 'color', name: 'Окрашивание', duration_minutes: 90, price_minor: 1 }] }
      }
      if (path === '/v1/appointments/plans') return new Promise(() => undefined) as Promise<never>
      throw new Error(path)
    })
    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: /Окрашивание/ }))
    expect(await screen.findByTestId('visit-plan-loading')).toHaveTextContent('Подбираем мастеров')
  })

  it('shows invalid order copy from the backend', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/services?')) {
        return { items: [{ id: 'color', name: 'Окрашивание', duration_minutes: 90, price_minor: 1 }] }
      }
      if (path === '/v1/appointments/plans') {
        throw new ApiError('Такой порядок процедур недоступен', 'procedure_order_invalid', 409, {
          details: { hint: 'сначала стрижка, затем окрашивание' },
          technicalMessage: 'сначала стрижка, затем окрашивание',
        })
      }
      throw new Error(path)
    })
    renderDialog()
    await screen.findByText('Окрашивание')
    fireEvent.click(screen.getByRole('button', { name: /Окрашивание/ }))
    await screen.findByText('Такой порядок процедур недоступен')
    expect(screen.getByText(/сначала стрижка/)).toBeInTheDocument()
  })

  it('confirms a selected plan', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/services?')) {
        return { items: [{ id: 'color', name: 'Окрашивание', duration_minutes: 90, price_minor: 650000 }] }
      }
      if (path === '/v1/appointments/plans') return plansPayload
      if (path === '/v1/appointments/plans/confirm') return { items: [{ id: 'a1' }, { id: 'a2' }] }
      throw new Error(path)
    })
    renderDialog()
    await screen.findByText('Окрашивание')
    fireEvent.click(screen.getByRole('button', { name: /Окрашивание/ }))
    await screen.findByText('Найденные варианты')
    fireEvent.click(screen.getByRole('radio'))
    await screen.findByTestId('visit-plan-confirm')
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    await waitFor(() => {
      expect(mockedRequest.mock.calls.some((call) => call[0] === '/v1/appointments/plans/confirm')).toBe(true)
    })
  })

  it('shows race copy when a slot is taken', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/services?')) {
        return { items: [{ id: 'color', name: 'Окрашивание', duration_minutes: 90, price_minor: 1 }] }
      }
      if (path === '/v1/appointments/plans') return plansPayload
      if (path === '/v1/appointments/plans/confirm') {
        throw new ApiError('Это время уже занято', 'appointment_time_conflict', 409)
      }
      throw new Error(path)
    })
    renderDialog()
    await screen.findByText('Окрашивание')
    fireEvent.click(screen.getByRole('button', { name: /Окрашивание/ }))
    await screen.findByText('Найденные варианты')
    fireEvent.click(screen.getByRole('radio'))
    fireEvent.click(await screen.findByRole('button', { name: 'Подтвердить' }))
    await screen.findByText('Расписание изменилось')
    expect(screen.getByText(/уже занят/)).toBeInTheDocument()
  })

  it('shows empty copy when no plan exists', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/services?')) {
        return { items: [{ id: 'color', name: 'Окрашивание', duration_minutes: 90, price_minor: 1 }] }
      }
      if (path === '/v1/appointments/plans') {
        return { timezone: 'UTC', total_price_minor: 0, recommended_order: ['cut', 'color'], horizon_days: 7, items: [] }
      }
      throw new Error(path)
    })
    renderDialog()
    await screen.findByText('Окрашивание')
    fireEvent.click(screen.getByRole('button', { name: /Окрашивание/ }))
    await screen.findByText('Не удалось подобрать общее время')
  })
})
