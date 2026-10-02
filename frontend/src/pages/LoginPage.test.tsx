import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from '@/pages/LoginPage'
import { clearSessionEnded, markSessionEnded, peekSessionEnded } from '@/features/pwa/pwa'

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ login: vi.fn() }),
  homePathForUser: () => '/',
}))

vi.mock('@/shared/ui/ThemeToggle', () => ({
  ThemeToggle: () => null,
}))

describe('LoginPage session notice', () => {
  beforeEach(() => {
    clearSessionEnded()
  })

  it('does not scare on an ordinary visit', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('session-expired-notice')).toBeNull()
  })

  it('shows a one-shot notice after a real expiry and consumes the flag', () => {
    markSessionEnded()
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('session-expired-notice')).toHaveTextContent('Сессия завершилась. Войдите снова.')
    expect(peekSessionEnded()).toBe(false)
  })
})
