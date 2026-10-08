import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import { apiRequest } from '@/shared/api/client'
import { CatalogTreeAccordion } from '@/features/knowledge/CatalogTree'
import { KnowledgeListPage } from '@/pages/KnowledgeListPage'
import type { KnowledgeCategoryNode } from '@/pages/knowledge-helpers'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

vi.mock('@/features/auth/AuthProvider', () => ({
  hasSupplierAccess: () => false,
  hasMasterAccess: () => true,
  hasSalonAdmin: () => false,
  useAuth: () => ({
    accessToken: 't',
    user: { id: 'u1', roles: ['master'], display_name: 'Мастер' },
  }),
}))

const mockedRequest = vi.mocked(apiRequest)

function UrlProbe() {
  const [params] = useSearchParams()
  return <div data-testid="url-q">{params.get('q') ?? ''}</div>
}

function renderHub(path = '/knowledge') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/knowledge"
            element={
              <>
                <KnowledgeListPage />
                <UrlProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockedRequest.mockImplementation(async (path: string) => {
    if (path.startsWith('/v1/knowledge/facets')) {
      return {
        categories: [{ value: 'Уход за волосами', label: 'Уход за волосами', count: 2 }],
        brands: [],
        suppliers: [],
      }
    }
    if (path.startsWith('/v1/knowledge')) {
      const q = new URL(path, 'http://x').searchParams.get('q') ?? ''
      const items = q
        ? [{ id: 'a1', title: `Hit ${q}`, category: 'Уход за волосами', brand: 'Estel', status: 'published', published: true, favorite: false, product_ids: [], category_ids: [] }]
        : [{ id: 'a0', title: 'Базовый уход', category: 'Уход за волосами', brand: 'Estel', status: 'published', published: true, favorite: false, product_ids: [], category_ids: [] }]
      return { items, total: items.length, limit: 20, offset: 0 }
    }
    if (path.includes('/v1/commerce/product-categories')) return { items: [] }
    if (path.includes('/v1/commerce/shop/products')) return { items: [] }
    throw new Error(`unexpected ${path}`)
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('KnowledgeListPage search', () => {
  it('debounces title search into the URL and shows a result count', async () => {
    renderHub('/knowledge')
    const input = await screen.findByTestId('kb-search')
    fireEvent.change(input, { target: { value: 'Otium' } })
    expect(screen.getByTestId('url-q').textContent).toBe('')
    await waitFor(() => expect(screen.getByTestId('url-q').textContent).toBe('Otium'), { timeout: 2000 })
    expect(await screen.findByText(/Найдено:\s*1/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }))
    await waitFor(() => expect(screen.getByTestId('url-q').textContent).toBe(''))
  })
})

describe('CatalogTreeAccordion', () => {
  const nodes: KnowledgeCategoryNode[] = [
    { name: 'Уход', path: 'Уход', count: 1, children: [{ name: 'Шампуни', path: 'Уход / Шампуни', count: 1, children: [] }] },
  ]

  it('collapses the panel on mobile after a section is chosen', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
        onchange: null,
      }),
    })
    const onSelect = vi.fn()
    const { container } = render(
      <CatalogTreeAccordion nodes={nodes} selected="" onSelect={onSelect} title="Каталог" />,
    )
    const toggle = screen.getByRole('button', { name: /Каталог/ })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(container.querySelector('.kb-catalog')?.classList.contains('is-open')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Уход/ }))
    expect(onSelect).toHaveBeenCalledWith('Уход')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('.kb-catalog')?.classList.contains('is-open')).toBe(false)
  })
})
