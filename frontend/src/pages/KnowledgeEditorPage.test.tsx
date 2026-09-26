import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { apiRequest, ApiError } from '@/shared/api/client'
import { KnowledgeEditorPage } from '@/pages/KnowledgeEditorPage'
import { resetOverlayLockForTests } from '@/shared/ui/overlayLock'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

vi.mock('@/features/auth/AuthProvider', () => ({
  hasSupplierAccess: () => true,
  useAuth: () => ({
    accessToken: 't',
    user: { id: 'u1', roles: ['supplier'], display_name: 'Estel Pro' },
  }),
}))

vi.mock('@/shared/lib/commerce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/commerce')>()
  return {
    ...actual,
    useSupplierOrg: () => ({
      supplierOrgId: 'org-s',
      orgs: { isLoading: false },
    }),
  }
})

vi.mock('@/shared/ui/MediaDropzone', () => ({
  MediaDropzone: ({ label }: { label: string }) => <div>{label}</div>,
}))

vi.mock('@/shared/ui/RichDocEditor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/ui/RichDocEditor')>()
  return {
    ...actual,
    RichDocEditor: ({
      value,
      onChange,
    }: {
      value: { type: string; content?: Array<{ content?: Array<{ text?: string }> }> }
      onChange: (doc: unknown) => void
    }) => (
      <textarea
        aria-label="Текст статьи"
        value={value?.content?.[0]?.content?.[0]?.text ?? ''}
        onChange={(e) =>
          onChange({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: e.target.value }] }],
          })
        }
      />
    ),
  }
})

const mockedRequest = vi.mocked(apiRequest)

const article = {
  id: 'art1',
  title: 'Инструкция Otium',
  category: 'Уход',
  brand: 'Estel',
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Шампунь два раза в неделю' }] }],
  },
  content_format: 'doc_json',
  status: 'published',
  published: true,
  product_ids: ['p1'],
  category_ids: [],
  cover_media_id: null,
}

const products = {
  items: [
    { id: 'p1', brand: 'Estel', name: 'Otium Aqua', audience: 'all', category: 'Шампунь' },
    { id: 'p2', brand: 'Loreal', name: 'Majirel', audience: 'professional_only', category: 'Краска' },
  ],
}

function renderEditor(path = '/knowledge/art1/edit') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/knowledge/new" element={<KnowledgeEditorPage />} />
          <Route path="/knowledge/:id/edit" element={<KnowledgeEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  mockedRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
    if (path.endsWith('/archive')) return { ...article, status: 'archived', published: false }
    if (path.endsWith('/unpublish') || path.endsWith('/publish')) return { ...article, status: path.endsWith('/publish') ? 'published' : 'draft' }
    if (opts?.method === 'PUT' || (path === '/v1/knowledge' && opts?.method !== 'GET')) {
      return { ...article, id: 'art1', ...(opts?.body as object) }
    }
    if (path === '/v1/knowledge/art1') return article
    if (path.includes('/v1/commerce/products')) return products
    if (path.includes('/v1/commerce/product-categories')) return { items: [] }
    throw new Error(`unexpected ${path}`)
  })
})

afterEach(() => {
  cleanup()
  resetOverlayLockForTests()
  vi.clearAllMocks()
})

describe('KnowledgeEditorPage', () => {
  it('shows loading skeleton then related product audience', async () => {
    let release: (value: typeof article) => void = () => undefined
    const pending = new Promise<typeof article>((resolve) => {
      release = resolve
    })
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/v1/knowledge/art1') return pending
      if (path.includes('/v1/commerce/products')) return products
      if (path.includes('/v1/commerce/product-categories')) return { items: [] }
      throw new Error(`unexpected ${path}`)
    })
    renderEditor()
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
    release(article)
    await screen.findByTestId('kb-editor')
    expect(screen.getByTestId('kb-related-product').textContent).toContain('Otium Aqua')
    expect(screen.getByTestId('kb-related-product').textContent).toContain('Для домашнего ухода')
    expect(screen.queryByText('all')).toBeNull()
    expect(screen.queryByText('professional_only')).toBeNull()
    expect(screen.getByRole('button', { name: 'Сохранить черновик' })).not.toBeDisabled()
  })

  it('enables save from loaded title and body without extra typing', async () => {
    renderEditor()
    await screen.findByDisplayValue('Инструкция Otium')
    expect(screen.getByRole('button', { name: 'Сохранить черновик' })).not.toBeDisabled()
    expect((screen.getByLabelText('Текст статьи') as HTMLTextAreaElement).value).toContain('Шампунь')
  })

  it('shows empty related products copy on a new article', async () => {
    renderEditor('/knowledge/new')
    await screen.findByTestId('kb-editor')
    expect(screen.getByText('Связанных товаров пока нет')).toBeTruthy()
  })

  it('saves draft through the existing API and shows status copy', async () => {
    renderEditor()
    await screen.findByDisplayValue('Инструкция Otium')
    fireEvent.change(screen.getByLabelText('Текст статьи'), { target: { value: 'Шампунь два раза в неделю и бальзам' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }))
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith(
      '/v1/knowledge/art1',
      expect.objectContaining({
        method: 'PUT',
        body: expect.objectContaining({
          status: 'draft',
          cover_media_id: '',
          product_ids: ['p1'],
        }),
      }),
    ))
    expect(await screen.findByRole('status')).toHaveTextContent('Черновик сохранён')
  })

  it('asks for confirmation before archive', async () => {
    renderEditor()
    await screen.findByTestId('kb-editor')
    fireEvent.click(screen.getByRole('button', { name: 'В архив' }))
    expect(screen.getByRole('dialog', { name: 'Архивировать материал?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('dialog', { name: 'Архивировать материал?' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'В архив' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'В архив' })[1])
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith(
      '/v1/knowledge/art1/archive',
      expect.objectContaining({ method: 'POST' }),
    ))
  })

  it('renders editor error through the shared banner', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/v1/knowledge/art1') throw new ApiError('not found', 'not_found', 404)
      if (path.includes('/v1/commerce/products')) return products
      if (path.includes('/v1/commerce/product-categories')) return { items: [] }
      throw new Error(path)
    })
    renderEditor()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Материал не найден')).toBeTruthy()
  })
})
