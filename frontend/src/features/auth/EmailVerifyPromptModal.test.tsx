import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EmailVerifyPromptModal } from './EmailVerifyPromptModal'

const setPrompt = vi.fn()
let prompt: { status: 'pending' | 'dismissed'; sent?: boolean } = { status: 'pending', sent: true }
let user: { id: string; email: string; email_verified: boolean } | null = {
  id: 'u1',
  email: 'a@example.com',
  email_verified: false,
}

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ accessToken: 'tok', user }),
}))

vi.mock('@/shared/lib/preferences', () => ({
  usePreference: () => [prompt, setPrompt],
}))

vi.mock('@/shared/api/client', () => ({
  apiRequest: vi.fn(async () => ({ message: 'ok' })),
}))

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <EmailVerifyPromptModal />
    </QueryClientProvider>,
  )
}

describe('EmailVerifyPromptModal', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    prompt = { status: 'pending', sent: true }
    user = { id: 'u1', email: 'a@example.com', email_verified: false }
    setPrompt.mockClear()
  })

  it('shows the sent copy and dismisses into the preference', () => {
    wrap()
    expect(screen.getByTestId('email-verify-prompt-modal')).toBeInTheDocument()
    expect(screen.getByText(/Вам отправлено письмо/i)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('email-verify-prompt-dismiss'))
    expect(setPrompt).toHaveBeenCalledWith({ status: 'dismissed', sent: true })
  })

  it('does not claim the letter was sent when sent=false', () => {
    prompt = { status: 'pending', sent: false }
    wrap()
    expect(screen.getByText(/Не удалось автоматически отправить/i)).toBeInTheDocument()
  })

  it('stays closed after dismiss preference', () => {
    prompt = { status: 'dismissed', sent: true }
    wrap()
    expect(screen.queryByTestId('email-verify-prompt-modal')).toBeNull()
  })
})
