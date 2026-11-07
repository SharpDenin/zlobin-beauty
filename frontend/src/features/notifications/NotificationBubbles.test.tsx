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

const appointmentNotif = {
  id: 'n1',
  type: 'appointment.confirmed',
  title: 'Новая запись',
  body: 'Клиент подтвердил',
  entity_type: 'appointment',
  entity_id: 'a1',
  read_at: null,
  created_at: '2026-08-30T10:00:00.000Z',
}

const chatNotifs = [
  {
    id: 'm1',
    type: 'new_message',
    title: 'Новое сообщение от Анна',
    body: 'раз',
    entity_type: 'conversation',
    entity_id: 'c1',
    read_at: null,
    created_at: '2026-08-30T10:00:00.000Z',
  },
  {
    id: 'm2',
    type: 'new_message',
    title: 'Новое сообщение от Анна',
    body: 'два',
    entity_type: 'conversation',
    entity_id: 'c1',
    read_at: null,
    created_at: '2026-08-30T11:00:00.000Z',
  },
  {
    id: 'm3',
    type: 'new_message',
    title: 'Новое сообщение от Борис',
    body: 'привет',
    entity_type: 'conversation',
    entity_id: 'c2',
    read_at: null,
    created_at: '2026-08-30T10:30:00.000Z',
  },
]

function mockCompactMatchMedia(compact: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: compact ? String(query).includes('max-width') : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

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
  mockCompactMatchMedia(true)
  mockedRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path === '/v1/notifications/bubbles' && !opts?.method) {
      return { items: [appointmentNotif] }
    }
    if (path.startsWith('/v1/conversations') && !opts?.method) {
      return { items: [] }
    }
    if (path === '/v1/notifications/n1' && opts?.method === 'PATCH') return undefined
    if (path === '/v1/notifications/n1' && opts?.method === 'DELETE') return undefined
    if (path === '/v1/notifications/n1/read') return undefined
    if (path.startsWith('/v1/notifications/') && opts?.method === 'PATCH') return undefined
    if (path.startsWith('/v1/notifications/') && opts?.method === 'DELETE') return undefined
    if (path.endsWith('/read')) return undefined
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

  it('mobile compact: collapses when pointer lands outside', async () => {
    renderBubbles()
    await waitFor(() => expect(screen.getByTestId('notif-dot-n1')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('notif-dot-n1'))
    expect(screen.getByText('Новая запись')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByText('Новая запись')).not.toBeInTheDocument())
  })

  it('mobile compact: click inside panel does not collapse', async () => {
    renderBubbles()
    await waitFor(() => expect(screen.getByTestId('notif-dot-n1')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('notif-dot-n1'))
    const panel = screen.getByRole('dialog')
    fireEvent.pointerDown(panel)
    expect(screen.getByText('Новая запись')).toBeInTheDocument()
  })

  it('groups chat notifications into one bubble per conversation with unread count', async () => {
    mockedRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === '/v1/notifications/bubbles' && !opts?.method) {
        return { items: chatNotifs }
      }
      if (path.startsWith('/v1/conversations') && !opts?.method) {
        return {
          items: [
            { id: 'c1', type: 'client_master', peer_name: 'Анна', unread_count: 4, updated_at: '', participants: [] },
            { id: 'c2', type: 'client_master', peer_name: 'Борис', unread_count: 1, updated_at: '', participants: [] },
          ],
        }
      }
      throw new Error(`unexpected ${path}`)
    })
    renderBubbles()
    await waitFor(() => expect(screen.getByTestId('notification-bubbles')).toBeInTheDocument())
    expect(screen.getByTestId('notif-dot-m2')).toBeInTheDocument()
    expect(screen.getByTestId('notif-dot-m3')).toBeInTheDocument()
    expect(screen.queryByTestId('notif-dot-m1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('notif-dot-m2'))
    expect(screen.getByText('два')).toBeInTheDocument()
    expect(screen.getByLabelText('4 непрочитанных')).toBeInTheDocument()
  })

  it('desktop cards show title without expand', async () => {
    mockCompactMatchMedia(false)
    renderBubbles()
    await waitFor(() => expect(screen.getByTestId('notification-bubbles')).toBeInTheDocument())
    expect(screen.getByTestId('notification-bubbles')).not.toHaveAttribute('data-compact')
    expect(screen.getByText('Новая запись')).toBeInTheDocument()
  })
})
