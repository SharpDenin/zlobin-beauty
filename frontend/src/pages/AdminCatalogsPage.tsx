import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { apiRequest } from '@/shared/api/client'
import { formatUserError } from '@/shared/lib/app-error'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { useAuth } from '@/features/auth/AuthProvider'

type Category = { id: string; name: string; slug: string }
type Unit = { id: string; code: string; name: string }
type ProfessionType = { id: string; name: string; slug: string; is_active: boolean }

const categorySchema = z.object({
  name: z.string().min(2),
  slug: z.string().optional(),
})

const unitSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
})

export function AdminCatalogsPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const serviceCategories = useQuery({
    queryKey: ['service-categories'],
    queryFn: () => apiRequest<{ items: Category[] }>('/v1/service-categories', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const productCategories = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => apiRequest<{ items: Category[] }>('/v1/commerce/product-categories', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const units = useQuery({
    queryKey: ['commerce-units'],
    queryFn: () => apiRequest<{ items: Unit[] }>('/v1/commerce/units', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const professionTypes = useQuery({
    queryKey: ['admin-profession-types'],
    queryFn: () => apiRequest<{ items: ProfessionType[] }>('/v1/admin/profession-types', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const serviceForm = useForm<z.infer<typeof categorySchema>>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: '', slug: '' },
  })

  const productForm = useForm<z.infer<typeof categorySchema>>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: '', slug: '' },
  })

  const unitForm = useForm<z.infer<typeof unitSchema>>({
    resolver: zodResolver(unitSchema),
    defaultValues: { code: '', name: '' },
  })

  const professionForm = useForm<z.infer<typeof categorySchema>>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: '', slug: '' },
  })

  const createServiceCategory = useMutation({
    mutationFn: (v: z.infer<typeof categorySchema>) =>
      apiRequest('/v1/service-categories', {
        token: accessToken,
        body: { name: v.name, slug: v.slug || undefined },
      }),
    onSuccess: async () => {
      setOk('Категория услуг создана')
      serviceForm.reset()
      await qc.invalidateQueries({ queryKey: ['service-categories'] })
    },
    onError: (e) => setError(formatUserError(e, 'Ошибка')),
  })

  const createProductCategory = useMutation({
    mutationFn: (v: z.infer<typeof categorySchema>) =>
      apiRequest('/v1/commerce/product-categories', {
        token: accessToken,
        body: { name: v.name, slug: v.slug || undefined },
      }),
    onSuccess: async () => {
      setOk('Категория товаров создана')
      productForm.reset()
      await qc.invalidateQueries({ queryKey: ['product-categories'] })
    },
    onError: (e) => setError(formatUserError(e, 'Ошибка')),
  })

  const createUnit = useMutation({
    mutationFn: (v: z.infer<typeof unitSchema>) =>
      apiRequest('/v1/commerce/units', {
        token: accessToken,
        body: { code: v.code, name: v.name },
      }),
    onSuccess: async () => {
      setOk('Единица измерения создана')
      unitForm.reset()
      await qc.invalidateQueries({ queryKey: ['commerce-units'] })
    },
    onError: (e) => setError(formatUserError(e, 'Ошибка')),
  })

  const createProfession = useMutation({
    mutationFn: (v: z.infer<typeof categorySchema>) =>
      apiRequest('/v1/admin/profession-types', {
        token: accessToken,
        body: { name: v.name, slug: v.slug || undefined },
      }),
    onSuccess: async () => {
      setOk('Тип мастера создан')
      professionForm.reset()
      await qc.invalidateQueries({ queryKey: ['admin-profession-types'] })
      await qc.invalidateQueries({ queryKey: ['profession-types'] })
    },
    onError: (e) => setError(formatUserError(e, 'Ошибка')),
  })

  const toggleProfession = useMutation({
    mutationFn: (row: ProfessionType) =>
      apiRequest(`/v1/admin/profession-types/${row.id}/${row.is_active ? 'disable' : 'enable'}`, {
        method: 'POST',
        token: accessToken,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin-profession-types'] })
      await qc.invalidateQueries({ queryKey: ['profession-types'] })
    },
    onError: (e) => setError(formatUserError(e, 'Ошибка')),
  })

  const deleteServiceCategory = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/service-categories/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      setOk('Категория услуг удалена')
      await qc.invalidateQueries({ queryKey: ['service-categories'] })
    },
    onError: (e) => setError(formatUserError(e, 'Ошибка')),
  })

  const deleteProductCategory = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/commerce/product-categories/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      setOk('Категория товаров удалена')
      await qc.invalidateQueries({ queryKey: ['product-categories'] })
    },
    onError: (e) => setError(formatUserError(e, 'Ошибка')),
  })

  const deleteUnit = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/commerce/units/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      setOk('Единица измерения удалена')
      await qc.invalidateQueries({ queryKey: ['commerce-units'] })
    },
    onError: (e) => setError(formatUserError(e, 'Ошибка')),
  })

  return (
    <main className="page stack">
      <h1>Справочники</h1>
      <p className="muted">Управление глобальными категориями услуг и товаров, единицами измерения (system_admin).</p>
      {error && <ErrorBanner error={error} />}
      {ok && <div className="state-box success">{ok}</div>}

      <section className="card stack">
        <h2>Категории услуг</h2>
        <form className="stack" onSubmit={serviceForm.handleSubmit((v) => createServiceCategory.mutate(v))}>
          <div className="field"><label>Название</label><input {...serviceForm.register('name')} /></div>
          <div className="field"><label>Slug (опционально)</label><input {...serviceForm.register('slug')} placeholder="auto" /></div>
          <button className="btn btn-primary" type="submit" disabled={createServiceCategory.isPending}>Создать</button>
        </form>
        <div className="list">
          {serviceCategories.data?.items.map((c) => (
            <article key={c.id} className="list-item row between">
              <div>
                <strong>{c.name}</strong>
                <p className="muted">{c.slug}</p>
              </div>
              <button
                className="btn btn-secondary btn-compact"
                type="button"
                disabled={deleteServiceCategory.isPending}
                onClick={() => deleteServiceCategory.mutate(c.id)}
              >
                Удалить
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2>Категории товаров</h2>
        <form className="stack" onSubmit={productForm.handleSubmit((v) => createProductCategory.mutate(v))}>
          <div className="field"><label>Название</label><input {...productForm.register('name')} /></div>
          <div className="field"><label>Slug (опционально)</label><input {...productForm.register('slug')} placeholder="auto" /></div>
          <button className="btn btn-primary" type="submit" disabled={createProductCategory.isPending}>Создать</button>
        </form>
        <div className="list">
          {productCategories.data?.items.map((c) => (
            <article key={c.id} className="list-item row between">
              <div>
                <strong>{c.name}</strong>
                <p className="muted">{c.slug}</p>
              </div>
              <button
                className="btn btn-secondary btn-compact"
                type="button"
                disabled={deleteProductCategory.isPending}
                onClick={() => deleteProductCategory.mutate(c.id)}
              >
                Удалить
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2>Единицы измерения</h2>
        <form className="stack" onSubmit={unitForm.handleSubmit((v) => createUnit.mutate(v))}>
          <div className="field"><label>Код</label><input {...unitForm.register('code')} placeholder="ml" /></div>
          <div className="field"><label>Название</label><input {...unitForm.register('name')} placeholder="мл" /></div>
          <button className="btn btn-primary" type="submit" disabled={createUnit.isPending}>Создать</button>
        </form>
        <div className="list">
          {units.data?.items.map((u) => (
            <article key={u.id} className="list-item row between">
              <div>
                <strong>{u.name}</strong>
                <p className="muted">{u.code}</p>
              </div>
              <button
                className="btn btn-secondary btn-compact"
                type="button"
                disabled={deleteUnit.isPending}
                onClick={() => deleteUnit.mutate(u.id)}
              >
                Удалить
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2>Типы мастеров</h2>
        <p className="muted">Не удаляйте тип, если он есть в исторических профилях — отключите его.</p>
        <form className="stack" onSubmit={professionForm.handleSubmit((v) => createProfession.mutate(v))}>
          <div className="field"><label htmlFor="pt-name">Название</label><input id="pt-name" required aria-required="true" {...professionForm.register('name')} /></div>
          <div className="field"><label>Slug (опционально)</label><input {...professionForm.register('slug')} placeholder="cosmetologist" /></div>
          <button className="btn btn-primary" type="submit" disabled={createProfession.isPending}>Добавить тип</button>
        </form>
        <div className="list">
          {(professionTypes.data?.items ?? []).map((t) => (
            <article key={t.id} className="list-item row between">
              <div>
                <strong>{t.name}</strong>
                <p className="muted">{t.slug} · {t.is_active ? 'активен' : 'отключён'}</p>
              </div>
              <button className="btn btn-secondary btn-compact" type="button" onClick={() => toggleProfession.mutate(t)}>
                {t.is_active ? 'Отключить' : 'Включить'}
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
