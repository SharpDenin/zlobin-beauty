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
}

const schema = z.object({
  name: z.string().min(2, 'Укажите название'),
  category: z.string().min(2, 'Укажите категорию'),
  description: z.string().optional(),
  notes: z.string().optional(),
  duration_minutes: z.coerce.number().int().positive('Длительность должна быть больше 0'),
  price_rubles: z.coerce.number().positive('Цена должна быть больше 0'),
  published: z.boolean(),
})

type FormValues = z.infer<typeof schema>

export function ServicesPage() {
  const { id } = useParams()
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(Boolean(id))

  const master = useQuery({
    queryKey: ['my-master'],
    queryFn: () =>
      apiRequest<{ master: { id: string; organization_id: string }; services: Service[] }>(
        '/v1/me/master',
        { token: accessToken },
      ),
    enabled: Boolean(accessToken),
    retry: false,
  })

  const services = useMemo(() => master.data?.services ?? [], [master.data])
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
    },
  })

  useEffect(() => {
    if (!id) {
      setModalOpen(false)
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
    })
  }, [editing, form, id])

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const orgId = master.data?.master.organization_id
      if (!orgId) throw new ApiError('Сначала создайте профиль мастера', 'validation_error', 400)
      if (id && editing) {
        return apiRequest(`/v1/services/${id}`, {
          method: 'PATCH',
          token: accessToken,
          body: {
            name: values.name,
            category: values.category,
            description: values.description ?? '',
            notes: values.notes ?? '',
            duration_minutes: values.duration_minutes,
            price_minor: Math.round(values.price_rubles * 100),
            published: values.published,
          },
        })
      }
      return apiRequest('/v1/services', {
        token: accessToken,
        body: {
          organization_id: orgId,
          name: values.name,
          category: values.category,
          description: values.description ?? '',
          notes: values.notes ?? '',
          duration_minutes: values.duration_minutes,
          price_minor: Math.round(values.price_rubles * 100),
          published: values.published,
          attach_to_me: true,
        },
      })
    },
    onSuccess: async () => {
      setOk(id ? 'Услуга обновлена' : 'Услуга создана')
      setError(null)
      form.reset({
        name: '',
        category: 'Окрашивание',
        description: '',
        notes: '',
        duration_minutes: 60,
        price_rubles: 3000,
        published: true,
      })
      setModalOpen(false)
      await qc.invalidateQueries({ queryKey: ['my-master'] })
      void navigate('/services')
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка сохранения услуги'),
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

  function openCreate() {
    form.reset({
      name: '',
      category: 'Окрашивание',
      description: '',
      notes: '',
      duration_minutes: 60,
      price_rubles: 3000,
      published: true,
    })
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
              <p className="muted">{s.category} · {s.duration_minutes} мин</p>
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
          </div>
        </div>
      )}
    </main>
  )
}
