import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SettingsLayout } from './SettingsLayout'

describe('SettingsLayout', () => {
  it('redirects /settings to appearance and keeps section nav', () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="appearance" element={<div data-testid="appearance-outlet">Оформление</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('settings-page')).toBeInTheDocument()
    expect(screen.getByTestId('appearance-outlet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Оформление' })).toHaveAttribute('href', '/settings/appearance')
    expect(screen.getByRole('link', { name: 'Уведомления' })).toHaveAttribute('href', '/settings/notifications')
    expect(screen.getByRole('link', { name: 'Мои салоны' })).toHaveAttribute('href', '/settings/salons')
    expect(screen.getByRole('link', { name: 'Аккаунт' })).toHaveAttribute('href', '/settings/account')
  })
})
