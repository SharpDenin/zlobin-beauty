import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { apiRequest } from '@/shared/api/client'
import { toast } from '@/shared/ui/Toast'
import { ProfilePage } from '@/pages/ProfilePage'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    accessToken: 't',
    user: {
      id: 'u1',
      display_name: 'Клиент',
      email: 'client@demo.local',
      city: 'Красноярск',
      roles: ['client'],
      email_verified: true,
    },
    updateUser: vi.fn(),
    logout: vi.fn(),
  }),
}))

vi.mock('@/shared/lib/cabinet', () => ({
  useCabinet: () => ({
    kind: 'client',
    workTypes: [],
    capabilities: { isMaster: false, isSalonOwner: false, isSupplier: false },
    canUseMasterMode: false,
    interactionMode: 'client',
    setInteractionMode: vi.fn(),
    master: null,
  }),
}))

vi.mock('@/shared/ui/Toast', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

vi.mock('@/shared/lib/useFormDraft', () => ({
  useFormDraft: () => ({ clear: vi.fn() }),
}))

const mockedRequest = vi.mocked(apiRequest)

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ProfilePage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    if (path === '/v1/auth/me' && init?.method === 'PATCH') {
      return {
        id: 'u1',
        display_name: (init.body as { display_name: string }).display_name,
        city: (init.body as { city?: string }).city ?? '',
        email: 'client@demo.local',
        phone: null,
        roles: ['client'],
        status: 'active',
        email_verified: true,
      }
    }
    return {}
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UI-06 ProfilePage save confirmation', () => {
  it('toasts only after a successful profile save', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Анна' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Профиль сохранён'))
    expect(screen.getByText('Профиль сохранён')).toBeInTheDocument()
  })

  it('does not toast when save fails', async () => {
    mockedRequest.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/v1/auth/me' && init?.method === 'PATCH') {
        throw new Error('fail')
      }
      if (path === '/v1/me/hints') return { hints_enabled: true, dismissed: [] }
      if (path === '/v1/me/subscription') return { status: 'none', effective_plan: 'free' }
      return {}
    })
    renderPage()
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Анна' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.getByText(/Не удалось сохранить профиль/i)).toBeInTheDocument())
    expect(toast.success).not.toHaveBeenCalled()
  })
})
