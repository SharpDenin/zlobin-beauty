import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest, ApiError, API_BASE_URL, apiErrorFromResponse, networkApiError } from '@/shared/api/client'
import { userError } from '@/shared/lib/app-error'
import { hasSupplierAccess, hasSupplierRepAccess, useAuth } from '@/features/auth/AuthProvider'
import { fetchSuppliers } from '@/shared/lib/commerce'
import { statusLabel } from '@/shared/lib/status'
import { MediaImage } from '@/shared/ui/MediaImage'
import { Hint } from '@/shared/ui/Hint'

type OrgItem = {
  organization: { id: string; name: string }
}

type Location = { id: string; name: string; kind: string }
type StockItem = {
  product_id: string
  brand: string
  product_name: string
  available: number
  qty_reserved?: number
  qty_incoming?: number
  status: string
  min_stock: number
  price_minor: number
  photo_media_id?: string | null
}

type Movement = {
  id: string
  kind: string
  qty: number
  reason: string
  product_id: string
  created_at: string
}

type ForecastItem = {
  product_id: string
  product_name: string
  available: number
  min_stock: number
  demand: number
  deficit: number
  explanation: string
}

const productSchema = z.object({
  name: z.string().min(2),
  brand: z.string().optional(),
  sku: z.string().optional(),
  price_rubles: z.coerce.number().min(0),
  min_stock: z.coerce.number().min(0),
  unit: z.string().min(1),
  volume_label: z.string().optional(),
  parent_id: z.string().optional(),
})

const receiptSchema = z.object({
  product_id: z.string().uuid(),
  qty: z.coerce.number().positive(),
  reason: z.string().min(2),
})

const supplierOrderSchema = z.object({
  supplier_org_id: z.string().uuid(),
  product_id: z.string().uuid(),
  qty: z.coerce.number().positive(),
  comment: z.string().optional(),
})

const normSchema = z.object({
  service_id: z.string().uuid(),
  product_id: z.string().uuid(),
  qty: z.coerce.number().positive(),
  required: z.boolean(),
})

type NormItem = {
  id: string
  service_id: string
  product_id: string
  qty: number
  required: boolean
}

type MasterService = { id: string; name: string }

export function WarehousePage() {
  const { accessToken, user } = useAuth()
  const supplierMode = hasSupplierAccess(user)
  const repMode = hasSupplierRepAccess(user) && !supplierMode
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [locationId, setLocationId] = useState('')
  const [stockQ, setStockQ] = useState('')
  const [stockStatus, setStockStatus] = useState('')

  const orgs = useQuery({
    queryKey: ['orgs-mine'],
    queryFn: () => apiRequest<{ items: OrgItem[] }>('/v1/organizations/mine', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const orgId = orgs.data?.items[0]?.organization.id

  const locations = useQuery({
    queryKey: ['commerce-locations', orgId],
    queryFn: () => apiRequest<{ items: Location[] }>(`/v1/commerce/locations?organization_id=${orgId}`, { token: accessToken }),
    enabled: Boolean(accessToken && orgId),
  })

  const products = useQuery({
    queryKey: ['commerce-products', orgId],
    queryFn: () => apiRequest<{ items: Array<{ id: string; name: string; brand: string; parent_id: string | null; volume_label: string; unit: string }> }>(`/v1/commerce/products?organization_id=${orgId}`, { token: accessToken }),
    enabled: Boolean(accessToken && orgId),
  })

  const units = useQuery({
    queryKey: ['commerce-units'],
    queryFn: () => apiRequest<{ items: Array<{ code: string; name: string }> }>('/v1/commerce/units', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const masterServices = useQuery({
    queryKey: ['master-services'],
    queryFn: () => apiRequest<{ services: MasterService[] }>('/v1/me/master', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const [normServiceId, setNormServiceId] = useState('')

  const norms = useQuery({
    queryKey: ['commerce-norms', orgId, normServiceId],
    queryFn: () => {
      const qs = normServiceId ? `&service_id=${normServiceId}` : ''
      return apiRequest<{ items: NormItem[] }>(`/v1/commerce/norms?organization_id=${orgId}${qs}`, { token: accessToken })
    },
    enabled: Boolean(accessToken && orgId),
  })

  const stock = useQuery({
    queryKey: ['commerce-stock', locationId],
    queryFn: () => apiRequest<{ items: StockItem[] }>(`/v1/commerce/stock?location_id=${locationId}`, { token: accessToken }),
    enabled: Boolean(accessToken && locationId),
  })
  const movements = useQuery({
    queryKey: ['commerce-movements', locationId],
    queryFn: () => apiRequest<{ items: Movement[] }>(`/v1/commerce/stock/movements?location_id=${locationId}`, { token: accessToken }),
    enabled: Boolean(accessToken && locationId && (supplierMode || repMode)),
  })

  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => fetchSuppliers(accessToken),
    enabled: Boolean(accessToken),
  })

  const forecast = useQuery({
    queryKey: ['commerce-forecast', locationId],
    queryFn: () => {
      const from = new Date()
      const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000)
      return apiRequest<{ items: ForecastItem[] }>(
        `/v1/commerce/stock/forecast?location_id=${locationId}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
        { token: accessToken },
      )
    },
    enabled: Boolean(accessToken && locationId),
  })

  useEffect(() => {
    if (!locationId && locations.data?.items[0]?.id) {
      setLocationId(locations.data.items[0].id)
    }
  }, [locationId, locations.data])

  const productForm = useForm<z.infer<typeof productSchema>>({
    resolver: zodResolver(productSchema),
    defaultValues: { unit: 'pcs', price_rubles: 0, min_stock: 5 },
  })
  const receiptForm = useForm<z.infer<typeof receiptSchema>>({ resolver: zodResolver(receiptSchema) })
  const supplierOrderForm = useForm<z.infer<typeof supplierOrderSchema>>({ resolver: zodResolver(supplierOrderSchema) })
  const normForm = useForm<z.infer<typeof normSchema>>({
    resolver: zodResolver(normSchema),
    defaultValues: { required: true, qty: 1 },
  })

  const ensureLocation = useMutation({
    mutationFn: async (): Promise<{ id?: string }> => {
      if (!orgId) throw new ApiError('Сначала создайте салон', 'validation_error', 400)
      return apiRequest<{ id?: string }>('/v1/commerce/locations', {
        token: accessToken,
        body: { organization_id: orgId, name: 'Основной склад', kind: 'salon' },
      })
    },
    onSuccess: async (res) => {
      setOk('Склад создан')
      await qc.invalidateQueries({ queryKey: ['commerce-locations'] })
      if (res.id) setLocationId(res.id)
    },
    onError: (e) => setError(userError(e, 'Не удалось изменить склад')),
  })

  const createProduct = useMutation({
    mutationFn: (v: z.infer<typeof productSchema>) =>
      apiRequest('/v1/commerce/products', {
        token: accessToken,
        body: {
          organization_id: orgId,
          name: v.name,
          brand: v.brand ?? '',
          sku: v.sku ?? '',
          unit: v.unit,
          volume_label: v.volume_label ?? '',
          parent_id: v.parent_id || undefined,
          price_minor: Math.round(v.price_rubles * 100),
          min_stock: v.min_stock,
          published: true,
        },
      }),
    onSuccess: async () => {
      setOk('Товар создан')
      productForm.reset({ name: '', brand: '', sku: '', unit: 'pcs', volume_label: '', parent_id: '', price_rubles: 0, min_stock: 5 })
      await qc.invalidateQueries({ queryKey: ['commerce-products'] })
    },
    onError: (e) => setError(userError(e, 'Не удалось сохранить товар')),
  })

  const receipt = useMutation({
    mutationFn: (v: z.infer<typeof receiptSchema>) =>
      apiRequest('/v1/commerce/stock/movements', {
        token: accessToken,
        body: { location_id: locationId, product_id: v.product_id, kind: 'receipt', qty: v.qty, reason: v.reason },
      }),
    onSuccess: async () => {
      setOk('Приёмка записана, остаток обновлён')
      receiptForm.reset()
      await qc.invalidateQueries({ queryKey: ['commerce-stock'] })
      await qc.invalidateQueries({ queryKey: ['commerce-movements'] })
    },
    onError: (e) => setError(userError(e, 'Не удалось принять поставку')),
  })

  const createSupplierOrder = useMutation({
    mutationFn: (v: z.infer<typeof supplierOrderSchema>) =>
      apiRequest('/v1/commerce/supplier-orders', {
        token: accessToken,
        body: {
          buyer_org_id: orgId,
          supplier_org_id: v.supplier_org_id,
          location_id: locationId,
          comment: v.comment ?? 'Заказ по критическому остатку',
          items: [{ product_id: v.product_id, qty: v.qty }],
        },
      }),
    onSuccess: async () => {
      setOk('Заказ поставщику создан')
      supplierOrderForm.reset()
      await qc.invalidateQueries({ queryKey: ['commerce-supplier-orders'] })
    },
    onError: (e) => setError(userError(e, 'Не удалось изменить заказ')),
  })

  const createNorm = useMutation({
    mutationFn: (v: z.infer<typeof normSchema>) =>
      apiRequest('/v1/commerce/norms', {
        token: accessToken,
        body: {
          organization_id: orgId,
          service_id: v.service_id,
          product_id: v.product_id,
          qty: v.qty,
          required: v.required,
        },
      }),
    onSuccess: async () => {
      setOk('Норма расхода сохранена')
      normForm.reset({ required: true, qty: 1 })
      await qc.invalidateQueries({ queryKey: ['commerce-norms'] })
    },
    onError: (e) => setError(userError(e, 'Не удалось сохранить норму')),
  })

  const criticalItems = stock.data?.items.filter((s) => s.status === 'critical' || s.status === 'out') ?? []
  const [csvText, setCsvText] = useState('sku,brand,name,unit,price_rubles,min_stock,qty_on_hand\n')
  const [importJobId, setImportJobId] = useState<string | null>(null)
  const [importReport, setImportReport] = useState<string | null>(null)

  const validateImport = useMutation({
    mutationFn: async () => {
      let res: Response
      try {
        res = await fetch(`${API_BASE_URL}/v1/commerce/imports/products/validate?organization_id=${orgId}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'text/csv',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: csvText,
        })
      } catch (cause) {
        throw networkApiError(cause)
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw apiErrorFromResponse(data, res.status)
      }
      return data as { id: string; status: string; report: { errors?: unknown[]; preview?: unknown[]; row_count?: number } }
    },
    onSuccess: (data) => {
      setImportJobId(data.id)
      setImportReport(JSON.stringify(data.report, null, 2))
      setOk(`Импорт проверен (${data.report.row_count ?? 0} строк). Подтвердите применение.`)
      setError(null)
    },
    onError: (e) => setError(userError(e, 'Не удалось проверить файл')),
  })

  const applyImport = useMutation({
    mutationFn: () => {
      if (!importJobId) throw new ApiError('Сначала проверьте файл', 'validation_error', 400)
      const qs = activeLoc ? `?location_id=${activeLoc}` : ''
      return apiRequest(`/v1/commerce/imports/${importJobId}/apply${qs}`, {
        method: 'POST',
        token: accessToken,
        body: activeLoc ? { location_id: activeLoc } : {},
      })
    },
    onSuccess: async () => {
      setOk('Импорт применён транзакционно')
      setImportJobId(null)
      await qc.invalidateQueries({ queryKey: ['commerce-products'] })
      await qc.invalidateQueries({ queryKey: ['commerce-stock'] })
    },
    onError: (e) => setError(userError(e, 'Не удалось применить импорт')),
  })

  if (orgs.isLoading) return <div className="page state-box">Загрузка…</div>
  if (!orgId) {
    return (
      <main className="page">
        <div className="state-box">Сначала создайте салон в кабинете мастера</div>
      </main>
    )
  }

  const activeLoc = locationId || locations.data?.items[0]?.id || ''

  return (
    <main className="page stack">
      <div className="row between">
        <h1>Склад</h1>
        <Hint id="supplier-warehouse" title="Остатки">Остатки, резерв и статусы товаров. Представитель видит доступность для визитов.</Hint>
        {(supplierMode || repMode) && <Link className="btn btn-secondary" to={supplierMode ? '/supplier' : '/rep'}>Панель</Link>}
      </div>
      <p className="muted">{repMode ? 'Состояние запаса для визитов и доставок.' : 'Остатки, резерв и движения по складу.'}</p>
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      <section className="card stack">
        <h2>Место хранения</h2>
        {locations.data && locations.data.items.length === 0 && (
          <button className="btn btn-primary" type="button" disabled={ensureLocation.isPending} onClick={() => ensureLocation.mutate()}>
            Создать основной склад
          </button>
        )}
        {locations.data && locations.data.items.length > 0 && (
          <div className="field">
            <label htmlFor="loc">Склад</label>
            <select
              id="loc"
              value={activeLoc}
              onChange={(e) => setLocationId(e.target.value)}
            >
              {locations.data.items.map((l) => (
                <option key={l.id} value={l.id}>{l.name} ({l.kind})</option>
              ))}
            </select>
          </div>
        )}
      </section>

      {!supplierMode && !repMode && (
      <section className="card stack">
        <h2>Новый товар</h2>
        <form className="stack" onSubmit={productForm.handleSubmit((v) => createProduct.mutate(v))}>
          <div className="field"><label>Название</label><input {...productForm.register('name')} /></div>
          <div className="field"><label>Бренд</label><input {...productForm.register('brand')} /></div>
          <div className="field"><label>Артикул</label><input {...productForm.register('sku')} /></div>
          <div className="field">
            <label>Ед. изм.</label>
            {units.data && units.data.items.length > 0 ? (
              <select {...productForm.register('unit')}>
                {units.data.items.map((u) => (
                  <option key={u.code} value={u.code}>{u.name} ({u.code})</option>
                ))}
              </select>
            ) : (
              <input {...productForm.register('unit')} />
            )}
          </div>
          <div className="field"><label>Объём / вариант</label><input {...productForm.register('volume_label')} placeholder="100 мл" /></div>
          <div className="field">
            <label>Вариант от товара (опционально)</label>
            <select {...productForm.register('parent_id')}>
              <option value="">Корневой товар</option>
              {products.data?.items.filter((p) => !p.parent_id).map((p) => (
                <option key={p.id} value={p.id}>{p.brand} {p.name}{p.volume_label ? ` · ${p.volume_label}` : ''}</option>
              ))}
            </select>
          </div>
          <div className="field"><label>Цена, ₽</label><input type="number" {...productForm.register('price_rubles')} /></div>
          <div className="field"><label>Мин. остаток</label><input type="number" {...productForm.register('min_stock')} /></div>
          <button className="btn btn-primary btn-block" type="submit" disabled={createProduct.isPending}>Создать товар</button>
        </form>
      </section>
      )}

      {!supplierMode && !repMode && (
      <section className="card stack">
        <h2>Нормы расхода</h2>
        <p className="muted">Списание со склада при завершении записи (по нормам услуги).</p>
        <div className="field">
          <label>Фильтр по услуге</label>
          <select value={normServiceId} onChange={(e) => setNormServiceId(e.target.value)}>
            <option value="">Все услуги</option>
            {masterServices.data?.services.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <form className="stack" onSubmit={normForm.handleSubmit((v) => createNorm.mutate(v))}>
          <div className="field">
            <label>Услуга</label>
            <select {...normForm.register('service_id')}>
              <option value="">Выберите</option>
              {masterServices.data?.services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Товар</label>
            <select {...normForm.register('product_id')}>
              <option value="">Выберите</option>
              {products.data?.items.map((p) => (
                <option key={p.id} value={p.id}>{p.brand} {p.name}</option>
              ))}
            </select>
          </div>
          <div className="field"><label>Количество</label><input type="number" step="0.001" {...normForm.register('qty')} /></div>
          <label className="row"><input type="checkbox" {...normForm.register('required')} /> Обязательная норма</label>
          <button className="btn btn-primary btn-block" type="submit" disabled={createNorm.isPending}>Сохранить норму</button>
        </form>
        <div className="list">
          {norms.data?.items.map((n) => {
            const svc = masterServices.data?.services.find((s) => s.id === n.service_id)
            const prod = products.data?.items.find((p) => p.id === n.product_id)
            return (
              <article key={n.id} className="list-item">
                <strong>{svc?.name ?? n.service_id}</strong>
                <p>{prod ? `${prod.brand} ${prod.name}` : n.product_id} · {n.qty} {n.required ? '(обяз.)' : '(опц.)'}</p>
              </article>
            )
          })}
        </div>
      </section>
      )}

      {activeLoc && !repMode && (
        <section className="card stack">
          <h2>Приёмка (начальный / пополнение)</h2>
          <form className="stack" onSubmit={receiptForm.handleSubmit((v) => {
            setLocationId(activeLoc)
            receipt.mutate(v)
          })}>
            <div className="field">
              <label>Товар</label>
              <select {...receiptForm.register('product_id')}>
                <option value="">Выберите</option>
                {products.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>{p.brand} {p.name}</option>
                ))}
              </select>
            </div>
            <div className="field"><label>Количество</label><input type="number" step="0.001" {...receiptForm.register('qty')} /></div>
            <div className="field"><label>Причина</label><input {...receiptForm.register('reason')} placeholder="Начальная приёмка" /></div>
            <button className="btn btn-primary btn-block" type="submit" disabled={receipt.isPending || !activeLoc}>Принять на склад</button>
          </form>
        </section>
      )}

      <section className="card stack">
        <h2>Остатки</h2>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Поиск</label>
            <input value={stockQ} onChange={(e) => setStockQ(e.target.value)} placeholder="Товар или бренд" />
          </div>
          <div className="field">
            <label>Статус</label>
            <select value={stockStatus} onChange={(e) => setStockStatus(e.target.value)}>
              <option value="">Все</option>
              <option value="sufficient">Достаточный запас</option>
              <option value="low">Низкий запас</option>
              <option value="critical">Критично</option>
              <option value="out">Нет в наличии</option>
            </select>
          </div>
        </div>
        {!activeLoc && <div className="state-box">Выберите или создайте склад</div>}
        {stock.isLoading && <div className="state-box">Загрузка…</div>}
        {stock.data && stock.data.items.length === 0 && <div className="state-box">Остатков нет — выполните приёмку</div>}
        <div className="product-grid">
          {stock.data?.items
            .filter((s) => {
              const q = stockQ.trim().toLowerCase()
              if (q && !`${s.brand} ${s.product_name}`.toLowerCase().includes(q)) return false
              if (stockStatus === 'sufficient') return s.status === 'sufficient'
              if (stockStatus === 'low') return s.status === 'low' || s.status === 'critical'
              if (stockStatus && s.status !== stockStatus) return false
              return true
            })
            .map((s) => {
              const simple = repMode
                ? s.status === 'out' ? 'Нет в наличии' : (s.status === 'low' || s.status === 'critical') ? 'Низкий запас' : 'Достаточный запас'
                : s.status === 'out' ? 'Нет в наличии' : s.status === 'critical' ? 'Критично' : s.status === 'low' ? 'Низкий запас' : 'В норме'
              return (
                <article key={s.product_id} className="product-card">
                  {s.photo_media_id
                    ? <MediaImage mediaId={s.photo_media_id} token={accessToken} alt="" className="product-photo" />
                    : <div className="product-photo placeholder">{(s.brand || s.product_name).slice(0, 1)}</div>}
                  <strong>{s.product_name}</strong>
                  <p className="muted">{s.brand}</p>
                  <span className={`badge ${s.status === 'out' || s.status === 'critical' ? 'badge-danger' : s.status === 'low' ? 'badge-warning' : 'badge-success'}`}>{simple}</span>
                  {!repMode && (
                    <p>доступно {s.available}{supplierMode ? ` · резерв ${s.qty_reserved ?? 0}` : ''}{supplierMode && s.qty_incoming ? ` · в пути ${s.qty_incoming}` : ''}</p>
                  )}
                </article>
              )
            })}
        </div>
      </section>

      {supplierMode && (
        <section className="card stack">
          <h2>Движения</h2>
          {(movements.data?.items ?? []).length === 0 && <p className="muted">Пока нет движений</p>}
          <div className="list">
            {(movements.data?.items ?? []).map((m) => (
              <article key={m.id} className="list-item">
                <strong>{m.kind === 'receipt' ? 'Приход' : m.kind === 'reserve' ? 'Резерв' : m.kind}</strong>
                <p>{m.qty} · {m.reason || 'без комментария'} · {new Date(m.created_at).toLocaleString('ru-RU')}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {activeLoc && !supplierMode && !repMode && (
        <section className="card stack">
          <h2>Прогноз дефицита (7 дней)</h2>
          <p className="muted">deficit = max(0, demand + min_stock − available). demand = Σ норм расхода по confirmed/in_progress записям org (если BOOKING_URL настроен).</p>
          {forecast.isLoading && <div className="state-box">Загрузка…</div>}
          {forecast.data && forecast.data.items.length === 0 && <div className="state-box">Нет позиций для прогноза</div>}
          <div className="list">
            {forecast.data?.items.filter((f) => f.deficit > 0).map((f) => (
              <article key={f.product_id} className="list-item">
                <strong>{f.product_name}</strong>
                <p>дефицит {f.deficit} · доступно {f.available} · мин. {f.min_stock}</p>
                <p className="muted">{f.explanation}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {activeLoc && criticalItems.length > 0 && !supplierMode && !repMode && (
        <section className="card stack">
          <h2>Заказ поставщику (критический остаток)</h2>
          <p className="muted">Выберите поставщика из каталога или оформите заказ в разделе «Косметика».</p>
          <form className="stack" onSubmit={supplierOrderForm.handleSubmit((v) => {
            if (!locationId) {
              setError('Выберите склад')
              return
            }
            createSupplierOrder.mutate(v)
          })}>
            <div className="field">
              <label>Товар (критический)</label>
              <select {...supplierOrderForm.register('product_id')}>
                <option value="">Выберите</option>
                {criticalItems.map((s) => (
                  <option key={s.product_id} value={s.product_id}>
                    {s.brand} {s.product_name} ({statusLabel(s.status)})
                  </option>
                ))}
              </select>
            </div>
            <div className="field"><label>Количество</label><input type="number" step="0.001" {...supplierOrderForm.register('qty')} /></div>
            <div className="field">
              <label>Поставщик</label>
              <select {...supplierOrderForm.register('supplier_org_id')}>
                <option value="">Выберите поставщика</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ''}</option>
                ))}
              </select>
              {suppliers.isError && <span className="error">Не удалось загрузить поставщиков</span>}
              {!suppliers.isLoading && (suppliers.data?.length ?? 0) === 0 && (
                <span className="hint">Каталог поставщиков пока пуст. Можно заказать через «Косметика».</span>
              )}
            </div>
            <div className="field"><label>Комментарий</label><input {...supplierOrderForm.register('comment')} placeholder="Заказ по критическому остатку" /></div>
            <div className="row">
              <button className="btn btn-primary" type="submit" disabled={createSupplierOrder.isPending}>Создать заказ</button>
              <Link className="btn btn-secondary" to="/cosmetics">Каталог косметики</Link>
            </div>
          </form>
        </section>
      )}

      {!supplierMode && !repMode && (
      <section className="card stack">
        <h2>Импорт товаров (CSV)</h2>
        <p className="muted">Шаблон: sku,brand,name,unit,price_rubles,min_stock. Повтор с тем же checksum не применяется повторно.</p>
        <div className="field">
          <label>CSV</label>
          <textarea rows={6} value={csvText} onChange={(e) => setCsvText(e.target.value)} />
        </div>
        <div className="row">
          <button className="btn btn-secondary" type="button" disabled={validateImport.isPending} onClick={() => validateImport.mutate()}>
            Проверить
          </button>
          <button className="btn btn-primary" type="button" disabled={!importJobId || applyImport.isPending} onClick={() => applyImport.mutate()}>
            Применить
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => {
              void (async () => {
                const res = await fetch(`${API_BASE_URL}/v1/commerce/imports/products/template`, {
                  headers: {
                    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                  },
                })
                const text = await res.text()
                setCsvText(text)
              })()
            }}
          >
            Подставить шаблон
          </button>
        </div>
        {importReport && (
          <pre className="state-box" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{importReport}</pre>
        )}
      </section>
      )}
    </main>
  )
}
