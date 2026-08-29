import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary'

function Boom() {
  throw new Error('TypeError: cannot read properties of undefined')
  return null
}

describe('ErrorBoundary', () => {
  it('shows a human recovery screen without the stack', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Что-то пошло не так')
    expect(screen.getByRole('button', { name: 'Обновить страницу' })).toBeInTheDocument()
    expect(screen.queryByText(/TypeError|undefined/i)).toBeNull()
    spy.mockRestore()
    warn.mockRestore()
  })
})
