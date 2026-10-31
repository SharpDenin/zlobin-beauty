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
  it('renders bubble and hides via PATCH', async () => {
    renderBubbles()
    await waitFor(() => expect(screen.getByTestId('notification-bubbles')).toBeInTheDocument())
    expect(screen.getByText('Новая запись')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Скрыть уведомление'))
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/v1/notifications/n1', expect.objectContaining({ method: 'PATCH', body: { hidden: true } })),
    )
  })

  it('soft-deletes via DELETE', async () => {
    renderBubbles()
    await waitFor(() => expect(screen.getByTestId('notification-bubbles')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Удалить уведомление'))
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/v1/notifications/n1', expect.objectContaining({ method: 'DELETE' })),
    )
  })
})
