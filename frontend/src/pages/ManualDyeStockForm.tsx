import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { formatUserError } from '@/shared/lib/app-error'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { toast } from '@/shared/ui/Toast'
import { Modal } from '@/shared/ui/Modal'
import {
  clearDyeStockIdemSession,
  dropAppliedDyeIdemLines,
  ensureDyeLineIdemKeys,
  loadDyeStockIdemSession,
  type DyeStockIdemSession,
} from '@/pages/dyeStockIdempotency'

type CatalogProduct = {
  id: string
  brand: string
  name: string
  sku?: string
  unit?: string
  volume_label?: string
  category_id?: string | null
  category?: string
}

type Category = { id: string; name: string; slug?: string }

type Mode = 'master' | 'warehouse'

type Props = {
  open: boolean
  onClose: () => void
  token: string | null | undefined
  organizationId: string
  /** master = POST /v1/me/inventory/adjust; warehouse = stock/movements receipt */
  mode: Mode
  locationId?: string
  /** Prefer these products (org catalog). Falls back to shop catalog. */
  products?: CatalogProduct[]
}

function isDyeProduct(p: CatalogProduct, dyeCategoryId: string | null) {
  if (dyeCategoryId && p.category_id === dyeCategoryId) return true
  const cat = (p.category || '').toLowerCase()
  if (cat.includes('краск') || cat.includes('красител')) return true
  const blob = `${p.brand} ${p.name}`.toLowerCase()
  return blob.includes('краск') || blob.includes('majirel') || blob.includes('красител')
}

/**
 * Manual dye stock entry: pick brand → enter quantities per shade.
 * Uses existing products (category «Краска») and stock movements/adjust — no new entities.
 */
export function ManualDyeStockForm({
  open,
  onClose,
  token,
  organizationId,
  mode,
  locationId,
  products: productsProp,
}: Props) {
  const qc = useQueryClient()
  const [brand, setBrand] = useState('')
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('Ручной приход красителей')
  const [formError, setFormError] = useState<string | null>(null)
  /** Sync lock: button `disabled={isPending}` alone does not stop same-tick double clicks. */
  const submitLock = useRef(false)
  const idemSessionRef = useRef<DyeStockIdemSession | null>(null)
  const restoredRef = useRef(false)

  useEffect(() => {
    if (!open) {
      restoredRef.current = false
      return
    }
    if (restoredRef.current) return
    restoredRef.current = true
    const stored = loadDyeStockIdemSession(mode, organizationId, locationId || '')
    idemSessionRef.current = stored
    if (!stored) return
    if (stored.brand) setBrand(stored.brand)
    if (stored.reason) setReason(stored.reason)
    const restoredQtys: Record<string, string> = {}
    for (const [productId, line] of Object.entries(stored.lines || {})) {
      restoredQtys[productId] = String(line.qty)
    }
    if (Object.keys(restoredQtys).length > 0) setQtys(restoredQtys)
  }, [open, mode, organizationId, locationId])

  const categories = useQuery({
    queryKey: ['product-categories-dye'],
    queryFn: () => apiRequest<{ items: Category[] }>('/v1/commerce/product-categories', { token }),
    enabled: open && Boolean(token),
  })

  const dyeCategoryId = useMemo(() => {
    const items = categories.data?.items ?? []
    const hit = items.find((c) => c.slug === 'kraska' || c.name.toLowerCase().includes('краск'))
    return hit?.id ?? null
  }, [categories.data])

  const shop = useQuery({
    queryKey: ['shop-products-dye-manual'],
    queryFn: () =>
      apiRequest<{ items: CatalogProduct[] }>(`/v1/commerce/shop/products?limit=120`, { token }),
    enabled: open && Boolean(token) && productsProp === undefined && mode === 'master',
  })

  const orgProducts = useQuery({
    queryKey: ['commerce-products-dye-manual', organizationId],
    queryFn: () =>
      apiRequest<{ items: CatalogProduct[] }>(`/v1/commerce/products?organization_id=${organizationId}`, {
        token,
      }),
    enabled: open && Boolean(token && organizationId) && productsProp === undefined && mode === 'warehouse',
  })

  const catalog = useMemo(() => {
    if (productsProp) return productsProp
    if (mode === 'warehouse') return orgProducts.data?.items ?? []
    return shop.data?.items ?? orgProducts.data?.items ?? []
  }, [productsProp, orgProducts.data, shop.data, mode])

  const dyes = useMemo(
    () => catalog.filter((p) => isDyeProduct(p, dyeCategoryId)),
    [catalog, dyeCategoryId],
  )

  const brands = useMemo(() => {
    const set = new Set<string>()
    for (const p of dyes) {
      const b = (p.brand || '').trim()
      if (b) set.add(b)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'))
  }, [dyes])

  const brandProducts = useMemo(() => {
    if (!brand) return [] as CatalogProduct[]
    return dyes.filter((p) => (p.brand || '').trim() === brand)
  }, [dyes, brand])

  const submit = useMutation({
    mutationFn: async () => {
      if (submitLock.current) {
        throw new Error('Сохранение уже выполняется')
      }
      submitLock.current = true
      const applied: string[] = []
      try {
        const reasonTrim = reason.trim()
        if (reasonTrim.length < 2) throw new Error('Укажите причину')
        if (!brand) throw new Error('Выберите бренд')
        const lines: Array<{ product: CatalogProduct; qty: number }> = []
        for (const p of brandProducts) {
          const raw = String(qtys[p.id] ?? '').trim()
          if (!raw) continue
          const qty = Number(raw.replace(',', '.'))
          if (!Number.isFinite(qty) || qty < 0) {
            throw new Error('Количество должно быть числом не меньше нуля')
          }
          if (qty === 0) continue
          lines.push({ product: p, qty })
        }
        if (lines.length === 0) throw new Error('Укажите количество хотя бы для одного оттенка')

        const { session, keysByProduct } = ensureDyeLineIdemKeys(idemSessionRef.current, {
          mode,
          organizationId,
          locationId: locationId || '',
          brand,
          reason: reasonTrim,
          lines: lines.map((l) => ({ productId: l.product.id, qty: l.qty })),
        })
        idemSessionRef.current = session

        for (const line of lines) {
          const idempotencyKey = keysByProduct[line.product.id]
          if (mode === 'warehouse') {
            if (!locationId) throw new Error('Не выбран склад')
            await apiRequest('/v1/commerce/stock/movements', {
              token,
              idempotencyKey,
              body: {
                location_id: locationId,
                product_id: line.product.id,
                kind: 'receipt',
                qty: line.qty,
                reason: reasonTrim,
                idempotency_key: idempotencyKey,
              },
            })
          } else {
            await apiRequest('/v1/me/inventory/adjust', {
              token,
              idempotencyKey,
              body: {
                organization_id: organizationId,
                product_id: line.product.id,
                qty: line.qty,
                reason: reasonTrim,
                idempotency_key: idempotencyKey,
              },
            })
          }
          applied.push(line.product.id)
        }
        return lines.length
      } catch (err) {
        if (applied.length > 0) {
          // Drop already-applied lines so a retry cannot double-post them.
          setQtys((prev) => {
            const next = { ...prev }
            for (const id of applied) delete next[id]
            return next
          })
          idemSessionRef.current = dropAppliedDyeIdemLines(idemSessionRef.current, applied)
          await qc.invalidateQueries({ queryKey: ['me-inventory'] })
          await qc.invalidateQueries({ queryKey: ['commerce-stock'] })
          await qc.invalidateQueries({ queryKey: ['commerce-movements'] })
          const base =
            err instanceof Error && !('status' in err)
              ? err.message
              : formatUserError(err, 'Не удалось внести остаток')
          throw new Error(
            `${base}. Часть позиций уже внесена (${applied.length}). Повторите для оставшихся.`,
          )
        }
        throw err
      } finally {
        submitLock.current = false
      }
    },
    onSuccess: async (count) => {
      setFormError(null)
      toast.success(count === 1 ? 'Позиция внесена на склад' : `Внесено позиций: ${count}`)
      await qc.invalidateQueries({ queryKey: ['me-inventory'] })
      await qc.invalidateQueries({ queryKey: ['commerce-stock'] })
      await qc.invalidateQueries({ queryKey: ['commerce-movements'] })
      clearDyeStockIdemSession(mode, organizationId, locationId || '')
      idemSessionRef.current = null
      setQtys({})
      onClose()
    },
    onError: (e) => {
      setFormError(e instanceof Error && !('status' in e) ? e.message : formatUserError(e, 'Не удалось внести остаток'))
    },
  })

  function close() {
    if (submit.isPending) return
    setFormError(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={close} title="Внести красители на склад">
      <div className="stack" data-testid="manual-dye-stock-form">
        <p className="muted">
          Выберите бренд и укажите количество по оттенкам в единицах каталога (штуки / мл — как у позиции). Остаток
          увеличится через складское движение — без перезаписи «вручную поверх».
        </p>

        {(categories.isError || orgProducts.isError || shop.isError) && (
          <ErrorBanner error={categories.error || orgProducts.error || shop.error} fallbackTitle="Не удалось загрузить каталог" />
        )}
        {formError && <div className="state-box danger" role="alert">{formError}</div>}

        <div className="field">
          <span className="label-text">Бренд</span>
          <div className="chip-row" data-testid="dye-brand" role="group" aria-label="Бренд">
            {brands.map((b) => (
              <button
                key={b}
                type="button"
                className={`chip ${brand === b ? 'active' : ''}`}
                data-testid={`dye-brand-${b}`}
                aria-pressed={brand === b}
                onClick={() => {
                  setBrand(b)
                  setQtys({})
                  clearDyeStockIdemSession(mode, organizationId, locationId || '')
                  idemSessionRef.current = null
                }}
              >
                {b}
              </button>
            ))}
          </div>
          {brands.length === 0 && !orgProducts.isLoading && !shop.isLoading && !categories.isLoading && (
            <p className="hint">В каталоге пока нет товаров категории «Краска». Их добавляет поставщик.</p>
          )}
        </div>

        {brand && brandProducts.length === 0 && (
          <p className="muted">Нет оттенков этого бренда в каталоге красок.</p>
        )}

        {brandProducts.length > 0 && (
          <div className="stack-sm" data-testid="dye-qty-list">
            {brandProducts.map((p) => (
              <div className="field" key={p.id}>
                <label htmlFor={`dye-qty-${p.id}`}>
                  {p.name}
                  {p.volume_label ? ` · ${p.volume_label}` : ''}
                  {p.unit ? ` (${p.unit})` : ''}
                </label>
                <input
                  id={`dye-qty-${p.id}`}
                  data-testid={`dye-qty-${p.id}`}
                  type="number"
                  min="0"
                  step="0.001"
                  inputMode="decimal"
                  placeholder="0"
                  value={qtys[p.id] ?? ''}
                  onChange={(e) => setQtys((prev) => ({ ...prev, [p.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}

        <div className="field">
          <label htmlFor="dye-reason">Причина / комментарий</label>
          <input
            id="dye-reason"
            data-testid="dye-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />
        </div>

        <div className="row gap">
          <button
            className="btn btn-primary"
            type="button"
            data-testid="dye-submit"
            disabled={submit.isPending || !brand}
            onClick={() => {
              setFormError(null)
              submit.mutate()
            }}
          >
            {submit.isPending ? 'Сохраняем…' : 'Внести на склад'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={close} disabled={submit.isPending}>
            Отмена
          </button>
        </div>
      </div>
    </Modal>
  )
}
