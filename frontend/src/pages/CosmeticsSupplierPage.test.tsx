import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import { ApiError, apiRequest } from '@/shared/api/client'
import { CosmeticsSupplierPage } from '@/pages/CosmeticsSupplierPage'
import { saveCart } from '@/shared/lib/cart'
import type { CommerceProduct } from '@/shared/lib/commerce'
import { resetOverlayLockForTests } from '@/shared/ui/overlayLock'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

const toastSuccess = vi.fn()
vi.mock('@/shared/ui/Toast', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ accessToken: 't', user: { id: 'u1', roles: ['master'], display_name: 'Мастер' } }),
}))

vi.mock('@/features/messenger/MessengerProvider', () => ({
  useMessenger: () => ({ openChat: vi.fn() }),
}))

vi.mock('@/shared/lib/commerce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/commerce')>()
  return {
    ...actual,
    useBuyerOrg: () => ({
      buyerOrgId: 'buyer-1',
      buyerOrg: {
        organization: { id: 'buyer-1', name: 'Салон', type: 'salon' },
        branches: [{ id: 'br1', name: 'Центр', city: 'Москва', address_line: 'ул. 1', pickup_enabled: true, published: true }],
      },
      orgs: { isLoading: false },
    }),
    useEnsureLocation: () => ({
      locationId: 'loc-1',
      locations: { data: { items: [{ id: 'loc-1' }] }, isLoading: false },
      ensure: { mutateAsync: async () => ({ id: 'loc-1' }) },
    }),
    fetchSupplier: async () => ({ id: 'sup-1', name: 'Estel Pro', city: 'Москва' }),
    fetchPickupBranches: async () => [
      { id: 'br1', name: 'Центр', city: 'Москва', address_line: 'ул. 1', pickup_enabled: true, published: true },
    ],
  }
})

const mockedRequest = vi.mocked(apiRequest)

const product: CommerceProduct = {
  id: 'p1',
  organization_id: 'sup-1',
  brand: 'Estel',
  name: 'Otium Aqua',
  sku: 'OA',
  unit: 'шт',
  volume_label: '250 мл',
  price_minor: 150000,
  currency: 'RUB',
  published: true,
} as CommerceProduct

function OrdersProbe() {
  const [params] = useSearchParams()
  return <div data-testid="orders-page">{params.get('highlight') ?? ''}</div>
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/cosmetics/sup-1']}>
        <Routes>
          <Route path="/cosmetics/:supplierId" element={<CosmeticsSupplierPage />} />
          <Route path="/cosmetics/orders" element={<OrdersProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  toastSuccess.mockReset()
  saveCart('sup-1', [{ product, qty: 2 }])
  mockedRequest.mockImplementation(async (path: string) => {
    if (path.includes('/v1/commerce/products')) return { items: [product] }
    if (path === '/v1/commerce/supplier-orders') {
      return { id: 'ord-9', status: 'new', total_minor: 300000, created_at: new Date().toISOString() }
    }
    throw new Error(`unexpected ${path}`)
  })
})

afterEach(() => {
  cleanup()
  resetOverlayLockForTests()
  vi.clearAllMocks()
})

describe('CosmeticsSupplierPage checkout', () => {
  it('clears the cart, toasts and navigates after a successful order', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Оформить' }))
    fireEvent.click(await screen.findByRole('button', { name: /Центр/ }))
    const confirm = await screen.findByRole('button', { name: 'Подтвердить заказ' })
    await waitFor(() => expect(confirm).not.toBeDisabled())
    fireEvent.click(confirm)
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заказ оформлен'))
    expect(await screen.findByTestId('orders-page')).toHaveTextContent('ord-9')
    expect(sessionStorage.getItem('zb.cosmetics.cart.sup-1')).toBeNull()
  })

  it('keeps the cart and shows a Russian error when create fails', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path.includes('/v1/commerce/products')) return { items: [product] }
      if (path === '/v1/commerce/supplier-orders') {
        throw new ApiError('Недостаточно товара на складе', 'insufficient_stock', 409)
      }
      throw new Error(`unexpected ${path}`)
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Оформить' }))
    fireEvent.click(await screen.findByRole('button', { name: /Центр/ }))
    const confirm = await screen.findByRole('button', { name: 'Подтвердить заказ' })
    await waitFor(() => expect(confirm).not.toBeDisabled())
    fireEvent.click(confirm)
    expect(await screen.findByText('Недостаточно товара на выбранном складе.')).toBeTruthy()
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(JSON.parse(sessionStorage.getItem('zb.cosmetics.cart.sup-1') || '[]')).toHaveLength(1)
  })

  it('removes a line from the checkout cart', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Оформить' }))
    expect(await screen.findByTestId('cart-line')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Удалить Otium Aqua/ }))
    expect(screen.queryByTestId('cart-line')).toBeNull()
  })

  it('ignores a second confirm click while the order is pending', async () => {
    let resolveOrder: (v: unknown) => void = () => undefined
    const pending = new Promise((resolve) => {
      resolveOrder = resolve
    })
    mockedRequest.mockImplementation(async (path: string) => {
      if (path.includes('/v1/commerce/products')) return { items: [product] }
      if (path === '/v1/commerce/supplier-orders') return pending
      throw new Error(`unexpected ${path}`)
    })

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Оформить' }))
    fireEvent.click(await screen.findByRole('button', { name: /Центр/ }))
    const confirm = await screen.findByRole('button', { name: 'Подтвердить заказ' })
    await waitFor(() => expect(confirm).not.toBeDisabled())
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => {
      const orderCalls = mockedRequest.mock.calls.filter((c) => c[0] === '/v1/commerce/supplier-orders')
      expect(orderCalls).toHaveLength(1)
    })
    resolveOrder({ id: 'ord-1', status: 'new', total_minor: 300000, created_at: new Date().toISOString() })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
  })
})
