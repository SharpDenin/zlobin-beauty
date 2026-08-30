import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { apiRequest } from '@/shared/api/client'
import { RequireAdmin } from '@/app/layout'
import { AdminDashboardPage } from './AdminDashboardPage'
import { AdminUserDetailPage, AdminUsersPage } from './AdminUsersPage'
import { AdminProductsPage } from './AdminResources'
import { resetOverlayLockForTests } from '@/shared/ui/overlayLock'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

const mockedRequest = vi.mocked(apiRequest)

let authUser: { id: string; roles: string[]; display_name: string } | null = {
  id: 'admin',
  roles: ['system_admin'],
  display_name: 'Админ',
}

vi.mock('@/features/auth/AuthProvider', () => ({
  hasSystemAdmin: (user: { roles?: string[] } | null) => Boolean(user?.roles?.includes('system_admin')),
  useAuth: () => ({ accessToken: authUser ? 't' : null, user: authUser, loading: false }),
}))

function renderAt(path: string, ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin" element={ui} />
          <Route path="/admin/users" element={ui} />
          <Route path="/admin/users/:id" element={ui} />
          <Route path="/admin/products" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('platform admin UI', () => {
  beforeEach(() => {
    authUser = { id: 'admin', roles: ['system_admin'], display_name: 'Админ' }
    mockedRequest.mockReset()
    resetOverlayLockForTests()
  })
  afterEach(() => cleanup())

  it('guards admin routes for non-admins', () => {
    authUser = { id: 'c1', roles: ['client'], display_name: 'Клиент' }
    render(
      <MemoryRouter>
        <RequireAdmin />
      </MemoryRouter>,
    )
    expect(screen.getByText(/системным администраторам/i)).toBeInTheDocument()
  })

  it('renders dashboard KPIs', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/v1/admin/stats') return { users_total: 12, users_active: 11, users_blocked: 1 }
      if (path === '/v1/admin/organizations/stats') return { organizations_total: 4, organizations_active: 4, salons: 3, suppliers: 1 }
      if (path === '/v1/admin/masters/stats') return { masters_total: 5, articles_published: 3, articles_draft: 1 }
      if (path === '/v1/admin/products/stats') return { products_total: 8 }
      if (path === '/v1/admin/disputes/stats') return { disputes_open: 1 }
      if (path.startsWith('/v1/admin/audit-log')) return { items: [{ id: 'a1', action: 'user.blocked', entity_type: 'user', entity_id: 'u2', created_at: '2026-08-30T18:42:00.000Z' }], total: 1, limit: 8, offset: 0 }
      return {}
    })
    renderAt('/admin', <AdminDashboardPage />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Администрирование' })).toBeInTheDocument())
    expect(screen.getAllByText('Пользователи').length).toBeGreaterThan(0)
    expect((await screen.findAllByText('12')).length).toBeGreaterThan(0)
  })

  it('lists users and supports empty state', async () => {
    mockedRequest.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 })
    renderAt('/admin/users', <AdminUsersPage />)
    expect(await screen.findByText('Пользователи не найдены')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }))
  })

  it('paginates user list', async () => {
    mockedRequest.mockResolvedValue({
      items: [{ id: 'u1', display_name: 'Анна', email: 'a@demo.local', roles: ['client'], status: 'active', created_at: '2026-08-01T10:00:00Z' }],
      total: 40,
      limit: 20,
      offset: 0,
    })
    renderAt('/admin/users', <AdminUsersPage />)
    expect((await screen.findAllByText('Анна')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Вперёд' })).toBeEnabled()
  })

  it('opens block confirmation modal', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/v1/admin/users/u2') {
        return { id: 'u2', display_name: 'Клиент', email: 'c@demo.local', roles: ['client'], status: 'active', created_at: '2026-08-01T10:00:00Z' }
      }
      if (path.startsWith('/v1/admin/organizations')) return { items: [], total: 0 }
      if (path.startsWith('/v1/admin/masters')) return { items: [], total: 0 }
      return {}
    })
    renderAt('/admin/users/u2', <AdminUserDetailPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Заблокировать' }))
    expect(await screen.findByText('Заблокировать пользователя')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'спам' } })
    const confirm = screen.getAllByRole('button', { name: 'Заблокировать' }).at(-1)!
    fireEvent.click(confirm)
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith('/v1/admin/users/u2/block', expect.objectContaining({ method: 'POST', body: { reason: 'спам' } })))
  })

  it('shows product list error', async () => {
    mockedRequest.mockRejectedValue(new Error('boom'))
    renderAt('/admin/products', <AdminProductsPage />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('uses card composition for lists', async () => {
    mockedRequest.mockResolvedValue({
      items: [{ id: 'u1', display_name: 'Анна', email: 'a@demo.local', roles: ['client'], status: 'active', created_at: '2026-08-01T10:00:00Z' }],
      total: 1,
      limit: 20,
      offset: 0,
    })
    const { container } = renderAt('/admin/users', <AdminUsersPage />)
    await screen.findAllByText('Анна')
    expect(container.querySelector('.admin-card-list')).toBeTruthy()
    expect(container.querySelector('.admin-table-desktop')).toBeTruthy()
  })
})
