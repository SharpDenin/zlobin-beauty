import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'

type OrgItem = {
  organization: { id: string; name: string; type: string }
  branches: Array<{ id: string; name: string; city: string; address_line: string }>
  roles: string[]
}

const orgSchema = z.object({
  name: z.string().min(2),
  branch_name: z.string().min(2),
  city: z.string().min(2),
  address_line: z.string().min(3),
})

const masterSchema = z.object({
  display_name: z.string().min(2),
  city: z.string().min(2),
  bio: z.string().optional(),
  specializations: z.string().optional(),
  published: z.boolean(),
})

const serviceSchema = z.object({
  name: z.string().min(2),
  category: z.string().min(2),
  duration_minutes: z.coerce.number().int().positive(),
  price_rubles: z.coerce.number().positive(),
})

export function MasterCabinetPage() {
  const { accessToken, user } = useAuth()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const orgs = useQuery({
    queryKey: ['orgs-mine'],
    queryFn: () => apiRequest<{ items: OrgItem[] }>('/v1/organizations/mine', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const master = useQuery({
    queryKey: ['my-master'],
    queryFn: () => apiRequest<{ master: { id: string; organization_id: string; branch_id: string | null; published: boolean }; services: unknown[] }>('/v1/me/master', { token: accessToken }),
    enabled: Boolean(accessToken),
    retry: false,
  })

  const hours = useQuery({
    queryKey: ['working-hours'],
    queryFn: () => apiRequest<{ items: Array<{ weekday: number; start_minute: number; end_minute: number }> }>('/v1/me/working-hours', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const orgForm = useForm<z.infer<typeof orgSchema>>({ resolver: zodResolver(orgSchema) })
  const masterForm = useForm<z.infer<typeof masterSchema>>({
    resolver: zodResolver(masterSchema),
    defaultValues: { published: true, display_name: user?.display_name ?? '', city: 'Москва' },
  })
  const serviceForm = useForm<z.infer<typeof serviceSchema>>({
    resolver: zodResolver(serviceSchema),
    defaultValues: { duration_minutes: 60, price_rubles: 3000, category: 'Окрашивание' },
  })

  const createOrg = useMutation({
    mutationFn: (values: z.infer<typeof orgSchema>) =>
      apiRequest('/v1/organizations', { token: accessToken, body: { ...values, type: 'salon' } }),
    onSuccess: async () => {
      setOk('Салон создан')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['orgs-mine'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка создания салона'),
  })

  const saveMaster = useMutation({
    mutationFn: (values: z.infer<typeof masterSchema>) => {
      const org = orgs.data?.items[0]
      if (!org) throw new ApiError('Сначала создайте салон', 'validation_error', 400)
      return apiRequest('/v1/me/master', {
        method: 'PUT',
        token: accessToken,
        body: {
          organization_id: org.organization.id,
          branch_id: org.branches[0]?.id,
          display_name: values.display_name,
          city: values.city,
          bio: values.bio ?? '',
          specializations: (values.specializations ?? '').split(',').map((s) => s.trim()).filter(Boolean),
          published: values.published,
        },
      })
    },
    onSuccess: async () => {
      setOk('Профиль мастера сохранён')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['my-master'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка профиля'),
  })

  const createService = useMutation({
    mutationFn: (values: z.infer<typeof serviceSchema>) => {
      const orgId = master.data?.master.organization_id ?? orgs.data?.items[0]?.organization.id
      if (!orgId) throw new ApiError('Нужен салон и профиль мастера', 'validation_error', 400)
      return apiRequest('/v1/services', {
        token: accessToken,
        body: {
          organization_id: orgId,
          name: values.name,
          category: values.category,
          duration_minutes: values.duration_minutes,
          price_minor: Math.round(values.price_rubles * 100),
          attach_to_me: true,
        },
      })
    },
    onSuccess: async () => {
      setOk('Услуга добавлена')
      setError(null)
      serviceForm.reset({ name: '', category: 'Окрашивание', duration_minutes: 60, price_rubles: 3000 })
      await qc.invalidateQueries({ queryKey: ['my-master'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка услуги'),
  })

  const saveHours = useMutation({
    mutationFn: () =>
      apiRequest('/v1/me/working-hours', {
        method: 'PUT',
        token: accessToken,
        body: {
          items: [1, 2, 3, 4, 5].map((weekday) => ({
            weekday,
            start_minute: 10 * 60,
            end_minute: 19 * 60,
          })),
        },
      }),
    onSuccess: async () => {
      setOk('Расписание: пн–пт 10:00–19:00')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['working-hours'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка расписания'),
  })

  return (
    <main className="page stack">
      <h1>Кабинет мастера</h1>
      <p>Настройка салона, профиля, услуг и расписания для приёма записей.</p>
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box" style={{ color: 'var(--color-success)' }}>{ok}</div>}

      <section className="card stack">
        <h2>1. Салон</h2>
        {orgs.isLoading && <div className="state-box">Загрузка…</div>}
        {orgs.data && orgs.data.items.length > 0 ? (
          <div className="stack-sm">
            {orgs.data.items.map((item) => (
              <div key={item.organization.id}>
                <strong>{item.organization.name}</strong>
                <p>{item.branches[0]?.city}, {item.branches[0]?.address_line}</p>
              </div>
            ))}
          </div>
        ) : (
          <form className="stack" onSubmit={orgForm.handleSubmit((v) => createOrg.mutate(v))}>
            <div className="field"><label>Название</label><input {...orgForm.register('name')} /></div>
            <div className="field"><label>Филиал</label><input {...orgForm.register('branch_name')} /></div>
            <div className="field"><label>Город</label><input {...orgForm.register('city')} /></div>
            <div className="field"><label>Адрес</label><input {...orgForm.register('address_line')} /></div>
            <button className="btn btn-primary" type="submit" disabled={createOrg.isPending}>Создать салон</button>
          </form>
        )}
      </section>

      <section className="card stack">
        <h2>2. Профиль мастера</h2>
        <form className="stack" onSubmit={masterForm.handleSubmit((v) => saveMaster.mutate(v))}>
          <div className="field"><label>Имя в поиске</label><input {...masterForm.register('display_name')} /></div>
          <div className="field"><label>Город</label><input {...masterForm.register('city')} /></div>
          <div className="field"><label>О себе</label><textarea {...masterForm.register('bio')} /></div>
          <div className="field"><label>Специализации через запятую</label><input {...masterForm.register('specializations')} placeholder="Колорист, Парикмахер" /></div>
          <label className="row"><input type="checkbox" {...masterForm.register('published')} /><span>Опубликовать в поиске</span></label>
          <button className="btn btn-primary" type="submit" disabled={saveMaster.isPending}>Сохранить профиль</button>
        </form>
        {master.data && <p className="muted">Профиль: {master.data.master.published ? 'опубликован' : 'скрыт'} · услуг: {master.data.services.length}</p>}
      </section>

      <section className="card stack">
        <h2>3. Услуга</h2>
        <form className="stack" onSubmit={serviceForm.handleSubmit((v) => createService.mutate(v))}>
          <div className="field"><label>Название</label><input {...serviceForm.register('name')} placeholder="Окрашивание волос" /></div>
          <div className="field"><label>Категория</label><input {...serviceForm.register('category')} /></div>
          <div className="field"><label>Длительность, мин</label><input type="number" {...serviceForm.register('duration_minutes')} /></div>
          <div className="field"><label>Цена, ₽</label><input type="number" {...serviceForm.register('price_rubles')} /></div>
          <button className="btn btn-primary" type="submit" disabled={createService.isPending}>Добавить услугу</button>
        </form>
      </section>

      <section className="card stack">
        <h2>4. Расписание</h2>
        <p>Сейчас можно задать стандартное окно пн–пт 10:00–19:00 (UTC-день). Слоты клиенту считаются на сервере.</p>
        <button className="btn btn-primary" type="button" disabled={saveHours.isPending} onClick={() => saveHours.mutate()}>
          Установить пн–пт 10:00–19:00
        </button>
        {hours.data && hours.data.items.length > 0 && (
          <p className="muted">Сохранено интервалов: {hours.data.items.length}</p>
        )}
      </section>
    </main>
  )
}
