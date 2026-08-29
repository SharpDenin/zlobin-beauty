import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'

afterEach(() => {
  cleanup()
})

describe('ErrorBanner', () => {
  it('renders title and hint for a known code', () => {
    render(
      <ErrorBanner
        error={{ code: 'appointment_time_conflict', status: 409, message: 'selected time is not available' }}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Это время уже занято')
    expect(screen.getByRole('alert')).toHaveTextContent('другое время')
    expect(screen.getByRole('alert').textContent).not.toMatch(/409|Conflict|selected time/i)
  })

  it('maps field-level validation near the banner text', () => {
    render(
      <ErrorBanner
        error={{
          code: 'validation_error',
          status: 400,
          message: 'validation failed',
          details: { fields: { name: 'Укажите название услуги', price_minor: 'Стоимость должна быть больше 0.' } },
        }}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Название')
    expect(screen.getByRole('alert')).toHaveTextContent('Стоимость должна быть больше 0.')
    expect(screen.getByRole('alert').textContent).not.toMatch(/validation failed/i)
  })
})
