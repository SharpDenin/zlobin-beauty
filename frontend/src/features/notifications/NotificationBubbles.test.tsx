import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { apiRequest } from '@/shared/api/client'
import { NotificationBubbles } from '@/features/notifications/NotificationBubbles'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ accessToken: 't', user: { id: 'u1' } }),
}))

const mockedRequest = vi.mocked(apiRequest)

function renderBubbles() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <NotificationBubbles />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
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
  mockedRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path === '/v1/notifications/bubbles' && !opts?.method) {
      return {
        items: [
          {
            id: 'n1',
            type: 'info',
            title: 'Новая запись',
            body: 'Клиент подтвердил',
            entity_type: 'appointment',
            entity_id: 'a1',
            read_at: null,
            created_at: '2026-08-30T10:00:00.000Z',
          },
        ],
      }
    }
    if (path === '/v1/notifications/n1' && opts?.method === 'PATCH') return undefined
    if (path === '/v1/notifications/n1' && opts?.method === 'DELETE') return undefined
    if (path === '/v1/notifications/n1/read') return undefined
    throw new Error(`unexpected ${path} ${opts?.method}`)
  })
})

afterEach(() => {
  cleanup()
})

describe('NotificationBubbles', () => {
  it('mobile compact: expands dot then hides via PATCH', async () => {
    renderBubbles()
    await waitFor(() => expect(screen.getByTestId('notification-bubbles')).toHaveAttribute('data-compact', 'true'))
    expect(screen.queryByText('Новая запись')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('notif-dot-n1'))
    expect(screen.getByText('Новая запись')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Скрыть уведомление'))
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/v1/notifications/n1', expect.objectContaining({ method: 'PATCH', body: { hidden: true } })),
    )
  })

  it('mobile compact: soft-deletes via DELETE after expand', async () => {
    renderBubbles()
    await waitFor(() => expect(screen.getByTestId('notif-dot-n1')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('notif-dot-n1'))
    fireEvent.click(screen.getByLabelText('Удалить уведомление'))
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/v1/notifications/n1', expect.objectContaining({ method: 'DELETE' })),
    )
  })

  it('desktop cards show title without expand', async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    renderBubbles()
    await waitFor(() => expect(screen.getByTestId('notification-bubbles')).toBeInTheDocument())
    expect(screen.getByTestId('notification-bubbles')).not.toHaveAttribute('data-compact')
    expect(screen.getByText('Новая запись')).toBeInTheDocument()
  })
})
