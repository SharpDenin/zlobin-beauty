import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { apiRequest } from '@/shared/api/client'
import { ContactsPage } from '@/pages/ContactsPage'
import { filterContactsByQuery, roleLabel, roleLabels } from '@/features/contacts/roleLabels'
import { ContactPickerModal } from '@/features/contacts/ContactPickerModal'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ accessToken: 't', user: { id: 'u1', display_name: 'Я' } }),
}))

vi.mock('@/features/messenger/MessengerProvider', () => ({
  useMessengerOptional: () => ({
    open: vi.fn(),
    start: vi.fn(),
    openList: vi.fn(),
    close: vi.fn(),
    overlayOpen: false,
    overlayConversationId: null,
    unreadTotal: 0,
    isDesktop: true,
  }),
}))

const mockedRequest = vi.mocked(apiRequest)

const contact = {
  id: 'ct1',
  user_id: 'u2',
  display_name: 'Анна Волкова',
  roles: ['master'],
  city: 'Красноярск',
  avatar_media_id: null,
  note: '',
  conversation_id: 'c1',
  created_at: '2026-09-01T10:00:00.000Z',
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ContactsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
  mockedRequest.mockImplementation(async (path: string) => {
    if (path.startsWith('/v1/contacts/search')) {
      return {
        items: [
          {
            id: 'u3',
            display_name: 'Иван Белов',
            roles: ['master'],
            city: 'Новосибирск',
            avatar_media_id: null,
            already_added: false,
          },
        ],
      }
    }
    if (path.startsWith('/v1/contacts')) return { items: [contact], total: 1, limit: 100, offset: 0 }
    throw new Error(`unexpected ${path}`)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('role labels', () => {
  it('maps known roles to Russian', () => {
    expect(roleLabel('client')).toBe('клиент')
    expect(roleLabel('master')).toBe('мастер')
    expect(roleLabel('salon_owner')).toBe('владелец салона')
    expect(roleLabel('salon_admin')).toBe('администратор салона')
    expect(roleLabel('supplier')).toBe('поставщик')
    expect(roleLabel('supplier_rep')).toBe('представитель поставщика')
    expect(roleLabels(['client', 'master'])).toEqual(['клиент', 'мастер'])
  })
})

describe('filterContactsByQuery', () => {
  it('filters by name and city', () => {
    const items = [
      contact,
      { ...contact, id: 'ct2', display_name: 'Павел', city: 'Москва' },
    ]
    expect(filterContactsByQuery(items, 'анна')).toHaveLength(1)
    expect(filterContactsByQuery(items, 'москва')).toHaveLength(1)
    expect(filterContactsByQuery(items, '')).toHaveLength(2)
  })
})

describe('ContactsPage', () => {
  it('renders contacts list', async () => {
    renderPage()
    expect(await screen.findByTestId('contacts-list')).toBeTruthy()
    expect(await screen.findByText('Анна Волкова')).toBeTruthy()
    expect(screen.getByText('мастер')).toBeTruthy()
  })

  it('filters list via sticky search', async () => {
    renderPage()
    await screen.findByText('Анна Волкова')
    fireEvent.change(screen.getByLabelText('Найти в контактах'), { target: { value: 'zzz' } })
    await waitFor(() => expect(screen.queryByText('Анна Волкова')).toBeNull())
    expect(screen.getByText('Никого не нашли')).toBeTruthy()
  })
})

describe('ContactPickerModal', () => {
  it('shows address book contacts', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ContactPickerModal open onClose={() => undefined} />
        </QueryClientProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('picker-contact-ct1')).toBeTruthy()
    expect(screen.getByText('Анна Волкова')).toBeTruthy()
  })
})
