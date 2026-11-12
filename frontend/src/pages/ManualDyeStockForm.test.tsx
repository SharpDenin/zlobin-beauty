import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/shared/api/client'
import { ManualDyeStockForm } from '@/pages/ManualDyeStockForm'
import { resetOverlayLockForTests } from '@/shared/ui/overlayLock'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

vi.mock('@/shared/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockedRequest = vi.mocked(apiRequest)

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ManualDyeStockForm
        open
        onClose={() => undefined}
        token="t"
        organizationId="11111111-1111-4111-8111-111111111001"
        mode="master"
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  mockedRequest.mockImplementation(async (path: string) => {
    if (path.includes('/product-categories')) {
      return { items: [{ id: 'cat-kraska', name: 'Краска', slug: 'kraska' }] }
    }
    if (path.includes('/shop/products')) {
      return {
        items: [
          { id: 'p1', brand: "L'Oreal", name: 'Majirel 7.1', unit: 'pcs', volume_label: '60 мл', category_id: 'cat-kraska' },
          { id: 'p2', brand: "L'Oreal", name: 'Majirel 6.0', unit: 'pcs', volume_label: '60 мл', category_id: 'cat-kraska' },
          { id: 'p3', brand: 'Wella', name: 'Koleston 7/1', unit: 'pcs', category_id: 'cat-kraska' },
          { id: 'p4', brand: 'Loreal', name: 'Шампунь', unit: 'pcs', category_id: 'other' },
        ],
      }
    }
    if (path.includes('/me/inventory/adjust')) {
      return { id: 'mov-1' }
    }
    return { items: [] }
  })
})

afterEach(() => {
  cleanup()
  resetOverlayLockForTests()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('ManualDyeStockForm', () => {
  it('requires brand and positive qty, then posts adjust per shade', async () => {
    renderForm()
    await waitFor(() => expect(screen.getByTestId('dye-brand-Wella')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('dye-brand-L\'Oreal'))
    await waitFor(() => expect(screen.getByTestId('dye-qty-p1')).toBeInTheDocument())
    expect(screen.getByLabelText(/Majirel 7\.1 · 60 мл \(pcs\)/i)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('dye-brand-Wella'))
    await waitFor(() => expect(screen.getByTestId('dye-qty-p3')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('dye-submit'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/количество/i))

    fireEvent.change(screen.getByTestId('dye-qty-p3'), { target: { value: '-1' } })
    fireEvent.click(screen.getByTestId('dye-submit'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/не меньше нуля|количество/i))

    fireEvent.change(screen.getByTestId('dye-qty-p3'), { target: { value: '2' } })
    fireEvent.click(screen.getByTestId('dye-submit'))

    await waitFor(() => {
      const adjusts = mockedRequest.mock.calls.filter(([path]) => String(path).includes('/me/inventory/adjust'))
      expect(adjusts).toHaveLength(1)
      expect(adjusts[0][1]).toMatchObject({
        idempotencyKey: expect.any(String),
        body: expect.objectContaining({
          product_id: 'p3',
          qty: 2,
          idempotency_key: expect.any(String),
        }),
      })
      expect((adjusts[0][1] as { idempotencyKey: string }).idempotencyKey).toBe(
        (adjusts[0][1] as { body: { idempotency_key: string } }).body.idempotency_key,
      )
    })
  })

  it('reuses the same idempotency key for a failed line retry', async () => {
    let adjustCalls = 0
    mockedRequest.mockImplementation(async (path: string) => {
      if (path.includes('/product-categories')) {
        return { items: [{ id: 'cat-kraska', name: 'Краска', slug: 'kraska' }] }
      }
      if (path.includes('/shop/products')) {
        return {
          items: [{ id: 'p3', brand: 'Wella', name: 'Koleston 7/1', unit: 'pcs', category_id: 'cat-kraska' }],
        }
      }
      if (path.includes('/me/inventory/adjust')) {
        adjustCalls += 1
        if (adjustCalls === 1) throw Object.assign(new Error('network'), { status: 0 })
        return { id: 'mov-2' }
      }
      return { items: [] }
    })

    renderForm()
    await waitFor(() => expect(screen.getByTestId('dye-brand-Wella')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('dye-brand-Wella'))
    fireEvent.change(screen.getByTestId('dye-qty-p3'), { target: { value: '2' } })
    fireEvent.click(screen.getByTestId('dye-submit'))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('dye-submit'))
    await waitFor(() => expect(adjustCalls).toBe(2))
    const adjusts = mockedRequest.mock.calls.filter(([path]) => String(path).includes('/me/inventory/adjust'))
    const key1 = (adjusts[0][1] as { idempotencyKey: string }).idempotencyKey
    const key2 = (adjusts[1][1] as { idempotencyKey: string }).idempotencyKey
    expect(key1).toBeTruthy()
    expect(key2).toBe(key1)
  })

  it('clears applied lines after partial multi-shade failure', async () => {
    let adjustCalls = 0
    mockedRequest.mockImplementation(async (path: string) => {
      if (path.includes('/product-categories')) {
        return { items: [{ id: 'cat-kraska', name: 'Краска', slug: 'kraska' }] }
      }
      if (path.includes('/shop/products')) {
        return {
          items: [
            { id: 'p1', brand: "L'Oreal", name: 'Majirel 7.1', unit: 'pcs', volume_label: '60 мл', category_id: 'cat-kraska' },
            { id: 'p2', brand: "L'Oreal", name: 'Majirel 6.0', unit: 'pcs', volume_label: '60 мл', category_id: 'cat-kraska' },
          ],
        }
      }
      if (path.includes('/me/inventory/adjust')) {
        adjustCalls += 1
        if (adjustCalls === 1) return { id: 'mov-1' }
        throw Object.assign(new Error('boom'), { status: 500 })
      }
      return { items: [] }
    })

    renderForm()
    await waitFor(() => expect(screen.getByTestId('dye-brand-L\'Oreal')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('dye-brand-L\'Oreal'))
    await waitFor(() => expect(screen.getByTestId('dye-qty-p1')).toBeInTheDocument())
    fireEvent.change(screen.getByTestId('dye-qty-p1'), { target: { value: '1' } })
    fireEvent.change(screen.getByTestId('dye-qty-p2'), { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('dye-submit'))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/уже внесена/i))
    expect(adjustCalls).toBe(2)
    expect((screen.getByTestId('dye-qty-p1') as HTMLInputElement).value).toBe('')
    expect((screen.getByTestId('dye-qty-p2') as HTMLInputElement).value).toBe('3')
  })

  it('ignores a second submit while the first is in flight', async () => {
    let adjustCalls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockedRequest.mockImplementation(async (path: string) => {
      if (path.includes('/product-categories')) {
        return { items: [{ id: 'cat-kraska', name: 'Краска', slug: 'kraska' }] }
      }
      if (path.includes('/shop/products')) {
        return {
          items: [{ id: 'p3', brand: 'Wella', name: 'Koleston 7/1', unit: 'pcs', category_id: 'cat-kraska' }],
        }
      }
      if (path.includes('/me/inventory/adjust')) {
        adjustCalls += 1
        await gate
        return { id: 'mov-1' }
      }
      return { items: [] }
    })

    renderForm()
    await waitFor(() => expect(screen.getByTestId('dye-brand-Wella')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('dye-brand-Wella'))
    fireEvent.change(screen.getByTestId('dye-qty-p3'), { target: { value: '2' } })
    fireEvent.click(screen.getByTestId('dye-submit'))
    await waitFor(() => expect(adjustCalls).toBe(1))
    fireEvent.click(screen.getByTestId('dye-submit'))
    release()
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(adjustCalls).toBe(1)
  })

  it('posts warehouse receipt movements', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    mockedRequest.mockImplementation(async (path: string) => {
      if (path.includes('/product-categories')) {
        return { items: [{ id: 'cat-kraska', name: 'Краска', slug: 'kraska' }] }
      }
      if (path.includes('/stock/movements')) return { id: 'mov-w' }
      return { items: [] }
    })
    render(
      <QueryClientProvider client={client}>
        <ManualDyeStockForm
          open
          onClose={() => undefined}
          token="t"
          organizationId="11111111-1111-4111-8111-111111111001"
          mode="warehouse"
          locationId="loc-1"
          products={[
            { id: 'p1', brand: 'Wella', name: 'Koleston 7/1', unit: 'pcs', category_id: 'cat-kraska' },
          ]}
        />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('dye-brand-Wella')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('dye-brand-Wella'))
    fireEvent.change(screen.getByTestId('dye-qty-p1'), { target: { value: '4' } })
    fireEvent.click(screen.getByTestId('dye-submit'))
    await waitFor(() => {
      const calls = mockedRequest.mock.calls.filter(([path]) => String(path).includes('/stock/movements'))
      expect(calls).toHaveLength(1)
      expect(calls[0][1]).toMatchObject({
        idempotencyKey: expect.any(String),
        body: expect.objectContaining({
          kind: 'receipt',
          qty: 4,
          product_id: 'p1',
          location_id: 'loc-1',
          idempotency_key: expect.any(String),
        }),
      })
    })
  })
})
