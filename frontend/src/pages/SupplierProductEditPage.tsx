import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg, type CommerceProduct } from '@/shared/lib/commerce'
import { MediaDropzone } from '@/shared/ui/MediaDropzone'
import { useToast } from '@/shared/ui/Toast'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { fieldErrors, formatUserError } from '@/shared/lib/app-error'
import { supplierProductWriteBody } from '@/pages/supplier-helpers'

const schema = z.object({
  name: z.string().min(2, 'Укажите название'),
  brand: z.string().optional(),
  category_id: z.string().optional(),
  description: z.string().optional(),
  price_rubles: z.coerce.number().min(0, 'Цена не может быть отрицательной'),
  volume_label: z.string().optional(),
  unit: z.string().min(1, 'Укажите единицу'),
  sku: z.string().optional(),
  delivery_days: z.coerce.number().int().min(0),
  for_sale: z.boolean(),
  published: z.boolean(),
  audience: z.enum(['all', 'professional_only']),
})

type FormValues = z.infer<typeof schema>

export function SupplierProductEditPage() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const { accessToken } = useAuth()
  const { supplierOrgId, orgs } = useSupplierOrg()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const [error, setError] = useState<unknown>(null)
  const [photoMediaId, setPhotoMediaId] = useState<string | null>(null)

  const existing = useQuery({
    queryKey: ['commerce-product', id],
    queryFn: () => apiRequest<CommerceProduct>(`/v1/commerce/products/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && !isNew && id),
  })

  const productKnowledge = useQuery({
    queryKey: ['product-knowledge', id],
    queryFn: () =>
      apiRequest<{ items: Array<{ id: string; title: string; status?: string; published?: boolean }> }>(
        `/v1/knowledge?product_id=${id}&limit=8`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && !isNew && id),
  })

  const categories = useQuery({
    queryKey: ['commerce-product-categories'],
    queryFn: () => apiRequest<{ items: Array<{ id: string; name: string }> }>('/v1/commerce/product-categories', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      brand: '',
      category_id: '',
      description: '',
      price_rubles: 0,
      volume_label: '',
      unit: 'pcs',
      sku: '',
      delivery_days: 3,
      for_sale: true,
      published: true,
      audience: 'all' as const,
    },
  })

  useEffect(() => {
    if (!existing.data) return
    const p = existing.data
    form.reset({
      name: p.name,
      brand: p.brand ?? '',
      category_id: p.category_id ?? '',
      description: p.description ?? '',
      price_rubles: p.price_minor / 100,
      volume_label: p.volume_label ?? '',
      unit: p.unit || 'pcs',
      sku: p.sku ?? '',
      delivery_days: p.delivery_days ?? 3,
      for_sale: p.for_sale !== false,
      published: p.published !== false,
      audience: p.audience === 'professional_only' ? 'professional_only' : 'all',
    })
    setPhotoMediaId(p.photo_media_id ?? null)
  }, [existing.data, categories.data, form.reset])

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!supplierOrgId) throw new ApiError('Нет организации поставщика', 'validation_error', 400)
      const payload = supplierProductWriteBody({
        isNew,
        organizationId: supplierOrgId,
        values,
        photoMediaId,
      })
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
      toast.success('Товар сохранён')
      await qc.invalidateQueries({ queryKey: ['commerce-products'] })
      await qc.invalidateQueries({ queryKey: ['commerce-product'] })
      await qc.invalidateQueries({ queryKey: ['supplier-dashboard'] })
      void navigate(res?.id ? `/supplier/products/${res.id}` : '/supplier/products')
    },
    onError: (e) => {
      setError(e)
      const fields = fieldErrors(e)
      if (fields) {
        for (const [key, value] of Object.entries(fields)) {
          if (key in form.getValues()) {
            form.setError(key as keyof FormValues, { type: 'server', message: value })
          }
        }
      }
      toast.error(formatUserError(e, 'Не удалось сохранить товар'))
    },
  })

  if (orgs.isLoading || (!isNew && existing.isLoading)) {
    return <main className="page"><div className="skeleton skeleton-card" aria-busy="true" /></main>
  }

  if (!supplierOrgId) {
    return (
      <main className="page">
        <EmptyState
          title="Сначала создайте поставщика"
          text="Онбординг откроет каталог и редактор товаров."
          action={<Link className="btn btn-primary" to="/supplier">Онбординг</Link>}
        />
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

      <ErrorBanner error={error} fallbackTitle="Не удалось сохранить товар" />
      {!isNew && existing.isError && (
        <>
          <ErrorBanner error={existing.error} fallbackTitle="Товар не найден" />
          <EmptyState
            title="Товар не найден"
            text="Проверьте ссылку или вернитесь к каталогу."
            action={<Link className="btn btn-secondary" to="/supplier/products">К списку</Link>}
          />
        </>
      )}

      <form className="card stack supplier-product-form" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <div className="field">
          <label>Фото</label>
          <MediaDropzone
            purpose="product"
            value={photoMediaId}
            onChange={setPhotoMediaId}
            label="Фото товара"
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
          <label htmlFor="sp-category">Категория</label>
          <select id="sp-category" {...form.register('category_id')}>
            <option value="">Без категории</option>
            {(categories.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Описание</label>
          <textarea {...form.register('description')} />
        </div>
        <div className="supplier-form-grid">
          <div className="field">
            <label>Цена, ₽</label>
            <input type="number" step="0.01" aria-invalid={Boolean(form.formState.errors.price_rubles)} {...form.register('price_rubles')} />
            {form.formState.errors.price_rubles && <span className="error">{form.formState.errors.price_rubles.message}</span>}
          </div>
          <div className="field">
            <label>Объём</label>
            <input {...form.register('volume_label')} placeholder="100 мл" />
          </div>
          <div className="field">
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
          <div className="field">
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
        <div className="field">
          <fieldset className="stack-sm">
            <legend>Кому доступен товар</legend>
            <label className="field-check">
              <input type="radio" value="all" {...form.register('audience')} />
              <span>Для домашнего ухода</span>
            </label>
            <label className="field-check">
              <input type="radio" value="professional_only" {...form.register('audience')} />
              <span>Только для салонов</span>
            </label>
          </fieldset>
          <span className="hint">Клиенты видят товар и связанные статьи базы знаний только при выборе домашнего ухода.</span>
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </form>
      {!isNew && (
        <section className="card stack-sm">
          <h2>Материалы по товару</h2>
          {(productKnowledge.data?.items?.length ?? 0) === 0 && (
            <p className="muted">Связанных материалов пока нет. Создайте статью в базе знаний и привяжите этот товар.</p>
          )}
          {(productKnowledge.data?.items ?? []).map((a) => (
            <Link key={a.id} to={`/knowledge/${a.id}/edit`}>{a.title}</Link>
          ))}
          <Link className="btn btn-secondary btn-compact" to="/knowledge/new">Создать материал</Link>
        </section>
      )}
    </main>
  )
}
