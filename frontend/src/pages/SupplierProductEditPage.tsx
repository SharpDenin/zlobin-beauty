import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, API_BASE_URL, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg, type CommerceProduct } from '@/shared/lib/commerce'
import { MediaImage } from '@/shared/ui/MediaImage'

const schema = z.object({
  name: z.string().min(2, 'Укажите название'),
  brand: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  price_rubles: z.coerce.number().min(0, 'Цена не может быть отрицательной'),
  volume_label: z.string().optional(),
  unit: z.string().min(1, 'Укажите единицу'),
  sku: z.string().optional(),
  delivery_days: z.coerce.number().int().min(0),
  for_sale: z.boolean(),
  published: z.boolean(),
})

type FormValues = z.infer<typeof schema>

export function SupplierProductEditPage() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const { accessToken } = useAuth()
  const { supplierOrgId, orgs } = useSupplierOrg()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [photoMediaId, setPhotoMediaId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const existing = useQuery({
    queryKey: ['commerce-product', id],
    queryFn: () => apiRequest<CommerceProduct>(`/v1/commerce/products/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && !isNew && id),
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      brand: '',
      category: '',
      description: '',
      price_rubles: 0,
      volume_label: '',
      unit: 'pcs',
      sku: '',
      delivery_days: 3,
      for_sale: true,
      published: true,
    },
  })

  useEffect(() => {
    if (!existing.data) return
    const p = existing.data
    form.reset({
      name: p.name,
      brand: p.brand ?? '',
      category: p.category ?? '',
      description: p.description ?? '',
      price_rubles: p.price_minor / 100,
      volume_label: p.volume_label ?? '',
      unit: p.unit || 'pcs',
      sku: p.sku ?? '',
      delivery_days: p.delivery_days ?? 3,
      for_sale: p.for_sale !== false,
      published: p.published !== false,
    })
    setPhotoMediaId(p.photo_media_id ?? null)
  }, [existing.data, form])

  async function uploadPhoto(file: File) {
    if (!accessToken) return
    setUploading(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      body.append('purpose', 'product')
      const res = await fetch(`${API_BASE_URL}/v1/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new ApiError(data?.error?.message ?? 'Не удалось загрузить фото', data?.error?.code ?? 'error', res.status)
      }
      setPhotoMediaId(data.id as string)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка загрузки фото')
    } finally {
      setUploading(false)
    }
  }

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!supplierOrgId) throw new ApiError('Нет организации поставщика', 'validation_error', 400)
      const payload = {
        organization_id: supplierOrgId,
        name: values.name,
        brand: values.brand ?? '',
        category: values.category ?? '',
        description: values.description ?? '',
        price_minor: Math.round(values.price_rubles * 100),
        volume_label: values.volume_label ?? '',
        unit: values.unit,
        sku: values.sku ?? '',
        delivery_days: values.delivery_days,
        for_sale: values.for_sale,
        published: values.published,
        photo_media_id: photoMediaId,
        min_stock: 0,
      }
      if (isNew) {
        return apiRequest<CommerceProduct>('/v1/commerce/products', {
          token: accessToken,
          body: payload,
        })
      }
      return apiRequest<CommerceProduct>(`/v1/commerce/products/${id}`, {
        method: 'PUT',
        token: accessToken,
        body: payload,
      })
    },
    onSuccess: async (res) => {
      setError(null)
      await qc.invalidateQueries({ queryKey: ['commerce-products'] })
      await qc.invalidateQueries({ queryKey: ['commerce-product'] })
      await qc.invalidateQueries({ queryKey: ['supplier-dashboard'] })
      void navigate(res?.id ? `/supplier/products/${res.id}` : '/supplier/products')
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось сохранить товар'),
  })

  if (orgs.isLoading || (!isNew && existing.isLoading)) {
    return <main className="page"><div className="state-box">Загрузка…</div></main>
  }

  if (!supplierOrgId) {
    return (
      <main className="page">
        <div className="empty-state">
          <h2>Сначала создайте поставщика</h2>
          <Link className="btn btn-primary" to="/supplier">Онбординг</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <Link className="btn btn-ghost btn-compact" to="/supplier/products">← К списку</Link>
          <h1>{isNew ? 'Новый товар' : 'Редактирование'}</h1>
        </div>
      </div>

      {error && <div className="state-box error">{error}</div>}
      {!isNew && existing.isError && <div className="state-box error">Товар не найден</div>}

      <form className="card stack" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <div className="product-media">
          {photoMediaId ? (
            <MediaImage mediaId={photoMediaId} token={accessToken} alt="Товар" />
          ) : (
            <span>Фото появится здесь</span>
          )}
        </div>
        <div className="field">
          <label htmlFor="photo">Фото</label>
          <input
            id="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadPhoto(file)
              e.target.value = ''
            }}
          />
          <span className="hint">JPEG, PNG или WebP. Если загрузка недоступна — можно сохранить без фото.</span>
        </div>

        <div className="field">
          <label>Название</label>
          <input aria-invalid={Boolean(form.formState.errors.name)} {...form.register('name')} />
          {form.formState.errors.name && <span className="error">{form.formState.errors.name.message}</span>}
        </div>
        <div className="field">
          <label>Бренд</label>
          <input {...form.register('brand')} />
        </div>
        <div className="field">
          <label>Категория</label>
          <input {...form.register('category')} placeholder="Краска, уход, инструменты…" />
        </div>
        <div className="field">
          <label>Описание</label>
          <textarea {...form.register('description')} />
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Цена, ₽</label>
            <input type="number" step="0.01" {...form.register('price_rubles')} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Объём</label>
            <input {...form.register('volume_label')} placeholder="100 мл" />
          </div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Ед. изм.</label>
            <select {...form.register('unit')}>
              <option value="pcs">шт</option>
              <option value="ml">мл</option>
              <option value="g">г</option>
              <option value="l">л</option>
              <option value="kg">кг</option>
              <option value="pack">уп</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Артикул</label>
            <input {...form.register('sku')} />
          </div>
        </div>
        <div className="field">
          <label>Срок доставки, дней</label>
          <input type="number" min={0} {...form.register('delivery_days')} />
        </div>
        <label className="field-check">
          <input type="checkbox" {...form.register('for_sale')} />
          <span>В продаже</span>
        </label>
        <label className="field-check">
          <input type="checkbox" {...form.register('published')} />
          <span>Опубликован в каталоге</span>
        </label>
        <button className="btn btn-primary btn-block" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </form>
    </main>
  )
}
