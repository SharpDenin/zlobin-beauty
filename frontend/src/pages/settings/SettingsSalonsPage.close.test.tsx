import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { SettingsSalonsPage } from './SettingsSalonsPage'

const apiRequest = vi.fn()

vi.mock('@/shared/api/client', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ accessToken: 'tok', user: { id: 'u1' } }),
}))

vi.mock('@/shared/lib/cabinet', () => ({
  useCabinet: () => ({
    setSelectedOrgId: vi.fn(),
    selectedOrg: null,
  }),
}))

vi.mock('@/shared/lib/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/shared/lib/commerce')>('@/shared/lib/commerce')
  return {
    ...actual,
    useMyOrgs: () => ({
      isLoading: false,
      isError: false,
      error: null,
      data: {
        items: [
          {
            organization: {
              id: 'org1',
              name: 'Салон Тест',
              type: 'salon',
              published: true,
              city: 'Москва',
            },
            roles: ['owner'],
            branches: [
              {
                id: 'br1',
                name: 'Филиал Центр с очень длинным названием для проверки переноса',
                city: 'Москва',
                address_line: 'ул. Тверская 1',
                phone: '+79001112233',
                published: true,
                active: true,
              },
            ],
          },
        ],
      },
      refetch: vi.fn(),
    }),
  }
})

vi.mock('@/shared/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SettingsSalonsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SettingsSalonsPage branch close', () => {
  beforeEach(() => {
    cleanup()
    apiRequest.mockReset()
    apiRequest.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (String(url).includes('/readiness')) {
        return { ready: true, missing: [], checks: [] }
      }
      if (String(url).includes('/close/preflight')) {
        return {
          branch_id: 'br1',
          branch_name: 'Филиал Центр с очень длинным названием для проверки переноса',
          organization_name: 'Салон Тест',
          active: true,
          already_closed: false,
          future_appointments: 2,
          masters_affected: 1,
          last_active_branch: true,
          will_unpublish_org: true,
          contact_phone: '+79001112233',
          contact_source: 'branch',
          contact_display: '+79001112233',
          can_close: true,
          blockers: [],
        }
      }
      if (String(url).includes('/close') && opts?.method === 'POST') {
        return {
          id: 'job1',
          status: 'completed',
          org_unpublished: true,
          result: { cancelled_appointments: 2 },
        }
      }
      return {}
    })
  })

  it('opens modal, loads preflight, requires confirm, then closes', async () => {
    renderPage()
    fireEvent.click(screen.getByTestId('settings-manage-salon'))
    const closeBtn = await screen.findByTestId('settings-close-branch')
    expect(closeBtn).toHaveStyle({ minWidth: '44px', minHeight: '44px' })
    fireEvent.click(closeBtn)
    await screen.findByTestId('branch-close-preflight')
    expect(screen.getByText(/Будущих записей к отмене: 2/)).toBeInTheDocument()
    expect(screen.getByTestId('branch-close-last-branch')).toBeInTheDocument()
    const submit = screen.getByTestId('branch-close-submit')
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByTestId('branch-close-confirm'))
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await waitFor(() => expect(screen.getByTestId('branch-close-result')).toBeInTheDocument())
    expect(screen.getByText(/Филиал закрыт/)).toBeInTheDocument()
  })

  it('shows blockers and disables close', async () => {
    apiRequest.mockImplementation(async (url: string) => {
      if (String(url).includes('/readiness')) {
        return { ready: true, missing: [], checks: [] }
      }
      if (String(url).includes('/close/preflight')) {
        return {
          branch_id: 'br1',
          branch_name: 'Филиал',
          organization_name: 'Салон',
          active: true,
          already_closed: false,
          future_appointments: 0,
          masters_affected: 0,
          last_active_branch: false,
          will_unpublish_org: false,
          contact_phone: '',
          contact_source: 'none',
          contact_display: 'Свяжитесь с салоном через приложение',
          can_close: false,
          blockers: [{ code: 'active_chair_leases', label: 'Активные аренды кресел', count: 1 }],
        }
      }
      return {}
    })
    renderPage()
    fireEvent.click(screen.getByTestId('settings-manage-salon'))
    fireEvent.click(await screen.findByTestId('settings-close-branch'))
    await screen.findByTestId('branch-close-blockers')
    expect(screen.queryByTestId('branch-close-submit')).not.toBeInTheDocument()
    expect(screen.getByText(/Активные аренды кресел: 1/)).toBeInTheDocument()
  })
})
