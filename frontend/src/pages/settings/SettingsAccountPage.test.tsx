import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsAccountPage } from './SettingsAccountPage'
import { ApiError } from '@/shared/api/client'

const logout = vi.fn(async () => undefined)
const navigate = vi.fn()

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ accessToken: 'tok', logout }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('@/features/pwa/push', () => ({
  disableDevicePush: vi.fn(async () => undefined),
}))

vi.mock('@/shared/ui/Modal', () => ({
  Modal: ({
    open,
    children,
    footer,
    title,
  }: {
    open: boolean
    children: React.ReactNode
    footer?: React.ReactNode
    title?: React.ReactNode
  }) => (open ? (
    <div data-testid="delete-modal">
      <h2>{title}</h2>
      {children}
      {footer}
    </div>
  ) : null),
}))

const apiRequest = vi.fn()
vi.mock('@/shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/shared/api/client')>('@/shared/api/client')
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequest(...args),
  }
})

describe('SettingsAccountPage', () => {
  beforeEach(() => {
    apiRequest.mockReset()
    logout.mockClear()
    navigate.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('requires password confirmation before delete', async () => {
    render(
      <MemoryRouter>
        <SettingsAccountPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTestId('settings-account-delete-open'))
    expect(screen.getByTestId('delete-modal')).toBeInTheDocument()
    expect(screen.getByTestId('settings-account-delete-confirm')).toBeDisabled()

    fireEvent.change(screen.getByTestId('settings-account-delete-password'), { target: { value: 'Password123!' } })
    expect(screen.getByTestId('settings-account-delete-confirm')).not.toBeDisabled()

    apiRequest.mockResolvedValueOnce(undefined)
    fireEvent.click(screen.getByTestId('settings-account-delete-confirm'))
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/v1/auth/account', expect.objectContaining({
      method: 'DELETE',
      body: { password: 'Password123!' },
    })))
    await waitFor(() => expect(logout).toHaveBeenCalled())
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true })
  })

  it('shows owned-organization conflict', async () => {
    render(
      <MemoryRouter>
        <SettingsAccountPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTestId('settings-account-delete-open'))
    fireEvent.change(screen.getByTestId('settings-account-delete-password'), { target: { value: 'Password123!' } })
    apiRequest.mockRejectedValueOnce(new ApiError(
      'cannot delete',
      'account_owned_organizations',
      409,
      { details: { organizations: ['Demo Salon'] } },
    ))
    fireEvent.click(screen.getByTestId('settings-account-delete-confirm'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Demo Salon/))
    expect(logout).not.toHaveBeenCalled()
  })
})
