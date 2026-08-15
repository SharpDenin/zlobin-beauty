import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { productStateLabel, statusBadgeClass } from '@/shared/lib/status'
import { datetimeLocalToIso, formatRangeInTimezone } from '@/shared/lib/time'
import { fetchBranch } from '@/shared/lib/commerce'
import { MediaDropzone } from '@/shared/ui/MediaDropzone'
import { useToast } from '@/shared/ui/Toast'

type Service = {
  id: string
  name: string
  category: string
  description?: string
  notes?: string
  duration_minutes: number
  price_minor: number
  price_display?: string
  published: boolean
  archived_at?: string | null
  booking_mode?: string
  photo_media_id?: string | null
}

type Occurrence = {
  id: string
  starts_at: string
  ends_at: string
  timezone: string
  capacity: number
  booked_count: number
  remaining: number
  status: string
  title?: string
}

const schema = z.object({
  name: z.string().min(2, 'Укажите название'),
  category: z.string().min(2, 'Укажите категорию'),
  description: z.string().optional(),
  notes: z.string().optional(),
  duration_minutes: z.coerce.number().int().positive('Длительность должна быть больше 0'),
  price_rubles: z.coerce.number().positive('Цена должна быть больше 0'),
  published: z.boolean(),
  booking_mode: z.enum(['flexible', 'fixed_window']),
})

type FormValues = z.infer<typeof schema>

function bookingModeLabel(mode?: string) {
  return mode === 'fixed_window' ? 'Фиксированное окно' : 'Гибкая запись'
}

export function ServicesPage() {
  const { id } = useParams()
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(Boolean(id))
  const [photoMediaId, setPhotoMediaId] = useState<string | null>(null)
  const [occStart, setOccStart] = useState('')
  const [occEnd, setOccEnd] = useState('')
  const [occCapacity, setOccCapacity] = useState(1)

  const master = useQuery({
    queryKey: ['my-master'],
    queryFn: () =>
      apiRequest<{ master: { id: string; organization_id: string; branch_id?: string | null }; services: Service[] }>(
        '/v1/me/master',
        { token: accessToken },
      ),
    enabled: Boolean(accessToken),
    retry: false,
  })

  const services = useMemo(() => master.data?.services ?? [], [master.data])
  const branchId = master.data?.master.branch_id ?? undefined
  const branch = useQuery({
    queryKey: ['branch', branchId],
    queryFn: () => fetchBranch(accessToken, branchId!),
    enabled: Boolean(accessToken && branchId),
  })
  const salonTz = branch.data?.timezone || 'Europe/Moscow'
  const editing = useMemo(
    () => (id ? services.find((s) => s.id === id) : undefined),
    [id, services],
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      category: 'Окрашивание',
      description: '',
      notes: '',
      duration_minutes: 60,
      price_rubles: 3000,
      published: true,
      booking_mode: 'flexible',
    },
  })

  const bookingMode = form.watch('booking_mode')

  const occurrences = useQuery({
    queryKey: ['service-occurrences-manage', id],
    queryFn: () => apiRequest<{ items: Occurrence[] }>(`/v1/services/${id}/occurrences`, { token: accessToken }),
    enabled: Boolean(accessToken && id && editing?.booking_mode === 'fixed_window'),
  })

  useEffect(() => {
    if (!id) {
      setModalOpen(false)
      setPhotoMediaId(null)
      return
    }
    setModalOpen(true)
    if (!editing) return
    form.reset({
      name: editing.name,
      category: editing.category,
      description: editing.description ?? '',
      notes: editing.notes ?? '',
      duration_minutes: editing.duration_minutes,
      price_rubles: editing.price_minor / 100,
      published: editing.published,
      booking_mode: editing.booking_mode === 'fixed_window' ? 'fixed_window' : 'flexible',
    })
    setPhotoMediaId(editing.photo_media_id ?? null)
  }, [editing, form, id])

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const orgId = master.data?.master.organization_id
      if (!orgId) throw new ApiError('Сначала создайте профиль мастера', 'validation_error', 400)
      const payload = {
        name: values.name,
        category: values.category,
        description: values.description ?? '',
        notes: values.notes ?? '',
        duration_minutes: values.duration_minutes,
        price_minor: Math.round(values.price_rubles * 100),
        published: values.published,
        booking_mode: values.booking_mode,
        photo_media_id: photoMediaId,
      }
      if (id && editing) {
        return apiRequest(`/v1/services/${id}`, {
          method: 'PATCH',
          token: accessToken,
          body: payload,
        })
      }
      return apiRequest('/v1/services', {
        token: accessToken,
        body: {
          organization_id: orgId,
          ...payload,
          attach_to_me: true,
        },
      })
    },
    onSuccess: async () => {
      setOk(id ? 'Услуга обновлена' : 'Услуга создана')
      setError(null)
      toast.success(id ? 'Услуга обновлена' : 'Услуга создана')
      form.reset({
        name: '',
        category: 'Окрашивание',
        description: '',
        notes: '',
        duration_minutes: 60,
        price_rubles: 3000,
        published: true,
        booking_mode: 'flexible',
      })
      setPhotoMediaId(null)
      setModalOpen(false)
      await qc.invalidateQueries({ queryKey: ['my-master'] })
      void navigate('/services')
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : 'Ошибка сохранения услуги'
      setError(msg)
      toast.error(msg)
    },
  })

  const archive = useMutation({
    mutationFn: (serviceId: string) =>
      apiRequest(`/v1/services/${serviceId}`, {
        method: 'PATCH',
        token: accessToken,
        body: { published: false, archived: true },
      }),
    onSuccess: async () => {
      setOk('Услуга скрыта')
      await qc.invalidateQueries({ queryKey: ['my-master'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось архивировать'),
  })

  const addOccurrence = useMutation({
    mutationFn: async () => {
      if (!id) throw new ApiError('Сначала сохраните услугу', 'validation_error', 400)
      if (!occStart || !occEnd) throw new ApiError('Укажите начало и конец сеанса', 'validation_error', 400)
      const startsAt = datetimeLocalToIso(occStart, salonTz)
      const endsAt = datetimeLocalToIso(occEnd, salonTz)
      return apiRequest(`/v1/services/${id}/occurrences`, {
        token: accessToken,
        body: {
          starts_at: startsAt,
          ends_at: endsAt,
          timezone: salonTz,
          capacity: occCapacity > 0 ? occCapacity : 1,
          branch_id: master.data?.master.branch_id ?? undefined,
        },
      })
    },
    onSuccess: async () => {
      setOccStart('')
      setOccEnd('')
      setOccCapacity(1)
      setOk('Сеанс добавлен')
      toast.success('Сеанс добавлен')
      await qc.invalidateQueries({ queryKey: ['service-occurrences-manage', id] })
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : 'Не удалось добавить сеанс'
      setError(msg)
      toast.error(msg)
    },
  })

  const cancelOccurrence = useMutation({
    mutationFn: (occurrenceId: string) =>
      apiRequest(`/v1/occurrences/${occurrenceId}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      setOk('Сеанс отменён')
      await qc.invalidateQueries({ queryKey: ['service-occurrences-manage', id] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось отменить сеанс'),
  })

  function openCreate() {
    form.reset({
      name: '',
      category: 'Окрашивание',
      description: '',
      notes: '',
      duration_minutes: 60,
      price_rubles: 3000,
      published: true,
      booking_mode: 'flexible',
    })
    setPhotoMediaId(null)
    setModalOpen(true)
    void navigate('/services')
  }

  function closeModal() {
    setModalOpen(false)
    void navigate('/services')
  }

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <h1>Услуги</h1>
          <p className="muted">Прайс и длительность для записи клиентов</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={openCreate}>Добавить</button>
      </div>

      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      {master.isLoading && <div className="state-box">Загрузка…</div>}
      {master.isError && (
        <div className="empty-state">
          <h2>Профиль ещё не готов</h2>
          <p>Создайте профиль мастера, затем добавьте услуги.</p>
          <Link className="btn btn-primary" to="/master">Открыть кабинет</Link>
        </div>
      )}
      {!master.isLoading && !master.isError && services.length === 0 && (
        <div className="empty-state">
          <h2>Услуг пока нет</h2>
          <p>Добавьте первую услугу — клиенты увидят её на вашей странице.</p>
          <button className="btn btn-primary" type="button" onClick={openCreate}>Создать услугу</button>
        </div>
      )}

      <div className="cards-grid services">
        {services.map((s) => {
          const state = s.archived_at ? 'archived' : s.published ? 'active' : 'inactive'
          return (
            <article key={s.id} className="service-card">
              <div className="row between">
                <strong>{s.name}</strong>
                <span className={`badge ${statusBadgeClass(state)}`}>{productStateLabel(state)}</span>
              </div>
              <p className="muted">{s.category} · {s.duration_minutes} мин · {bookingModeLabel(s.booking_mode)}</p>
              {s.description && <p>{s.description}</p>}
              <div className="row between">
                <strong>{s.price_display || formatMoney(s.price_minor)}</strong>
                <div className="row">
                  <Link className="btn btn-secondary btn-compact" to={`/services/${s.id}`}>Изменить</Link>
                  {s.published && !s.archived_at && (
                    <button
                      className="btn btn-ghost btn-compact"
                      type="button"
                      disabled={archive.isPending}
                      onClick={() => archive.mutate(s.id)}
                    >
                      В архив
                    </button>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {modalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeModal}>
          <div className="modal-sheet stack" onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <h2>{editing ? 'Редактировать услугу' : 'Новая услуга'}</h2>
              <button className="btn btn-secondary btn-compact" type="button" onClick={closeModal}>Закрыть</button>
            </div>
            <form className="stack" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
              <div className="field">
                <label>Фото услуги</label>
                <MediaDropzone
                  purpose="portfolio"
                  value={photoMediaId}
                  onChange={setPhotoMediaId}
                  label="Фото услуги"
                />
              </div>
              <div className="field">
                <label>Название</label>
                <input {...form.register('name')} />
                {form.formState.errors.name && <span className="error">{form.formState.errors.name.message}</span>}
              </div>
              <div className="field">
                <label>Категория</label>
                <input {...form.register('category')} />
              </div>
              <div className="field">
                <label>Описание</label>
                <textarea {...form.register('description')} />
              </div>
              <div className="field">
                <label>Заметки (только для вас)</label>
                <textarea {...form.register('notes')} />
              </div>
              <div className="field">
                <label htmlFor="booking_mode">Режим записи</label>
                <select id="booking_mode" {...form.register('booking_mode')}>
                  <option value="flexible">Гибкая (слоты по расписанию)</option>
                  <option value="fixed_window">Фиксированное окно</option>
                </select>
              </div>
              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Длительность, мин</label>
                  <input type="number" {...form.register('duration_minutes')} />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Цена, ₽</label>
                  <input type="number" {...form.register('price_rubles')} />
                </div>
              </div>
              <label className="field-check">
                <input type="checkbox" {...form.register('published')} />
                <span>Активна (видна клиентам)</span>
              </label>
              <button className="btn btn-primary btn-block" type="submit" disabled={save.isPending}>
                Сохранить
              </button>
            </form>

            {editing && (bookingMode === 'fixed_window' || editing.booking_mode === 'fixed_window') && (
              <section className="stack">
                <h3>Сеансы (fixed window)</h3>
                <p className="muted">Добавьте окна, на которые клиенты смогут записаться.</p>
                {occurrences.isLoading && <div className="skeleton skeleton-card" />}
                <div className="list">
                  {occurrences.data?.items.map((o) => (
                    <article key={o.id} className="list-item">
                      <div className="row between">
                        <strong>{o.title || formatRangeInTimezone(o.starts_at, o.ends_at, o.timezone)}</strong>
                        <span className={`badge ${o.status === 'cancelled' ? 'badge-cancelled' : 'badge-default'}`}>
                          {o.status === 'cancelled' ? 'отменён' : `мест: ${o.remaining}`}
                        </span>
                      </div>
                      <p className="muted">{formatRangeInTimezone(o.starts_at, o.ends_at, o.timezone)}</p>
                      {o.status !== 'cancelled' && (
                        <button
                          className="btn btn-secondary btn-compact"
                          type="button"
                          disabled={cancelOccurrence.isPending}
                          onClick={() => cancelOccurrence.mutate(o.id)}
                        >
                          Отменить сеанс
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                {occurrences.data && occurrences.data.items.length === 0 && (
                  <div className="state-box">Сеансов пока нет</div>
                )}
                <div className="field">
                  <label htmlFor="occ-start">Начало (время салона: {salonTz})</label>
                  <input id="occ-start" type="datetime-local" value={occStart} onChange={(e) => setOccStart(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="occ-end">Конец (время салона: {salonTz})</label>
                  <input id="occ-end" type="datetime-local" value={occEnd} onChange={(e) => setOccEnd(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="occ-capacity">Вместимость</label>
                  <input
                    id="occ-capacity"
                    type="number"
                    min={1}
                    value={occCapacity}
                    onChange={(e) => setOccCapacity(Number(e.target.value) || 1)}
                  />
                </div>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={addOccurrence.isPending || !occStart || !occEnd}
                  onClick={() => addOccurrence.mutate()}
                >
                  Добавить сеанс
                </button>
              </section>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
