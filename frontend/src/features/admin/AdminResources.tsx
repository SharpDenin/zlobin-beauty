import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { appointmentStatusLabel } from '@/shared/lib/status'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { MediaImage } from '@/shared/ui/MediaImage'
import { RichDocRenderer } from '@/shared/ui/RichDocRenderer'
import { adminApi } from './api'
import { audienceLabel, auditActionLabel, formatAdminDate, knowledgeAudienceLabel, orgTypeLabel, statusLabel } from './helpers'
import { AdminFilterBar, AdminPagination, AdminSkeleton, AdminTable, ConfirmAction, DateFilter, SearchField, SelectFilter, TextFilter } from './ui'

function useReset() {
  const [, setParams] = useSearchParams()
  return () => setParams(new URLSearchParams())
}

export function AdminOrganizationsPage() {
  const { accessToken } = useAuth()
  const [params, setParams] = useSearchParams()
  const q = useQuery({ queryKey: ['admin-orgs', params.toString()], queryFn: () => adminApi.orgs(accessToken, params), enabled: Boolean(accessToken) })
  const reset = () => setParams(new URLSearchParams())
  return (
    <div className="page stack admin-page">
      <h1>Организации</h1>
      <AdminFilterBar onReset={reset}>
        <SearchField placeholder="Название" />
        <SelectFilter name="type" label="Тип" options={[{ value: 'salon', label: 'Салон' }, { value: 'supplier', label: 'Поставщик' }]} />
        <SelectFilter name="status" label="Статус" options={[{ value: 'active', label: 'Активна' }, { value: 'blocked', label: 'Заблокирована' }]} />
        <TextFilter name="city" label="Город" />
      </AdminFilterBar>
      {q.isError ? <ErrorBanner error={q.error} /> : null}
      {q.isLoading ? <AdminSkeleton /> : null}
      {q.data ? (
        <>
          <AdminTable
            emptyTitle="Организации не найдены"
            emptyAction={<button type="button" className="btn btn-ghost" onClick={reset}>Сбросить фильтры</button>}
            columns={[
              { key: 'name', label: 'Название' },
              { key: 'type', label: 'Тип' },
              { key: 'city', label: 'Город' },
              { key: 'status', label: 'Статус' },
              { key: 'published', label: 'Публикация' },
            ]}
            rows={q.data.items.map((o) => ({
              id: o.id,
              href: `/admin/organizations/${o.id}`,
              cells: { name: o.name, type: orgTypeLabel(o.type), city: o.city || '—', status: statusLabel(o.status), published: o.published ? 'Да' : 'Нет' },
            }))}
          />
          <AdminPagination total={q.data.total} limit={q.data.limit} />
        </>
      ) : null}
    </div>
  )
}

export function AdminOrganizationDetailPage() {
  const { id = '' } = useParams()
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const q = useQuery({ queryKey: ['admin-org', id], queryFn: () => adminApi.org(accessToken, id), enabled: Boolean(accessToken && id) })
  const masters = useQuery({ queryKey: ['admin-org-masters', id], queryFn: () => adminApi.masters(accessToken, new URLSearchParams({ organization_id: id, limit: '20' })), enabled: Boolean(accessToken && id) })
  const mutate = useMutation({
    mutationFn: () => adminApi.setOrgPublished(accessToken, id, !q.data?.published),
    onSuccess: async () => {
      setConfirm(false)
      await qc.invalidateQueries({ queryKey: ['admin-org', id] })
    },
  })
  if (q.isLoading) return <div className="page"><AdminSkeleton /></div>
  if (q.isError) return <div className="page"><ErrorBanner error={q.error} /></div>
  const o = q.data
  if (!o) return null
  return (
    <div className="page stack admin-page">
      <Link to="/admin/organizations">← Организации</Link>
      <h1>{o.name}</h1>
      <section className="card stack">
        <p>{orgTypeLabel(o.type)} · {statusLabel(o.status)} · {o.published ? 'Опубликована' : 'Скрыта'}</p>
        {o.description ? <p className="muted">{o.description}</p> : null}
      </section>
      {o.branches?.length ? (
        <section className="card stack">
          <h2>Филиалы</h2>
          {o.branches.map((b) => <p key={b.id}>{b.name}, {b.city}</p>)}
        </section>
      ) : null}
      {masters.data?.items?.length ? (
        <section className="card stack">
          <h2>Мастера</h2>
          {masters.data.items.map((m) => <Link key={m.id} to={`/admin/masters/${m.id}`}>{m.display_name}</Link>)}
        </section>
      ) : null}
      <button type="button" className="btn" onClick={() => setConfirm(true)}>{o.published ? 'Снять с публикации' : 'Опубликовать'}</button>
      <ConfirmAction open={confirm} title={o.published ? 'Снять публикацию' : 'Опубликовать организацию'} text="Это изменит видимость организации на платформе." confirmLabel="Подтвердить" pending={mutate.isPending} onClose={() => setConfirm(false)} onConfirm={() => mutate.mutate()} />
      {mutate.error ? <ErrorBanner error={mutate.error} /> : null}
    </div>
  )
}

export function AdminMastersPage() {
  const { accessToken } = useAuth()
  const [params] = useSearchParams()
  const reset = useReset()
  const q = useQuery({ queryKey: ['admin-masters', params.toString()], queryFn: () => adminApi.masters(accessToken, params), enabled: Boolean(accessToken) })
  return (
    <div className="page stack admin-page">
      <h1>Мастера</h1>
      <AdminFilterBar onReset={reset}>
        <SearchField placeholder="Имя" />
        <TextFilter name="city" label="Город" />
        <SelectFilter name="published" label="Статус" options={[{ value: 'true', label: 'Опубликован' }, { value: 'false', label: 'Скрыт' }]} />
      </AdminFilterBar>
      {q.isError ? <ErrorBanner error={q.error} /> : null}
      {q.isLoading ? <AdminSkeleton /> : null}
      {q.data ? (
        <>
          <AdminTable
            emptyTitle="Мастера не найдены"
            emptyAction={<button type="button" className="btn btn-ghost" onClick={reset}>Сбросить фильтры</button>}
            columns={[
              { key: 'name', label: 'Имя' },
              { key: 'spec', label: 'Специализация' },
              { key: 'city', label: 'Город' },
              { key: 'status', label: 'Статус' },
            ]}
            rows={q.data.items.map((m) => ({
              id: m.id,
              href: `/admin/masters/${m.id}`,
              cells: { name: m.display_name, spec: m.specializations?.join(', ') || '—', city: m.city, status: m.published ? 'Опубликован' : 'Скрыт' },
            }))}
          />
          <AdminPagination total={q.data.total} limit={q.data.limit} />
        </>
      ) : null}
    </div>
  )
}

export function AdminMasterDetailPage() {
  const { id = '' } = useParams()
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const q = useQuery({ queryKey: ['admin-master', id], queryFn: () => adminApi.master(accessToken, id), enabled: Boolean(accessToken && id) })
  const hours = useQuery({
    queryKey: ['admin-master-hours', q.data?.user_id],
    queryFn: () => adminApi.workingHours(accessToken, q.data!.user_id),
    enabled: Boolean(accessToken && q.data?.user_id),
  })
  const appts = useQuery({
    queryKey: ['admin-master-appts', q.data?.user_id],
    queryFn: () => adminApi.appointments(accessToken, new URLSearchParams({ master_user_id: q.data!.user_id, limit: '5' })),
    enabled: Boolean(accessToken && q.data?.user_id),
  })
  const mutate = useMutation({
    mutationFn: () => adminApi.setMasterPublished(accessToken, id, !q.data?.published),
    onSuccess: async () => { setConfirm(false); await qc.invalidateQueries({ queryKey: ['admin-master', id] }) },
  })
  if (q.isLoading) return <div className="page"><AdminSkeleton /></div>
  if (q.isError) return <div className="page"><ErrorBanner error={q.error} /></div>
  const m = q.data
  if (!m) return null
  return (
    <div className="page stack admin-page">
      <Link to="/admin/masters">← Мастера</Link>
      <h1>{m.display_name}</h1>
      {m.photo_media_id ? <MediaImage mediaId={m.photo_media_id} token={accessToken} alt={m.display_name} className="admin-media" /> : null}
      <section className="card stack">
        <p>{m.city} · {m.published ? 'Опубликован' : 'Скрыт'}</p>
        <p className="muted">{m.specializations?.join(', ')}</p>
        {m.bio ? <p>{m.bio}</p> : null}
        <Link to={`/admin/organizations/${m.organization_id}`}>Салон</Link>
      </section>
      {m.services?.length ? (
        <section className="card stack">
          <h2>Услуги</h2>
          {m.services.map((s) => <Link key={s.id} to={`/admin/services/${s.id}`}>{s.name}</Link>)}
        </section>
      ) : null}
      {hours.data?.items?.length ? (
        <section className="card stack">
          <h2>График</h2>
          {hours.data.items.map((h) => <p key={h.weekday}>День {h.weekday}: {Math.floor(h.start_minute / 60)}:00–{Math.floor(h.end_minute / 60)}:00</p>)}
        </section>
      ) : null}
      {appts.data ? <p className="muted">Записей: {appts.data.total}</p> : null}
      <button type="button" className="btn" onClick={() => setConfirm(true)}>{m.published ? 'Снять с публикации' : 'Опубликовать'}</button>
      <ConfirmAction open={confirm} title="Изменить публикацию мастера" text="Профиль станет скрыт или виден в поиске." confirmLabel="Подтвердить" pending={mutate.isPending} onClose={() => setConfirm(false)} onConfirm={() => mutate.mutate()} />
      {mutate.error ? <ErrorBanner error={mutate.error} /> : null}
    </div>
  )
}

export function AdminProductsPage() {
  const { accessToken } = useAuth()
  const [params] = useSearchParams()
  const reset = useReset()
  const q = useQuery({ queryKey: ['admin-products', params.toString()], queryFn: () => adminApi.products(accessToken, params), enabled: Boolean(accessToken) })
  const orgs = useQuery({ queryKey: ['admin-suppliers-filter'], queryFn: () => adminApi.orgs(accessToken, new URLSearchParams({ type: 'supplier', limit: '100' })), enabled: Boolean(accessToken) })
  return (
    <div className="page stack admin-page">
      <h1>Товары</h1>
      <AdminFilterBar onReset={reset}>
        <SearchField placeholder="Название" />
        <SelectFilter name="organization_id" label="Поставщик" options={(orgs.data?.items ?? []).map((o) => ({ value: o.id, label: o.name }))} />
        <SelectFilter name="audience" label="Аудитория" options={[{ value: 'all', label: 'Для домашнего ухода' }, { value: 'professional_only', label: 'Только для салонов' }]} />
        <SelectFilter name="published" label="Статус" options={[{ value: 'true', label: 'Опубликован' }, { value: 'false', label: 'Скрыт' }]} />
      </AdminFilterBar>
      {q.isError ? <ErrorBanner error={q.error} /> : null}
      {q.isLoading ? <AdminSkeleton /> : null}
      {q.data ? (
        <>
          <AdminTable
            emptyTitle="Товары не найдены"
            emptyAction={<button type="button" className="btn btn-ghost" onClick={reset}>Сбросить фильтры</button>}
            columns={[
              { key: 'name', label: 'Название' },
              { key: 'supplier', label: 'Поставщик', hideOnMobile: true },
              { key: 'brand', label: 'Бренд' },
              { key: 'audience', label: 'Аудитория' },
              { key: 'price', label: 'Цена' },
              { key: 'stock', label: 'Остаток' },
              { key: 'status', label: 'Статус' },
            ]}
            rows={q.data.items.map((p) => ({
              id: p.id,
              href: `/admin/products/${p.id}`,
              cells: {
                name: p.name,
                supplier: orgs.data?.items.find((o) => o.id === p.organization_id)?.name || '—',
                brand: p.brand || '—',
                audience: audienceLabel(p.audience),
                price: formatMoney(p.price_minor, p.currency),
                stock: String(p.available ?? 0),
                status: p.published ? 'Опубликован' : 'Скрыт',
              },
            }))}
          />
          <AdminPagination total={q.data.total} limit={q.data.limit} />
        </>
      ) : null}
    </div>
  )
}

export function AdminProductDetailPage() {
  const { id = '' } = useParams()
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const q = useQuery({ queryKey: ['admin-product', id], queryFn: () => adminApi.product(accessToken, id), enabled: Boolean(accessToken && id) })
  const articles = useQuery({
    queryKey: ['admin-product-articles', id],
    queryFn: () => adminApi.knowledge(accessToken, new URLSearchParams({ product_id: id, limit: '20' })),
    enabled: Boolean(accessToken && id),
  })
  const mutate = useMutation({
    mutationFn: () => adminApi.setProductPublished(accessToken, id, !q.data?.published),
    onSuccess: async () => { setConfirm(false); await qc.invalidateQueries({ queryKey: ['admin-product', id] }) },
  })
  if (q.isLoading) return <div className="page"><AdminSkeleton /></div>
  if (q.isError) return <div className="page"><ErrorBanner error={q.error} /></div>
  const p = q.data
  if (!p) return null
  return (
    <div className="page stack admin-page">
      <Link to="/admin/products">← Товары</Link>
      <h1>{p.name}</h1>
      {p.photo_media_id ? <MediaImage mediaId={p.photo_media_id} token={accessToken} alt={p.name} className="admin-media" /> : null}
      <section className="card stack">
        <p>{p.brand} · {audienceLabel(p.audience)}</p>
        <p>{formatMoney(p.price_minor, p.currency)} · остаток {p.available}</p>
        <p>{p.published ? 'Опубликован' : 'Скрыт'}</p>
        {p.description ? <p>{p.description}</p> : null}
        <p>Бренд: {p.brand || '—'}</p>
        <Link to={`/admin/organizations/${p.organization_id}`}>Поставщик</Link>
      </section>
      {articles.data?.items?.length ? (
        <section className="card stack">
          <h2>Статьи</h2>
          {articles.data.items.map((a) => <Link key={a.id} to={`/admin/knowledge/${a.id}`}>{a.title}</Link>)}
        </section>
      ) : null}
      <button type="button" className="btn" onClick={() => setConfirm(true)}>{p.published ? 'Снять с публикации' : 'Опубликовать'}</button>
      <ConfirmAction open={confirm} title="Изменить публикацию товара" text="Товар станет скрыт или виден в каталогах." confirmLabel="Подтвердить" pending={mutate.isPending} onClose={() => setConfirm(false)} onConfirm={() => mutate.mutate()} />
      {mutate.error ? <ErrorBanner error={mutate.error} /> : null}
    </div>
  )
}

export function AdminServicesPage() {
  const { accessToken } = useAuth()
  const [params] = useSearchParams()
  const reset = useReset()
  const q = useQuery({ queryKey: ['admin-services', params.toString()], queryFn: () => adminApi.services(accessToken, params), enabled: Boolean(accessToken) })
  return (
    <div className="page stack admin-page">
      <h1>Услуги</h1>
      <AdminFilterBar onReset={reset}>
        <SearchField placeholder="Название" />
        <TextFilter name="category" label="Категория" />
        <SelectFilter name="published" label="Статус" options={[{ value: 'true', label: 'Опубликована' }, { value: 'false', label: 'Скрыта' }]} />
      </AdminFilterBar>
      {q.isError ? <ErrorBanner error={q.error} /> : null}
      {q.isLoading ? <AdminSkeleton /> : null}
      {q.data ? (
        <>
          <AdminTable
            emptyTitle="Услуги не найдены"
            emptyAction={<button type="button" className="btn btn-ghost" onClick={reset}>Сбросить фильтры</button>}
            columns={[
              { key: 'name', label: 'Название' },
              { key: 'cat', label: 'Категория' },
              { key: 'dur', label: 'Длительность' },
              { key: 'price', label: 'Цена' },
              { key: 'status', label: 'Статус' },
            ]}
            rows={q.data.items.map((s) => ({
              id: s.id,
              href: `/admin/services/${s.id}`,
              cells: { name: s.name, cat: s.category || '—', dur: `${s.duration_minutes} мин`, price: formatMoney(s.price_minor, s.currency), status: s.published ? 'Опубликована' : 'Скрыта' },
            }))}
          />
          <AdminPagination total={q.data.total} limit={q.data.limit} />
        </>
      ) : null}
    </div>
  )
}

export function AdminServiceDetailPage() {
  const { id = '' } = useParams()
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const q = useQuery({ queryKey: ['admin-service', id], queryFn: () => adminApi.service(accessToken, id), enabled: Boolean(accessToken && id) })
  const mutate = useMutation({
    mutationFn: () => adminApi.setServicePublished(accessToken, id, !q.data?.published),
    onSuccess: async () => { setConfirm(false); await qc.invalidateQueries({ queryKey: ['admin-service', id] }) },
  })
  if (q.isLoading) return <div className="page"><AdminSkeleton /></div>
  if (q.isError) return <div className="page"><ErrorBanner error={q.error} /></div>
  const s = q.data
  if (!s) return null
  return (
    <div className="page stack admin-page">
      <Link to="/admin/services">← Услуги</Link>
      <h1>{s.name}</h1>
      {s.photo_media_id ? <MediaImage mediaId={s.photo_media_id} token={accessToken} alt={s.name} className="admin-media" /> : null}
      <section className="card stack">
        <p>{s.category} · {s.duration_minutes} мин · {formatMoney(s.price_minor, s.currency)}</p>
        <p>{s.published ? 'Опубликована' : 'Скрыта'}</p>
        {s.description ? <p>{s.description}</p> : null}
        <Link to={`/admin/organizations/${s.organization_id}`}>Салон</Link>
      </section>
      <button type="button" className="btn" onClick={() => setConfirm(true)}>{s.published ? 'Снять с публикации' : 'Опубликовать'}</button>
      <ConfirmAction open={confirm} title="Изменить публикацию услуги" text="Услуга станет скрыта или доступна для записи." confirmLabel="Подтвердить" pending={mutate.isPending} onClose={() => setConfirm(false)} onConfirm={() => mutate.mutate()} />
      {mutate.error ? <ErrorBanner error={mutate.error} /> : null}
    </div>
  )
}

export function AdminKnowledgePage() {
  const { accessToken } = useAuth()
  const [params] = useSearchParams()
  const reset = useReset()
  const q = useQuery({ queryKey: ['admin-knowledge', params.toString()], queryFn: () => adminApi.knowledge(accessToken, params), enabled: Boolean(accessToken) })
  return (
    <div className="page stack admin-page">
      <h1>База знаний</h1>
      <AdminFilterBar onReset={reset}>
        <SearchField placeholder="Название" />
        <SelectFilter name="status" label="Статус" options={[{ value: 'published', label: 'Опубликована' }, { value: 'draft', label: 'Черновик' }, { value: 'archived', label: 'Архив' }]} />
        <SelectFilter name="audience_kind" label="Аудитория" options={[{ value: 'home', label: 'Для домашнего ухода' }, { value: 'professional', label: 'Только для салонов' }, { value: 'mixed', label: 'Смешанная' }, { value: 'unlinked', label: 'Без товаров' }]} />
      </AdminFilterBar>
      {q.isError ? <ErrorBanner error={q.error} /> : null}
      {q.isLoading ? <AdminSkeleton /> : null}
      {q.data ? (
        <>
          <AdminTable
            emptyTitle="Статьи не найдены"
            emptyAction={<button type="button" className="btn btn-ghost" onClick={reset}>Сбросить фильтры</button>}
            columns={[
              { key: 'title', label: 'Название' },
              { key: 'status', label: 'Статус' },
              { key: 'aud', label: 'Аудитория' },
              { key: 'author', label: 'Автор' },
              { key: 'updated', label: 'Обновлена', hideOnMobile: true },
            ]}
            rows={q.data.items.map((a) => ({
              id: a.id,
              href: `/admin/knowledge/${a.id}`,
              cells: { title: a.title, status: statusLabel(a.status), aud: knowledgeAudienceLabel(a.audience_kind || (a.product_ids?.length ? '' : 'unlinked')), author: a.author_name || '—', updated: formatAdminDate(a.updated_at) },
            }))}
          />
          <AdminPagination total={q.data.total} limit={q.data.limit} />
        </>
      ) : null}
    </div>
  )
}

export function AdminKnowledgeDetailPage() {
  const { id = '' } = useParams()
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [action, setAction] = useState<'publish' | 'unpublish' | 'archive' | null>(null)
  const q = useQuery({ queryKey: ['admin-article', id], queryFn: () => adminApi.article(accessToken, id), enabled: Boolean(accessToken && id) })
  const mutate = useMutation({
    mutationFn: () => adminApi.setArticleStatus(accessToken, id, action!),
    onSuccess: async () => { setAction(null); await qc.invalidateQueries({ queryKey: ['admin-article', id] }) },
  })
  if (q.isLoading) return <div className="page"><AdminSkeleton /></div>
  if (q.isError) return <div className="page"><ErrorBanner error={q.error} /></div>
  const a = q.data
  if (!a) return null
  return (
    <div className="page stack admin-page">
      <Link to="/admin/knowledge">← База знаний</Link>
      <h1>{a.title}</h1>
      <section className="card stack">
        <p>{statusLabel(a.status)} · {knowledgeAudienceLabel(a.audience_kind)}</p>
        <p className="muted">{a.author_name}</p>
        {a.content ? <RichDocRenderer content={a.content} contentFormat={a.content_format} token={accessToken} className="admin-article-body" /> : null}
        {a.product_ids?.length ? (
          <div className="stack-xs">
            <span className="muted">Связанные товары</span>
            {a.product_ids.map((pid) => (
              <Link key={pid} to={`/admin/products/${pid}`}>
                Товар #{pid.slice(0, 8)}
              </Link>
            ))}
          </div>
        ) : null}
      </section>
      <div className="row gap wrap">
        {a.status !== 'published' ? <button type="button" className="btn" onClick={() => setAction('publish')}>Опубликовать</button> : null}
        {a.status === 'published' ? <button type="button" className="btn" onClick={() => setAction('unpublish')}>В черновик</button> : null}
        {a.status !== 'archived' ? <button type="button" className="btn btn-ghost" onClick={() => setAction('archive')}>В архив</button> : null}
      </div>
      <ConfirmAction open={Boolean(action)} title="Изменить публикацию статьи" text="Статус статьи изменится для всей платформы." confirmLabel="Подтвердить" pending={mutate.isPending} onClose={() => setAction(null)} onConfirm={() => mutate.mutate()} />
      {mutate.error ? <ErrorBanner error={mutate.error} /> : null}
    </div>
  )
}

export function AdminAppointmentsPage() {
  const { accessToken } = useAuth()
  const [params] = useSearchParams()
  const reset = useReset()
  const q = useQuery({ queryKey: ['admin-appts', params.toString()], queryFn: () => adminApi.appointments(accessToken, params), enabled: Boolean(accessToken) })
  return (
    <div className="page stack admin-page">
      <h1>Записи</h1>
      <AdminFilterBar onReset={reset}>
        <SearchField placeholder="Услуга или id" />
        <TextFilter name="date" label="Дата" placeholder="ГГГГ-ММ-ДД" />
        <SelectFilter name="status" label="Статус" options={[{ value: 'confirmed', label: 'Подтверждена' }, { value: 'completed', label: 'Завершена' }, { value: 'pending_confirmation', label: 'Ожидает' }]} />
      </AdminFilterBar>
      {q.isError ? <ErrorBanner error={q.error} /> : null}
      {q.isLoading ? <AdminSkeleton /> : null}
      {q.data ? (
        <>
          <AdminTable
            emptyTitle="Записи не найдены"
            emptyAction={<button type="button" className="btn btn-ghost" onClick={reset}>Сбросить фильтры</button>}
            columns={[
              { key: 'svc', label: 'Услуга' },
              { key: 'when', label: 'Время' },
              { key: 'status', label: 'Статус' },
              { key: 'price', label: 'Цена' },
            ]}
            rows={q.data.items.map((a) => ({
              id: a.id,
              href: `/admin/appointments/${a.id}`,
              cells: { svc: a.service_name, when: formatAdminDate(a.starts_at), status: appointmentStatusLabel(a.status), price: formatMoney(a.price_minor, a.currency) },
            }))}
          />
          <AdminPagination total={q.data.total} limit={q.data.limit} />
        </>
      ) : null}
    </div>
  )
}

export function AdminAppointmentDetailPage() {
  const { id = '' } = useParams()
  const { accessToken } = useAuth()
  const q = useQuery({ queryKey: ['admin-appt', id], queryFn: () => adminApi.appointment(accessToken, id), enabled: Boolean(accessToken && id) })
  if (q.isLoading) return <div className="page"><AdminSkeleton /></div>
  if (q.isError) return <div className="page"><ErrorBanner error={q.error} /></div>
  const a = q.data
  if (!a) return null
  const visit = a.visit?.length ? a.visit : [a]
  return (
    <div className="page stack admin-page">
      <Link to="/admin/appointments">← Записи</Link>
      <h1>{a.service_name}</h1>
      <section className="card stack">
        <p>{appointmentStatusLabel(a.status)} · {formatAdminDate(a.starts_at)}</p>
        <p>{formatMoney(a.price_minor, a.currency)}</p>
        <p className="muted">Клиент {a.client_user_id.slice(0, 8)} · мастер {a.master_user_id.slice(0, 8)}</p>
        <Link to={`/admin/organizations/${a.organization_id}`}>Салон</Link>
      </section>
      {visit.length > 1 ? (
        <section className="card stack">
          <h2>Визит</h2>
          {visit.map((v) => <p key={v.id}>{v.service_name} · {appointmentStatusLabel(v.status)}</p>)}
        </section>
      ) : null}
      {a.history?.length ? (
        <section className="card stack">
          <h2>История</h2>
          {a.history.map((h, i) => <p key={i}>{formatAdminDate(h.created_at)} · {h.to_status} {h.reason ? `— ${h.reason}` : ''}</p>)}
        </section>
      ) : null}
    </div>
  )
}

export function AdminOrdersPage() {
  const { accessToken } = useAuth()
  const [params] = useSearchParams()
  const reset = useReset()
  const q = useQuery({ queryKey: ['admin-orders', params.toString()], queryFn: () => adminApi.orders(accessToken, params), enabled: Boolean(accessToken) })
  return (
    <div className="page stack admin-page">
      <h1>Заказы</h1>
      <AdminFilterBar onReset={reset}>
        <SearchField placeholder="Номер или адрес" />
        <SelectFilter name="status" label="Статус" options={[{ value: 'new', label: 'Новый' }, { value: 'delivered', label: 'Доставлен' }, { value: 'cancelled', label: 'Отменён' }]} />
      </AdminFilterBar>
      {q.isError ? <ErrorBanner error={q.error} /> : null}
      {q.isLoading ? <AdminSkeleton /> : null}
      {q.data ? (
        <>
          <AdminTable
            emptyTitle="Заказы не найдены"
            emptyAction={<button type="button" className="btn btn-ghost" onClick={reset}>Сбросить фильтры</button>}
            columns={[
              { key: 'num', label: 'Заказ' },
              { key: 'status', label: 'Статус' },
              { key: 'amount', label: 'Сумма' },
              { key: 'created', label: 'Создан' },
            ]}
            rows={q.data.items.map((o) => ({
              id: o.id,
              href: `/admin/orders/${o.id}`,
              cells: { num: o.order_number || o.id.slice(0, 8), status: o.status, amount: formatMoney(o.total_minor, o.currency), created: formatAdminDate(o.created_at) },
            }))}
          />
          <AdminPagination total={q.data.total} limit={q.data.limit} />
        </>
      ) : null}
    </div>
  )
}

export function AdminOrderDetailPage() {
  const { id = '' } = useParams()
  const { accessToken } = useAuth()
  const q = useQuery({ queryKey: ['admin-order', id], queryFn: () => adminApi.order(accessToken, id), enabled: Boolean(accessToken && id) })
  if (q.isLoading) return <div className="page"><AdminSkeleton /></div>
  if (q.isError) return <div className="page"><ErrorBanner error={q.error} /></div>
  const o = q.data
  if (!o) return null
  return (
    <div className="page stack admin-page">
      <Link to="/admin/orders">← Заказы</Link>
      <h1>{o.order_number || 'Заказ'}</h1>
      <section className="card stack">
        <p>{o.status} · {formatMoney(o.total_minor, o.currency)}</p>
        <Link to={`/admin/organizations/${o.supplier_org_id}`}>Поставщик</Link>
        <Link to={`/admin/users/${o.user_id}`}>Клиент</Link>
      </section>
      {o.items?.length ? (
        <section className="card stack">
          <h2>Состав</h2>
          {o.items.map((it) => <p key={it.id}>{it.product_name} × {it.qty} · {formatMoney(it.price_minor, o.currency)}</p>)}
        </section>
      ) : null}
    </div>
  )
}

export function AdminDisputesPage() {
  const { accessToken } = useAuth()
  const [params] = useSearchParams()
  const reset = useReset()
  const q = useQuery({ queryKey: ['admin-disputes', params.toString()], queryFn: () => adminApi.disputes(accessToken, params), enabled: Boolean(accessToken) })
  return (
    <div className="page stack admin-page">
      <h1>Споры</h1>
      <AdminFilterBar onReset={reset}>
        <SelectFilter name="status" label="Статус" options={[{ value: 'open', label: 'Открыт' }, { value: 'resolved', label: 'Решён' }, { value: 'rejected', label: 'Отклонён' }]} />
      </AdminFilterBar>
      {q.isError ? <ErrorBanner error={q.error} /> : null}
      {q.isLoading ? <AdminSkeleton /> : null}
      {q.data ? (
        <>
          <AdminTable
            emptyTitle="Спорных ситуаций пока нет"
            emptyAction={<button type="button" className="btn btn-ghost" onClick={reset}>Сбросить фильтры</button>}
            columns={[
              { key: 'field', label: 'Поле' },
              { key: 'comment', label: 'Что произошло' },
              { key: 'status', label: 'Статус' },
              { key: 'created', label: 'Создан' },
            ]}
            rows={q.data.items.map((d) => ({
              id: d.id,
              href: `/admin/disputes/${d.id}`,
              cells: { field: d.field_key, comment: d.comment, status: statusLabel(d.status), created: formatAdminDate(d.created_at) },
            }))}
          />
          <AdminPagination total={q.data.total} limit={q.data.limit} />
        </>
      ) : null}
    </div>
  )
}

export function AdminDisputeDetailPage() {
  const { id = '' } = useParams()
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [action, setAction] = useState<'resolved' | 'rejected' | null>(null)
  const [reason, setReason] = useState('')
  const q = useQuery({ queryKey: ['admin-dispute', id], queryFn: () => adminApi.dispute(accessToken, id), enabled: Boolean(accessToken && id) })
  const mutate = useMutation({
    mutationFn: () => adminApi.resolveDispute(accessToken, id, action!, reason),
    onSuccess: async () => { setAction(null); setReason(''); await qc.invalidateQueries({ queryKey: ['admin-dispute', id] }) },
  })
  if (q.isLoading) return <div className="page"><AdminSkeleton /></div>
  if (q.isError) return <div className="page"><ErrorBanner error={q.error} /></div>
  const d = q.data
  if (!d) return null
  return (
    <div className="page stack admin-page">
      <Link to="/admin/disputes">← Споры</Link>
      <h1>Спор по карточке</h1>
      <section className="card stack">
        <p><span className="muted">Что произошло</span> {d.comment}</p>
        <p><span className="muted">Поле</span> {d.field_key}</p>
        <p><span className="muted">Статус</span> {statusLabel(d.status)}</p>
        {d.card ? <p><span className="muted">Клиент</span> {d.card.display_name}</p> : null}
      </section>
      {d.events?.length ? (
        <section className="card stack">
          <h2>История</h2>
          {d.events.map((e, i) => <p key={i}>{formatAdminDate(e.created_at)} · {e.action}</p>)}
        </section>
      ) : null}
      {d.status === 'open' ? (
        <div className="row gap">
          <button type="button" className="btn" onClick={() => setAction('resolved')}>Решить</button>
          <button type="button" className="btn btn-danger" onClick={() => setAction('rejected')}>Отклонить</button>
        </div>
      ) : null}
      <ConfirmAction
        open={Boolean(action)}
        title={action === 'rejected' ? 'Отклонить спор' : 'Решить спор'}
        text="Действие будет записано в журнал аудита."
        reason={reason}
        onReason={setReason}
        confirmLabel="Подтвердить"
        danger={action === 'rejected'}
        pending={mutate.isPending}
        onClose={() => setAction(null)}
        onConfirm={() => mutate.mutate()}
      />
      {mutate.error ? <ErrorBanner error={mutate.error} /> : null}
    </div>
  )
}

export function AdminAuditPage() {
  const { accessToken } = useAuth()
  const [params] = useSearchParams()
  const reset = useReset()
  const q = useQuery({ queryKey: ['admin-audit', params.toString()], queryFn: () => adminApi.audit(accessToken, params), enabled: Boolean(accessToken) })
  return (
    <div className="page stack admin-page">
      <h1>Журнал аудита</h1>
      <AdminFilterBar onReset={reset}>
        <SearchField placeholder="Действие или сущность" />
        <TextFilter name="entity_type" label="Сущность" />
        <TextFilter name="actor_id" label="Администратор (id)" />
        <DateFilter name="from" label="С" />
        <DateFilter name="to" label="По" />
      </AdminFilterBar>
      {q.isError ? <ErrorBanner error={q.error} /> : null}
      {q.isLoading ? <AdminSkeleton /> : null}
      {q.data ? (
        <>
          <AdminTable
            emptyTitle="Записей не найдено"
            emptyAction={<button type="button" className="btn btn-ghost" onClick={reset}>Сбросить фильтры</button>}
            columns={[
              { key: 'when', label: 'Когда' },
              { key: 'actor', label: 'Кто' },
              { key: 'action', label: 'Действие' },
              { key: 'entity', label: 'Объект' },
            ]}
            rows={q.data.items.map((e) => ({
              id: e.id,
              cells: {
                when: formatAdminDate(e.created_at),
                actor: e.actor_user_id ? 'Администратор' : 'Система',
                action: auditActionLabel(e.action),
                entity: `${e.entity_type}${e.entity_id ? ` #${e.entity_id.slice(0, 8)}` : ''}`,
              },
            }))}
          />
          <AdminPagination total={q.data.total} limit={q.data.limit} />
        </>
      ) : null}
    </div>
  )
}

export function AdminSuppliersPage() {
  const { accessToken } = useAuth()
  const [params, setParams] = useSearchParams()
  const merged = new URLSearchParams(params)
  if (!merged.get('type')) merged.set('type', 'supplier')
  const q = useQuery({ queryKey: ['admin-suppliers', merged.toString()], queryFn: () => adminApi.orgs(accessToken, merged), enabled: Boolean(accessToken) })
  const reset = () => setParams(new URLSearchParams({ type: 'supplier' }))
  return (
    <div className="page stack admin-page">
      <h1>Поставщики</h1>
      <AdminFilterBar onReset={reset}>
        <SearchField placeholder="Название" />
        <TextFilter name="city" label="Город" />
      </AdminFilterBar>
      {q.isError ? <ErrorBanner error={q.error} /> : null}
      {q.isLoading ? <AdminSkeleton /> : null}
      {q.data ? (
        <>
          <AdminTable
            emptyTitle="Поставщики не найдены"
            emptyAction={<button type="button" className="btn btn-ghost" onClick={reset}>Сбросить фильтры</button>}
            columns={[
              { key: 'name', label: 'Поставщик' },
              { key: 'city', label: 'Город' },
              { key: 'status', label: 'Статус' },
            ]}
            rows={q.data.items.map((o) => ({
              id: o.id,
              href: `/admin/suppliers/${o.id}`,
              cells: { name: o.name, city: o.city || '—', status: o.published ? 'Опубликован' : 'Скрыт' },
            }))}
          />
          <AdminPagination total={q.data.total} limit={q.data.limit} />
        </>
      ) : null}
    </div>
  )
}

export function AdminSupplierDetailPage() {
  const { id = '' } = useParams()
  const { accessToken } = useAuth()
  const q = useQuery({ queryKey: ['admin-org', id], queryFn: () => adminApi.org(accessToken, id), enabled: Boolean(accessToken && id) })
  const products = useQuery({ queryKey: ['admin-supplier-products', id], queryFn: () => adminApi.products(accessToken, new URLSearchParams({ organization_id: id, limit: '20' })), enabled: Boolean(accessToken && id) })
  const articles = useQuery({ queryKey: ['admin-supplier-articles', id], queryFn: () => adminApi.knowledge(accessToken, new URLSearchParams({ supplier_org_id: id, limit: '20' })), enabled: Boolean(accessToken && id) })
  if (q.isLoading) return <div className="page"><AdminSkeleton /></div>
  if (q.isError) return <div className="page"><ErrorBanner error={q.error} /></div>
  const o = q.data
  if (!o) return null
  return (
    <div className="page stack admin-page">
      <Link to="/admin/suppliers">← Поставщики</Link>
      <h1>{o.name}</h1>
      <section className="card stack">
        <p>{o.published ? 'Опубликован' : 'Скрыт'} · {statusLabel(o.status)}</p>
      </section>
      {products.data ? <p className="muted">Товаров: {products.data.total}</p> : null}
      {products.data?.items?.length ? (
        <section className="card stack">
          <h2>Каталог</h2>
          {products.data.items.map((p) => <Link key={p.id} to={`/admin/products/${p.id}`}>{p.name}</Link>)}
        </section>
      ) : null}
      {articles.data?.items?.length ? (
        <section className="card stack">
          <h2>Статьи</h2>
          {articles.data.items.map((a) => <Link key={a.id} to={`/admin/knowledge/${a.id}`}>{a.title}</Link>)}
        </section>
      ) : null}
    </div>
  )
}
