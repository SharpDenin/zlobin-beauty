import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest, ApiError } from '@/shared/api/client'
import { userError } from '@/shared/lib/app-error'
import { useAuth } from '@/features/auth/AuthProvider'
import { WORK_TYPE_OPTIONS, workTypeLabel } from '@/shared/lib/status'
import { ProfessionTypePicker } from '@/shared/ui/ProfessionTypePicker'
import type { ProfessionType } from '@/shared/lib/profession-types'
import { selectedProfessionIds } from '@/shared/lib/profession-types'
import { MediaDropzone } from '@/shared/ui/MediaDropzone'
import { MediaImage } from '@/shared/ui/MediaImage'
import { useToast } from '@/shared/ui/Toast'

type OrgItem = {
  organization: { id: string; name: string; type: string; published: boolean; description: string }
  branches: Array<{ id: string; name: string; city: string; address_line: string; phone: string; published: boolean }>
  roles: string[]
}

const orgSchema = z.object({
  name: z.string().min(2, 'Минимум 2 символа'),
  branch_name: z.string().min(2, 'Минимум 2 символа'),
  city: z.string().min(2, 'Укажите город'),
  address_line: z.string().min(3, 'Укажите адрес'),
  phone: z.string().min(5, 'Укажите телефон').optional().or(z.literal('')),
})

const masterSchema = z.object({
  display_name: z.string().min(2, 'Укажите имя'),
  city: z.string().min(2, 'Укажите город'),
  bio: z.string().optional(),
  specializations: z.string().optional(),
  experience_years: z.coerce.number().int().min(0, 'Не меньше 0'),
  education: z.string().optional(),
  work_type: z.enum(['employee', 'renter', 'owner', 'salon_owner', 'independent', 'chain_owner', 'mobile_master', 'chair_master', 'private_master']),
  profession_type_ids: z.array(z.string().uuid()).min(1, 'Выберите хотя бы один профессиональный тип'),
  published: z.boolean(),
})

export function MasterCabinetPage() {
  const { accessToken, user } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [portfolioCaption, setPortfolioCaption] = useState('')
  const [recoProductId, setRecoProductId] = useState('')
  const [recoComment, setRecoComment] = useState('')
  const [profilePhotoDraft, setProfilePhotoDraft] = useState<string | null>(null)
  const [portfolioDraft, setPortfolioDraft] = useState<string | null>(null)
  const [salonDraft, setSalonDraft] = useState<string | null>(null)

  const orgs = useQuery({
    queryKey: ['orgs-mine'],
    queryFn: () => apiRequest<{ items: OrgItem[] }>('/v1/organizations/mine', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const primaryOrg = orgs.data?.items[0]
  const primaryBranch = primaryOrg?.branches[0]

  const orgReadiness = useQuery({
    queryKey: ['org-readiness', primaryOrg?.organization.id],
    queryFn: () =>
      apiRequest<{ ready: boolean; missing: string[]; checks: Array<{ key: string; label: string; ok: boolean }> }>(
        `/v1/organizations/${primaryOrg!.organization.id}/readiness`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && primaryOrg?.organization.id),
  })

  const branchReadiness = useQuery({
    queryKey: ['branch-readiness', primaryBranch?.id],
    queryFn: () =>
      apiRequest<{ ready: boolean; missing: string[]; checks: Array<{ key: string; label: string; ok: boolean }> }>(
        `/v1/branches/${primaryBranch!.id}/readiness`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && primaryBranch?.id),
  })

  const master = useQuery({
    queryKey: ['my-master'],
    queryFn: () =>
      apiRequest<{
        master: {
          id: string
          organization_id: string
          branch_id: string | null
          published: boolean
          photo_media_id: string | null
          work_type?: string
          display_name?: string
          city?: string
          bio?: string
          specializations?: string[]
          experience_years?: number
          education?: string
          profession_types?: ProfessionType[]
        }
        services: unknown[]
      }>('/v1/me/master', { token: accessToken }),
    enabled: Boolean(accessToken),
    retry: false,
  })

  const readiness = useQuery({
    queryKey: ['master-readiness'],
    queryFn: () => apiRequest<{ ready: boolean; missing: string[]; checks: Array<{ key: string; label: string; ok: boolean }> }>('/v1/me/master/readiness', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const hours = useQuery({
    queryKey: ['working-hours'],
    queryFn: () => apiRequest<{ items: Array<{ weekday: number; start_minute: number; end_minute: number }> }>('/v1/me/working-hours', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const portfolio = useQuery({
    queryKey: ['my-portfolio'],
    queryFn: () =>
      apiRequest<{ items: Array<{ id: string; media_id: string; caption: string; sort_order: number }> }>(
        '/v1/me/master/portfolio',
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && master.data?.master.id),
  })

  const branchPhotos = useQuery({
    queryKey: ['branch-photos', primaryBranch?.id],
    queryFn: () =>
      apiRequest<{ items: Array<{ id: string; media_id: string; sort_order: number }> }>(
        `/v1/branches/${primaryBranch!.id}/photos`,
      ),
    enabled: Boolean(primaryBranch?.id),
  })

  const orgProducts = useQuery({
    queryKey: ['commerce-products-reco', primaryOrg?.organization.id],
    queryFn: () =>
      apiRequest<{ items: Array<{ id: string; name: string; brand: string; published: boolean }> }>(
        `/v1/commerce/products?organization_id=${primaryOrg!.organization.id}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && primaryOrg?.organization.id),
  })

  const myRecommendations = useQuery({
    queryKey: ['my-recommendations'],
    queryFn: () =>
      apiRequest<{ items: Array<{ id: string; product_id: string; comment: string; created_at: string }> }>(
        '/v1/commerce/recommendations/mine',
        { token: accessToken },
      ),
    enabled: Boolean(accessToken),
  })

  const orgForm = useForm<z.infer<typeof orgSchema>>({ resolver: zodResolver(orgSchema) })
  const branchForm = useForm<{ phone: string }>({
    defaultValues: { phone: '' },
  })
  const masterForm = useForm<z.infer<typeof masterSchema>>({
    resolver: zodResolver(masterSchema),
    defaultValues: {
      published: false,
      display_name: user?.display_name ?? '',
      city: 'Красноярск',
      experience_years: 1,
      education: '',
      work_type: 'independent',
      profession_type_ids: [],
    },
  })

  useEffect(() => {
    const m = master.data?.master
    if (!m) return
    masterForm.reset({
      display_name: m.display_name || user?.display_name || '',
      city: m.city || 'Красноярск',
      bio: m.bio ?? '',
      specializations: (m.specializations ?? []).join(', '),
      experience_years: m.experience_years ?? 1,
      education: m.education ?? '',
      work_type: (m.work_type as z.infer<typeof masterSchema>['work_type']) || 'independent',
      profession_type_ids: selectedProfessionIds(m),
      published: Boolean(m.published),
    })
  }, [master.data, masterForm, user?.display_name])

  const createOrg = useMutation({
    mutationFn: async (values: z.infer<typeof orgSchema>) => {
      const res = await apiRequest<{ branch: { id: string } }>('/v1/organizations', {
        token: accessToken,
        body: { name: values.name, branch_name: values.branch_name, city: values.city, address_line: values.address_line, type: 'salon' },
      })
      const phone = (values.phone ?? '').trim()
      if (phone && res.branch?.id) {
        await apiRequest(`/v1/branches/${res.branch.id}`, { method: 'PATCH', token: accessToken, body: { phone } })
      }
      return res
    },
    onSuccess: async () => {
      setOk('Салон создан')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['orgs-mine'] })
      await qc.invalidateQueries({ queryKey: ['org-readiness'] })
      await qc.invalidateQueries({ queryKey: ['branch-readiness'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка создания салона'),
  })

  const saveBranch = useMutation({
    mutationFn: (values: { phone: string }) => {
      const branch = primaryBranch
      if (!branch) throw new ApiError('Нет филиала', 'validation_error', 400)
      return apiRequest(`/v1/branches/${branch.id}`, {
        method: 'PATCH',
        token: accessToken,
        body: { phone: values.phone.trim() },
      })
    },
    onSuccess: async () => {
      setOk('Данные филиала сохранены')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['orgs-mine'] })
      await qc.invalidateQueries({ queryKey: ['org-readiness'] })
      await qc.invalidateQueries({ queryKey: ['branch-readiness'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка сохранения филиала'),
  })

  const publishBranch = useMutation({
    mutationFn: (published: boolean) => {
      const branch = primaryBranch
      if (!branch) throw new ApiError('Нет филиала', 'validation_error', 400)
      return apiRequest(`/v1/branches/${branch.id}`, {
        method: 'PATCH',
        token: accessToken,
        body: { published },
      })
    },
    onSuccess: async () => {
      setOk('Статус публикации филиала обновлён')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['orgs-mine'] })
      await qc.invalidateQueries({ queryKey: ['org-readiness'] })
      await qc.invalidateQueries({ queryKey: ['branch-readiness'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось опубликовать филиал'),
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
          experience_years: values.experience_years,
          education: values.education ?? '',
          work_type: values.work_type,
          profession_type_ids: values.profession_type_ids,
          published: values.published,
        },
      })
    },
    onSuccess: async () => {
      setOk('Профиль мастера сохранён')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['my-master'] })
      await qc.invalidateQueries({ queryKey: ['master-readiness'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка профиля'),
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
      await qc.invalidateQueries({ queryKey: ['master-readiness'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка расписания'),
  })

  async function attachProfilePhoto(mediaId: string | null) {
    if (!mediaId) {
      setProfilePhotoDraft(null)
      return
    }
    if (!accessToken) return
    const org = orgs.data?.items[0]
    if (!org) {
      setError('Сначала создайте салон')
      toast.error('Сначала создайте салон')
      setProfilePhotoDraft(null)
      return
    }
    setError(null)
    try {
      await apiRequest('/v1/me/master', {
        method: 'PUT',
        token: accessToken,
        body: {
          organization_id: org.organization.id,
          branch_id: org.branches[0]?.id,
          display_name: masterForm.getValues('display_name') || user?.display_name || '',
          city: masterForm.getValues('city') || 'Красноярск',
          bio: masterForm.getValues('bio') ?? '',
          specializations: (masterForm.getValues('specializations') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
          experience_years: masterForm.getValues('experience_years') ?? 0,
          education: masterForm.getValues('education') ?? '',
          published: masterForm.getValues('published') ?? false,
          work_type: masterForm.getValues('work_type') ?? 'independent',
          photo_media_id: mediaId,
        },
      })
      setProfilePhotoDraft(null)
      setOk('Фото профиля сохранено')
      toast.success('Фото профиля сохранено')
      await qc.invalidateQueries({ queryKey: ['my-master'] })
    } catch (e) {
      const msg = userError(e, 'Не удалось загрузить фото')
      setError(msg)
      toast.error(msg)
      setProfilePhotoDraft(null)
    }
  }

  async function attachPortfolioPhoto(mediaId: string | null) {
    if (!mediaId) {
      setPortfolioDraft(null)
      return
    }
    if (!accessToken) return
    setError(null)
    try {
      await apiRequest('/v1/me/master/portfolio', {
        token: accessToken,
        body: { media_id: mediaId, caption: portfolioCaption.trim() },
      })
      setPortfolioCaption('')
      setPortfolioDraft(null)
      setOk('Работа добавлена в портфолио')
      toast.success('Работа добавлена в портфолио')
      await qc.invalidateQueries({ queryKey: ['my-portfolio'] })
    } catch (e) {
      const msg = userError(e, 'Не удалось загрузить в портфолио')
      setError(msg)
      toast.error(msg)
      setPortfolioDraft(null)
    }
  }

  async function attachSalonPhoto(mediaId: string | null) {
    if (!mediaId) {
      setSalonDraft(null)
      return
    }
    if (!accessToken || !primaryBranch) return
    setError(null)
    try {
      await apiRequest(`/v1/branches/${primaryBranch.id}/photos`, {
        token: accessToken,
        body: { media_id: mediaId, sort_order: branchPhotos.data?.items.length ?? 0 },
      })
      setSalonDraft(null)
      setOk('Фото салона добавлено')
      toast.success('Фото салона добавлено')
      await qc.invalidateQueries({ queryKey: ['branch-photos', primaryBranch.id] })
    } catch (e) {
      const msg = userError(e, 'Не удалось загрузить фото салона')
      setError(msg)
      toast.error(msg)
      setSalonDraft(null)
    }
  }

  const deleteBranchPhoto = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/branches/${primaryBranch!.id}/photos/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      setOk('Фото салона удалено')
      await qc.invalidateQueries({ queryKey: ['branch-photos'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось удалить'),
  })

  const deletePortfolioItem = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/me/master/portfolio/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      setOk('Работа удалена из портфолио')
      await qc.invalidateQueries({ queryKey: ['my-portfolio'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось удалить'),
  })

  const createRecommendation = useMutation({
    mutationFn: () =>
      apiRequest('/v1/commerce/recommendations', {
        token: accessToken,
        body: { product_id: recoProductId, comment: recoComment.trim() },
      }),
    onSuccess: async () => {
      setOk('Рекомендация создана')
      setRecoComment('')
      setRecoProductId('')
      await qc.invalidateQueries({ queryKey: ['my-recommendations'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось создать рекомендацию'),
  })

  const deleteRecommendation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/commerce/recommendations/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['my-recommendations'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось удалить рекомендацию'),
  })

  return (
    <main className="page stack">
      <h1>Кабинет мастера</h1>
      <p>Настройте салон, профиль и расписание — затем покажитесь клиентам в поиске.</p>
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      <section className="card stack">
        <h2>Что ещё заполнить</h2>
        {readiness.isLoading && <div className="state-box">Проверяем профиль…</div>}
        {readiness.isError && <div className="state-box error">Не удалось проверить готовность</div>}
        {readiness.data && (
          <>
            <p>
              {readiness.data.ready
                ? 'Всё готово — можно публиковать профиль в поиске.'
                : 'Отметьте пункты ниже, чтобы открыть запись клиентам.'}
            </p>
            <div className="list">
              {readiness.data.checks.filter((c) => !c.ok).slice(0, 4).map((c) => (
                <div key={c.key} className="list-item">
                  <div className="row between">
                    <strong>{c.label}</strong>
                    <span className="badge badge-warning">Нужно</span>
                  </div>
                </div>
              ))}
              {readiness.data.ready && (
                <div className="state-box success">Профиль готов к публикации</div>
              )}
            </div>
          </>
        )}
      </section>

      <section className="card stack">
        <h2>1. Салон</h2>
        {orgs.isLoading && <div className="state-box">Загрузка…</div>}
        {orgs.isError && <div className="state-box error">Не удалось загрузить организации</div>}
        {orgs.data && orgs.data.items.length > 0 ? (
          <div className="stack-sm">
            {orgs.data.items.map((item) => (
              <div key={item.organization.id} className="stack-sm">
                <strong>{item.organization.name}</strong>
                <p>{item.branches[0]?.city}, {item.branches[0]?.address_line}</p>
                <p className="muted">
                  Филиал: {item.branches[0]?.published ? 'опубликован' : 'скрыт'}
                  {item.branches[0]?.phone ? ` · ${item.branches[0].phone}` : ' · телефон не указан'}
                </p>
              </div>
            ))}
            {primaryBranch && (
              <form className="stack" onSubmit={branchForm.handleSubmit((v) => saveBranch.mutate(v))}>
                <div className="field">
                  <label>Телефон филиала</label>
                  <input
                    defaultValue={primaryBranch.phone ?? ''}
                    {...branchForm.register('phone')}
                    placeholder="+7 999 000-00-00"
                  />
                </div>
                <button className="btn btn-primary btn-block" type="submit" disabled={saveBranch.isPending}>
                  Сохранить телефон
                </button>
              </form>
            )}
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
            <div className="field">
              <label>Телефон</label>
              <input {...orgForm.register('phone')} placeholder="+7 999 000-00-00" />
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={createOrg.isPending}>Создать салон</button>
          </form>
        ) : null}
      </section>

      {primaryOrg && (
        <section className="card stack">
          <h2>Публикация салона</h2>
          {orgReadiness.data && !orgReadiness.data.ready && (
            <p className="muted">Заполните контакты филиала, чтобы опубликовать салон для клиентов.</p>
          )}
          {branchReadiness.data && primaryBranch && (
            <>
              <p>
                Филиал «{primaryBranch.name}»: {primaryBranch.published ? 'опубликован' : 'скрыт'}
              </p>
              <div className="row">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={publishBranch.isPending || !branchReadiness.data.ready || primaryBranch.published}
                  onClick={() => publishBranch.mutate(true)}
                >
                  Опубликовать филиал
                </button>
                {primaryBranch.published && (
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={publishBranch.isPending}
                    onClick={() => publishBranch.mutate(false)}
                  >
                    Скрыть филиал
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      )}

      <section className="card stack">
        <h2>2. Профиль мастера</h2>
        {master.isError && <div className="state-box">Профиль ещё не создан — заполните форму ниже</div>}
        <div className="stack-sm">
          <h3>Фото профиля</h3>
          {master.data?.master.photo_media_id ? (
            <div className="avatar-circle" style={{ width: 120, height: 120 }}>
              <MediaImage mediaId={master.data.master.photo_media_id} token={accessToken} alt="Профиль" />
            </div>
          ) : (
            <p className="state-box">Фото профиля не загружено</p>
          )}
          <MediaDropzone
            purpose="profile"
            value={profilePhotoDraft}
            onChange={(mediaId) => {
              setProfilePhotoDraft(mediaId)
              if (mediaId) void attachProfilePhoto(mediaId)
            }}
            label="Загрузить фото профиля"
          />
        </div>
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
          <ProfessionTypePicker
            value={masterForm.watch('profession_type_ids') ?? []}
            lockedIds={(master.data?.master.profession_types ?? []).filter((t) => t.locked_at).map((t) => t.id)}
            onChange={(ids) => masterForm.setValue('profession_type_ids', ids, { shouldValidate: true, shouldDirty: true })}
            error={masterForm.formState.errors.profession_type_ids?.message}
          />
          <div className="field">
            <label>Дополнительные теги</label>
            <input {...masterForm.register('specializations')} placeholder="Свадебные укладки, мужские стрижки" />
            <p className="muted">Свободные теги для поиска. Не дублируют профессиональный тип.</p>
          </div>
          <div className="field">
            <label>Опыт, лет</label>
            <input type="number" {...masterForm.register('experience_years')} />
            {masterForm.formState.errors.experience_years && <span className="error">{masterForm.formState.errors.experience_years.message}</span>}
          </div>
          <div className="field"><label>Образование</label><input {...masterForm.register('education')} /></div>
          <div className="field">
            <label htmlFor="work_type">Формат занятости</label>
            <select id="work_type" {...masterForm.register('work_type')}>
              {WORK_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <label className="field-check"><input type="checkbox" {...masterForm.register('published')} /><span>Показать профиль в поиске</span></label>
          <button className="btn btn-primary btn-block" type="submit" disabled={saveMaster.isPending}>Сохранить профиль</button>
        </form>
        {master.data && (
          <p className="muted">
            {master.data.master.published ? 'В поиске' : 'Скрыт'}
            {' · '}
            {workTypeLabel(master.data.master.work_type)}
            {' · услуг: '}
            {master.data.services.length}
          </p>
        )}
      </section>

      <section className="card stack">
        <h2>Фото салона</h2>
        <p className="muted">Фото филиала видны клиентам без входа (purpose salon).</p>
        {!primaryBranch && <div className="state-box">Сначала создайте салон и филиал</div>}
        {branchPhotos.isLoading && <div className="state-box">Загрузка фото…</div>}
        <div className="list">
          {branchPhotos.data?.items.map((item) => (
            <article key={item.id} className="list-item stack-sm">
              <MediaImage mediaId={item.media_id} token={accessToken} alt="Салон" className="portfolio-thumb" />
              <button
                className="btn btn-secondary btn-compact"
                type="button"
                disabled={deleteBranchPhoto.isPending}
                onClick={() => deleteBranchPhoto.mutate(item.id)}
              >
                Удалить
              </button>
            </article>
          ))}
        </div>
        {branchPhotos.data && branchPhotos.data.items.length === 0 && (
          <div className="state-box">Фото салона пока нет</div>
        )}
        <MediaDropzone
          purpose="salon"
          value={salonDraft}
          onChange={(mediaId) => {
            setSalonDraft(mediaId)
            if (mediaId) void attachSalonPhoto(mediaId)
          }}
          label="Добавить фото филиала"
          disabled={!primaryBranch}
        />
      </section>

      <section className="card stack">
        <h2>Портфолио</h2>
        <p className="muted">Загрузите фото работ — они будут видны клиентам на странице мастера.</p>
        {portfolio.isLoading && <div className="state-box">Загрузка портфолио…</div>}
        {portfolio.isError && <div className="state-box error">Не удалось загрузить портфолио</div>}
        <div className="list">
          {portfolio.data?.items.map((item) => (
            <article key={item.id} className="list-item stack-sm">
              <MediaImage mediaId={item.media_id} token={accessToken} alt={item.caption || 'Работа'} className="portfolio-thumb" />
              {item.caption && <p>{item.caption}</p>}
              <button
                className="btn btn-secondary btn-compact"
                type="button"
                disabled={deletePortfolioItem.isPending}
                onClick={() => deletePortfolioItem.mutate(item.id)}
              >
                Удалить
              </button>
            </article>
          ))}
        </div>
        {portfolio.data && portfolio.data.items.length === 0 && (
          <div className="state-box">Портфолио пока пусто</div>
        )}
        <div className="field">
          <label htmlFor="portfolio-caption">Подпись (необязательно)</label>
          <input id="portfolio-caption" value={portfolioCaption} onChange={(e) => setPortfolioCaption(e.target.value)} />
        </div>
        <MediaDropzone
          purpose="portfolio"
          value={portfolioDraft}
          onChange={(mediaId) => {
            setPortfolioDraft(mediaId)
            if (mediaId) void attachPortfolioPhoto(mediaId)
          }}
          label="Добавить работу в портфолио"
          disabled={!master.data}
        />
      </section>

      <section className="card stack">
        <h2>Рекомендовать товар клиентам</h2>
        <p className="muted">Общая рекомендация появится у всех ваших клиентов в магазине.</p>
        {orgProducts.isLoading && <div className="state-box">Загрузка товаров…</div>}
        <div className="field">
          <label htmlFor="reco-product">Товар</label>
          <select
            id="reco-product"
            value={recoProductId}
            onChange={(e) => setRecoProductId(e.target.value)}
          >
            <option value="">Выберите товар</option>
            {orgProducts.data?.items.filter((p) => p.published).map((p) => (
              <option key={p.id} value={p.id}>{p.brand ? `${p.brand} · ` : ''}{p.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="reco-comment">Комментарий</label>
          <input id="reco-comment" value={recoComment} onChange={(e) => setRecoComment(e.target.value)} placeholder="Почему рекомендуете" />
        </div>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!recoProductId || createRecommendation.isPending}
          onClick={() => createRecommendation.mutate()}
        >
          Рекомендовать
        </button>
        {myRecommendations.data && myRecommendations.data.items.length > 0 && (
          <div className="list">
            {myRecommendations.data.items.map((r) => {
              const product = orgProducts.data?.items.find((p) => p.id === r.product_id)
              return (
                <article key={r.id} className="list-item">
                  <div className="row between">
                    <strong>{product ? `${product.brand ? `${product.brand} · ` : ''}${product.name}` : 'Товар'}</strong>
                    <button
                      className="btn btn-secondary btn-compact"
                      type="button"
                      disabled={deleteRecommendation.isPending}
                      onClick={() => deleteRecommendation.mutate(r.id)}
                    >
                      Удалить
                    </button>
                  </div>
                  {r.comment && <p>{r.comment}</p>}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="card stack">
        <h2>3. Услуги</h2>
        <p className="muted">Прайс и длительности удобнее вести на отдельной странице.</p>
        <div className="row">
          <Link className="btn btn-primary" to="/services">Управлять услугами</Link>
          <span className="muted">Сейчас: {master.data?.services.length ?? 0}</span>
        </div>
      </section>

      <section className="card stack">
        <h2>4. Расписание</h2>
        <p>Рабочие часы по умолчанию: пн–пт 10:00–19:00. Исключения дней — в календаре.</p>
        {hours.isError && <div className="state-box error">Не удалось загрузить расписание</div>}
        <div className="row">
          <button className="btn btn-primary" type="button" disabled={saveHours.isPending} onClick={() => saveHours.mutate()}>
            Установить пн–пт 10:00–19:00
          </button>
          <Link className="btn btn-secondary" to="/calendar">Календарь и исключения</Link>
        </div>
        {hours.data && hours.data.items.length > 0 && (
          <p className="muted">Сохранено интервалов: {hours.data.items.length}</p>
        )}
        {hours.data && hours.data.items.length === 0 && (
          <div className="state-box">Расписание ещё не задано</div>
        )}
      </section>

      <section className="card stack">
        <h2>5. Склад и материалы</h2>
        <p>Товары и остатки создаются приёмкой — без начальных сидов.</p>
        <div className="row">
          <Link className="btn btn-primary" to="/inventory">Мой склад</Link>
          <Link className="btn btn-secondary" to="/reports">Отчёты салона</Link>
          <Link className="btn btn-secondary" to="/cosmetics">Косметика</Link>
        </div>
      </section>
    </main>
  )
}
