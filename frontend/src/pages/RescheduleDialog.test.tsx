import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { apiRequest, ApiError } from '@/shared/api/client'
import { RescheduleDialog } from '@/pages/RescheduleDialog'
import { resetOverlayLockForTests } from '@/shared/ui/overlayLock'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

const mockedRequest = vi.mocked(apiRequest)

const appointment = {
  id: 'appt-1',
  service_name: 'Стрижка',
  starts_at: '2026-09-01T11:00:00.000Z',
  ends_at: '2026-09-01T12:00:00.000Z',
  status: 'confirmed',
  booking_mode: 'flexible',
  location_timezone: 'Europe/Moscow',
  location_name: 'Салон на Мира',
  master_user_id: 'master-1',
}

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <RescheduleDialog open appointment={appointment} token="t" onClose={() => undefined} />
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

describe('RescheduleDialog', () => {
  it('shows a loading state while suggestions load', () => {
    mockedRequest.mockImplementation(() => new Promise(() => undefined) as Promise<never>)
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Перенести запись' })).toBeInTheDocument()
    expect(screen.getByTestId('reschedule-loading')).toHaveTextContent('Ищем подходящее время')
    expect(screen.getByText('Стрижка')).toBeInTheDocument()
  })

  it('shows grouped suggestions and a show-more action', async () => {
    mockedRequest.mockResolvedValue({
      timezone: 'Europe/Moscow',
      horizon_days: 14,
      has_more: true,
      master_display_name: 'Анна Иванова',
      items: [
        { starts_at: '2026-09-01T13:00:00.000Z', ends_at: '2026-09-01T14:00:00.000Z' },
        { starts_at: '2026-09-02T08:00:00.000Z', ends_at: '2026-09-02T09:00:00.000Z' },
      ],
    })
    renderDialog()
    expect(await screen.findByText('Анна Иванова')).toBeInTheDocument()
    expect(screen.getByText('Мы нашли подходящие варианты')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Показать ещё/ })).toBeInTheDocument()
  })

  it('selects a slot and confirms the reschedule', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (String(path).includes('reschedule-options')) {
        return {
          timezone: 'Europe/Moscow',
          horizon_days: 14,
          has_more: false,
          items: [{ starts_at: '2026-09-02T08:00:00.000Z', ends_at: '2026-09-02T09:00:00.000Z' }],
        }
      }
      return { id: 'appt-1', starts_at: '2026-09-02T08:00:00.000Z' }
    })
    renderDialog()
    const slot = await screen.findByRole('radio')
    fireEvent.click(slot)
    expect(screen.getByTestId('reschedule-confirm')).toHaveTextContent('Перенести запись?')
    fireEvent.click(screen.getByRole('button', { name: 'Перенести' }))
    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/v1/appointments/appt-1/reschedule',
        expect.objectContaining({ method: 'POST', body: { starts_at: '2026-09-02T08:00:00.000Z' } }),
      )
    })
  })

  it('returns to suggestions when confirmation is cancelled', async () => {
    mockedRequest.mockResolvedValue({
      timezone: 'Europe/Moscow',
      horizon_days: 14,
      has_more: false,
      items: [{ starts_at: '2026-09-02T08:00:00.000Z', ends_at: '2026-09-02T09:00:00.000Z' }],
    })
    renderDialog()
    fireEvent.click(await screen.findByRole('radio'))
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(await screen.findByRole('radio')).toBeInTheDocument()
    expect(screen.queryByTestId('reschedule-confirm')).not.toBeInTheDocument()
  })

  it('keeps the dialog open on a taken-slot race and asks to pick another', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (String(path).includes('reschedule-options')) {
        return {
          timezone: 'Europe/Moscow',
          horizon_days: 14,
          has_more: false,
          items: [{ starts_at: '2026-09-02T08:00:00.000Z', ends_at: '2026-09-02T09:00:00.000Z' }],
        }
      }
      throw new ApiError('Это время уже занято', 'appointment_time_conflict', 409)
    })
    renderDialog()
    fireEvent.click(await screen.findByRole('radio'))
    fireEvent.click(screen.getByRole('button', { name: 'Перенести' }))
    expect(await screen.findByText('Кто-то успел занять этот слот. Выберите другой вариант.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Выбрать другой вариант' })).toBeInTheDocument()
  })

  it('uses a bottom sheet on compact viewports', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query.includes('767'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
      }),
    })
    mockedRequest.mockImplementation(() => new Promise(() => undefined) as Promise<never>)
    renderDialog()
    expect(document.querySelector('.more-drawer')).toBeTruthy()
    expect(document.querySelector('.reschedule-drawer-panel')).toBeTruthy()
  })

  it('shows an empty state when the backend returns no slots', async () => {
    mockedRequest.mockResolvedValue({
      timezone: 'Europe/Moscow',
      horizon_days: 14,
      has_more: false,
      items: [],
    })
    renderDialog()
    expect(await screen.findByText('Подходящих вариантов пока нет')).toBeInTheDocument()
  })

  it('shows a human error when options fail', async () => {
    mockedRequest.mockRejectedValue(new ApiError('forbidden', 'forbidden', 403))
    renderDialog()
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет доступа')
  })
})
