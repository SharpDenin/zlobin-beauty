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
  name: z.string().min(2, 'Минимум 2 символа'),
  branch_name: z.string().min(2, 'Минимум 2 символа'),
  city: z.string().min(2, 'Укажите город'),
  address_line: z.string().min(3, 'Укажите адрес'),
})

const masterSchema = z.object({
  display_name: z.string().min(2, 'Укажите имя'),
  city: z.string().min(2, 'Укажите город'),
  bio: z.string().optional(),
  specializations: z.string().optional(),
  published: z.boolean(),
})

const serviceSchema = z.object({
  name: z.string().min(2, 'Укажите название'),
  category: z.string().min(2, 'Укажите категорию'),
  duration_minutes: z.coerce.number().int().positive('Длительность должна быть больше 0'),
  price_rubles: z.coerce.number().positive('Цена должна быть больше 0'),
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
      setOk('Расписание: пн–пт 10:00–19:00 (часовой пояс филиала)')
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
      {ok && <div className="state-box success">{ok}</div>}

      <section className="card stack">
        <h2>1. Салон</h2>
        {orgs.isLoading && <div className="state-box">Загрузка…</div>}
        {orgs.isError && <div className="state-box error">Не удалось загрузить организации</div>}
        {orgs.data && orgs.data.items.length > 0 ? (
          <div className="stack-sm">
            {orgs.data.items.map((item) => (
              <div key={item.organization.id}>
                <strong>{item.organization.name}</strong>
                <p>{item.branches[0]?.city}, {item.branches[0]?.address_line}</p>
              </div>
            ))}
          </div>
        ) : (!orgs.isLoading && !orgs.isError) ? (
          <form className="stack" onSubmit={orgForm.handleSubmit((v) => createOrg.mutate(v))}>
            <div className="field">
              <label>Название</label>
              <input aria-invalid={Boolean(orgForm.formState.errors.name)} {...orgForm.register('name')} />
              {orgForm.formState.errors.name && <span className="error">{orgForm.formState.errors.name.message}</span>}
            </div>
            <div className="field">
              <label>Филиал</label>
              <input aria-invalid={Boolean(orgForm.formState.errors.branch_name)} {...orgForm.register('branch_name')} />
              {orgForm.formState.errors.branch_name && <span className="error">{orgForm.formState.errors.branch_name.message}</span>}
            </div>
            <div className="field">
              <label>Город</label>
              <input aria-invalid={Boolean(orgForm.formState.errors.city)} {...orgForm.register('city')} />
              {orgForm.formState.errors.city && <span className="error">{orgForm.formState.errors.city.message}</span>}
            </div>
            <div className="field">
              <label>Адрес</label>
              <input aria-invalid={Boolean(orgForm.formState.errors.address_line)} {...orgForm.register('address_line')} />
              {orgForm.formState.errors.address_line && <span className="error">{orgForm.formState.errors.address_line.message}</span>}
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={createOrg.isPending}>Создать салон</button>
          </form>
        ) : null}
      </section>

      <section className="card stack">
        <h2>2. Профиль мастера</h2>
        {master.isError && <div className="state-box">Профиль ещё не создан — заполните форму ниже</div>}
        <form className="stack" onSubmit={masterForm.handleSubmit((v) => saveMaster.mutate(v))}>
          <div className="field">
            <label>Имя в поиске</label>
            <input aria-invalid={Boolean(masterForm.formState.errors.display_name)} {...masterForm.register('display_name')} />
            {masterForm.formState.errors.display_name && <span className="error">{masterForm.formState.errors.display_name.message}</span>}
          </div>
          <div className="field">
            <label>Город</label>
            <input aria-invalid={Boolean(masterForm.formState.errors.city)} {...masterForm.register('city')} />
            {masterForm.formState.errors.city && <span className="error">{masterForm.formState.errors.city.message}</span>}
          </div>
          <div className="field"><label>О себе</label><textarea {...masterForm.register('bio')} /></div>
          <div className="field"><label>Специализации через запятую</label><input {...masterForm.register('specializations')} placeholder="Колорист, Парикмахер" /></div>
          <label className="row"><input type="checkbox" {...masterForm.register('published')} /><span>Опубликовать в поиске</span></label>
          <button className="btn btn-primary btn-block" type="submit" disabled={saveMaster.isPending}>Сохранить профиль</button>
        </form>
        {master.data && <p className="muted">Профиль: {master.data.master.published ? 'опубликован' : 'скрыт'} · услуг: {master.data.services.length}</p>}
      </section>

      <section className="card stack">
        <h2>3. Услуга</h2>
        <form className="stack" onSubmit={serviceForm.handleSubmit((v) => createService.mutate(v))}>
          <div className="field">
            <label>Название</label>
            <input aria-invalid={Boolean(serviceForm.formState.errors.name)} {...serviceForm.register('name')} placeholder="Окрашивание волос" />
            {serviceForm.formState.errors.name && <span className="error">{serviceForm.formState.errors.name.message}</span>}
          </div>
          <div className="field">
            <label>Категория</label>
            <input aria-invalid={Boolean(serviceForm.formState.errors.category)} {...serviceForm.register('category')} />
            {serviceForm.formState.errors.category && <span className="error">{serviceForm.formState.errors.category.message}</span>}
          </div>
          <div className="field">
            <label>Длительность, мин</label>
            <input type="number" aria-invalid={Boolean(serviceForm.formState.errors.duration_minutes)} {...serviceForm.register('duration_minutes')} />
            {serviceForm.formState.errors.duration_minutes && <span className="error">{serviceForm.formState.errors.duration_minutes.message}</span>}
          </div>
          <div className="field">
            <label>Цена, ₽</label>
            <input type="number" aria-invalid={Boolean(serviceForm.formState.errors.price_rubles)} {...serviceForm.register('price_rubles')} />
            {serviceForm.formState.errors.price_rubles && <span className="error">{serviceForm.formState.errors.price_rubles.message}</span>}
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={createService.isPending}>Добавить услугу</button>
        </form>
      </section>

      <section className="card stack">
        <h2>4. Расписание</h2>
        <p>Стандартное окно пн–пт 10:00–19:00 в часовом поясе филиала. Слоты считает сервер.</p>
        {hours.isError && <div className="state-box error">Не удалось загрузить расписание</div>}
        <button className="btn btn-primary btn-block" type="button" disabled={saveHours.isPending} onClick={() => saveHours.mutate()}>
          Установить пн–пт 10:00–19:00
        </button>
        {hours.data && hours.data.items.length > 0 && (
          <p className="muted">Сохранено интервалов: {hours.data.items.length}</p>
        )}
        {hours.data && hours.data.items.length === 0 && (
          <div className="state-box">Расписание ещё не задано</div>
        )}
      </section>
    </main>
  )
}
