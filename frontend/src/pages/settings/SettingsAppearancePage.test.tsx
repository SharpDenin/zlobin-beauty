import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ accessToken: 'tok', user: { id: '1' } }),
}))

vi.mock('@/shared/lib/preferences', () => ({
  usePreference: () => [{ source: 'system', id: 'forest-water' }, vi.fn()],
}))

vi.mock('@/shared/ui/ThemeToggle', () => ({
  ThemeToggle: () => <div role="radiogroup" aria-label="Тема оформления" />,
}))

vi.mock('@/shared/theme/backgrounds', async () => {
  const actual = await vi.importActual<typeof import('@/shared/theme/backgrounds')>('@/shared/theme/backgrounds')
  return {
    ...actual,
    useHomeBackground: () => ({ ...actual.HOME_BACKGROUNDS[0], source: 'system' as const }),
    setHomeBackground: vi.fn(),
    hydrateCustomBackground: vi.fn(async () => undefined),
    preferenceFromStorage: () => ({ source: 'system', id: 'forest-water' }),
  }
})

import { SettingsAppearancePage } from './SettingsAppearancePage'

describe('SettingsAppearancePage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders theme toggle and system wallpaper options', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SettingsAppearancePage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('radiogroup', { name: 'Тема оформления' })).toBeInTheDocument()
    expect(screen.getByTestId('settings-bg-forest-water')).toBeInTheDocument()
    expect(screen.getByTestId('settings-bg-mist-canyon')).toBeInTheDocument()
    expect(screen.getByTestId('settings-bg-pebble-shore')).toBeInTheDocument()
    expect(screen.getByTestId('settings-bg-upload')).toBeInTheDocument()
  })
})
