import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { Hint } from '@/shared/ui/Hint'
import { resetOverlayLockForTests } from '@/shared/ui/overlayLock'
import '@/shared/ui/styles.css'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ accessToken: 'token' }),
}))

const mockedRequest = vi.mocked(apiRequest)

function renderHints(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  mockedRequest.mockImplementation(async (path: string) => {
    if (path === '/v1/me/hints') {
      return { hints_enabled: true, dismissed: [] as string[] }
    }
    return {}
  })
})

afterEach(() => {
  cleanup()
  resetOverlayLockForTests()
  vi.clearAllMocks()
})

describe('Hint', () => {
  it('opens on trigger click and portals popover to body', async () => {
    renderHints(<Hint id="demo" title="Подсказка">Текст подсказки</Hint>)
    await waitFor(() => expect(screen.getByTestId('hint-demo')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Подсказка' }))
    const pop = await screen.findByTestId('hint-pop-demo')
    expect(pop).toHaveTextContent('Текст подсказки')
    expect(pop.parentElement).toBe(document.body)
    expect(pop.style.position).toBe('fixed')
    expect(pop.style.top).toMatch(/px$/)
  })

  it('closes on outside pointerdown but not on popover click', async () => {
    renderHints(
      <div>
        <button type="button">Снаружи</button>
        <Hint id="out" title="Внешний клик">Содержимое</Hint>
      </div>,
    )
    await waitFor(() => expect(screen.getByTestId('hint-out')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Внешний клик' }))
    expect(await screen.findByTestId('hint-pop-out')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByTestId('hint-pop-out'))
    expect(screen.getByTestId('hint-pop-out')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Снаружи' }))
    await waitFor(() => expect(screen.queryByTestId('hint-pop-out')).toBeNull())
  })

  it('closes on Escape and toggles on repeated trigger click', async () => {
    renderHints(<Hint id="esc" title="Escape">Закрытие</Hint>)
    await waitFor(() => expect(screen.getByTestId('hint-esc')).toBeInTheDocument())
    const trigger = screen.getByRole('button', { name: 'Escape' })
    fireEvent.click(trigger)
    expect(await screen.findByTestId('hint-pop-esc')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('hint-pop-esc')).toBeNull())

    fireEvent.click(trigger)
    expect(await screen.findByTestId('hint-pop-esc')).toBeInTheDocument()
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.queryByTestId('hint-pop-esc')).toBeNull())
  })

  it('keeps only one hint open at a time', async () => {
    renderHints(
      <>
        <Hint id="a" title="Первая">А</Hint>
        <Hint id="b" title="Вторая">Б</Hint>
      </>,
    )
    await waitFor(() => expect(screen.getByTestId('hint-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Первая' }))
    expect(await screen.findByTestId('hint-pop-a')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Вторая' }))
    expect(await screen.findByTestId('hint-pop-b')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('hint-pop-a')).toBeNull())
  })

  it('hides when hints are disabled by preference', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/v1/me/hints') return { hints_enabled: false, dismissed: [] }
      return {}
    })
    renderHints(<Hint id="off" title="Выкл">Нет</Hint>)
    await waitFor(() => expect(screen.queryByTestId('hint-off')).toBeNull())
  })
})
