import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { apiRequest } from '@/shared/api/client'
import { MessengerApp } from '@/features/messenger/MessengerApp'
import { resetOverlayLockForTests } from '@/shared/ui/overlayLock'
import { Overlay } from '@/shared/ui/Overlay'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ accessToken: 't', user: { id: 'u1', display_name: 'Екатерина' } }),
}))

vi.mock('@/shared/lib/cabinet', () => ({
  useCabinet: () => ({ kind: 'client' }),
}))

const mockedRequest = vi.mocked(apiRequest)

const conversation = {
  id: 'c1',
  type: 'client_master',
  peer_name: 'Анна Волкова',
  unread_count: 1,
  updated_at: '2026-08-30T10:00:00.000Z',
  last_message: { id: 'm0', sender_user_id: 'u2', kind: 'text', body: 'Добрый день', created_at: '2026-08-30T10:00:00.000Z' },
  participants: [
    { user_id: 'u1', display_name: 'Екатерина', role: 'client' },
    { user_id: 'u2', display_name: 'Анна Волкова', role: 'master' },
  ],
}

function renderApp(conversationId: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onSelect = vi.fn()
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MessengerApp mode="page" conversationId={conversationId} onSelectConversation={onSelect} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return { ...view, onSelect, client }
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
  mockedRequest.mockReset()
  mockedRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
    if (path.startsWith('/v1/conversations/c1/messages') && opts?.method === 'POST') {
      const body = (opts.body as { body?: string })?.body ?? ''
      if (body.includes('FAIL')) throw new Error('network')
      return {
        id: 'm-new',
        sender_user_id: 'u1',
        kind: 'text',
        body,
        created_at: new Date().toISOString(),
      }
    }
    if (path.startsWith('/v1/conversations/c1/messages')) {
      return {
        items: [
          { id: 'm1', sender_user_id: 'u2', kind: 'text', body: 'Добрый день', created_at: '2026-08-30T10:00:00.000Z' },
        ],
        has_more: false,
      }
    }
    if (path === '/v1/conversations/c1/read') return undefined
    if (path === '/v1/conversations/c1') return conversation
    if (path.startsWith('/v1/conversations')) return { items: [conversation] }
    throw new Error(`unexpected ${path}`)
  })
})

afterEach(() => {
  cleanup()
  resetOverlayLockForTests()
  vi.restoreAllMocks()
})

describe('MessengerApp', () => {
  it('renders conversation list with unread and last message', async () => {
    renderApp()
    expect(await screen.findByTestId('conversations-list')).toBeTruthy()
    expect(await screen.findByText('Анна Волкова')).toBeTruthy()
    expect(screen.getByText('Добрый день')).toBeTruthy()
    expect(screen.getByLabelText('1 непрочитанных')).toBeTruthy()
  })

  it('opens a chat and sends text', async () => {
    renderApp('c1')
    const history = await screen.findByTestId('message-history')
    await waitFor(() => {
      expect(history).toHaveTextContent('Добрый день')
    })
    fireEvent.change(screen.getByTestId('message-composer'), { target: { value: 'Хотела уточнить по тонированию' } })
    fireEvent.click(screen.getByTestId('send-message'))
    await waitFor(() => {
      expect(history).toHaveTextContent('Хотела уточнить по тонированию')
    })
  })

  it('keeps failed text and allows retry', async () => {
    let attempts = 0
    mockedRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path.startsWith('/v1/conversations/c1/messages') && opts?.method === 'POST') {
        attempts += 1
        if (attempts === 1) throw new Error('network')
        return {
          id: 'm-retry',
          sender_user_id: 'u1',
          kind: 'text',
          body: (opts.body as { body?: string })?.body ?? '',
          created_at: new Date().toISOString(),
        }
      }
      if (path.startsWith('/v1/conversations/c1/messages')) {
        return { items: [], has_more: false }
      }
      if (path === '/v1/conversations/c1/read') return undefined
      if (path === '/v1/conversations/c1') return conversation
      if (path.startsWith('/v1/conversations')) return { items: [conversation] }
      throw new Error(`unexpected ${path}`)
    })
    renderApp('c1')
    await screen.findByTestId('message-composer')
    fireEvent.change(screen.getByTestId('message-composer'), { target: { value: 'Сохранить текст' } })
    fireEvent.click(screen.getByTestId('send-message'))
    expect(await screen.findByText('Повторить')).toBeTruthy()
    expect(screen.getByText('Сохранить текст')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => {
      expect(screen.queryByText('Повторить')).toBeNull()
    })
  })

  it('shows empty state with a client action', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/conversations')) return { items: [] }
      throw new Error(path)
    })
    renderApp()
    expect(await screen.findByText('Пока нет сообщений')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Напишите мастеру' })).toHaveAttribute('href', '/search')
  })

  it('previews a selected image before send', async () => {
    renderApp('c1')
    await screen.findByTestId('message-composer')
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['hello'], 'tone.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByRole('button', { name: 'Убрать файл' })).toBeTruthy()
    expect(screen.getByAltText('Предпросмотр')).toBeTruthy()
  })

  it('previews a selected video before send', async () => {
    renderApp('c1')
    await screen.findByTestId('message-composer')
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByRole('button', { name: 'Убрать файл' })).toBeTruthy()
    expect(document.querySelector('.composer-preview video')).toBeTruthy()
  })

  it('shows loading and human-readable list error', async () => {
    mockedRequest.mockImplementation(() => new Promise(() => {}))
    renderApp()
    expect(await screen.findByText('Загрузка…')).toBeTruthy()
    cleanup()
    mockedRequest.mockReset()
    mockedRequest.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    renderApp()
    expect(await screen.findByText('Сервис временно недоступен')).toBeTruthy()
    expect(screen.queryByText('NetworkError')).toBeNull()
    expect(screen.queryByText('500')).toBeNull()
  })

  it('does not send an empty message', async () => {
    renderApp('c1')
    await screen.findByTestId('message-composer')
    expect(screen.getByTestId('send-message')).toBeDisabled()
  })
})

describe('desktop messenger overlay', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <Overlay open onClose={onClose} label="Сообщения" className="modal-backdrop overlay-scrim messenger-overlay">
        <div className="messenger-panel">панель</div>
      </Overlay>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
