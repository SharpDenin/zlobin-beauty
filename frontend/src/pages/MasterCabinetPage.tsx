import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest, ApiError } from '@/shared/api/client'
import { userError, formatUserError } from '@/shared/lib/app-error'
import { useAuth } from '@/features/auth/AuthProvider'
import { WorkFormatPicker } from '@/shared/ui/WorkFormatPicker'
import { hasLegacyEmployeeFormat, primaryWorkType, uniqueCanonicalWorkTypes, workTypesLabel } from '@/shared/lib/work-types'
import { ProfessionTypePicker, useProfessionTypes } from '@/shared/ui/ProfessionTypePicker'
import { SpecializationPicker } from '@/shared/ui/SpecializationPicker'
import type { ProfessionType } from '@/shared/lib/profession-types'
import { selectedProfessionIds } from '@/shared/lib/profession-types'
import {
  filterSpecializationsForSlugs,
  incompatibleSpecializations,
  slugsForProfessionIds,
  uniqueSpecializationTags,
} from '@/shared/lib/master-specializations'
import { useFormDraft } from '@/shared/lib/useFormDraft'
import { MediaDropzone } from '@/shared/ui/MediaDropzone'
import { MediaImage } from '@/shared/ui/MediaImage'
import { Modal } from '@/shared/ui/Modal'
import { useToast } from '@/shared/ui/Toast'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { moderationError } from '@/shared/lib/moderation'
import {
  incompleteChecks,
  readinessAnchor,
  readinessFieldHint,
} from '@/shared/lib/master-profile-readiness'
import { CreateSalonForm, type CreateSalonPayload } from '@/shared/ui/CreateSalonForm'
import { useCabinet } from '@/shared/lib/cabinet'

type OrgItem = {
  organization: { id: string; name: string; type: string; published: boolean; description: string; city?: string; address_line?: string }
  branches: Array<{ id: string; name: string; city: string; address_line: string; phone: string; published: boolean }>
  roles: string[]
}

const masterSchema = z.object({
  display_name: z.string().min(2, 'Укажите имя'),
  city: z.string().min(2, 'Укажите город'),
  bio: z.string().optional(),
  specializations: z.array(z.string()).min(1, 'Выберите хотя бы одну специализацию'),
  experience_years: z.coerce.number().int().min(0, 'Не меньше 0'),
  education: z.string().optional(),
  work_types: z.array(z.string()).min(1, 'Выберите формат работы'),
  profession_type_ids: z.array(z.string().uuid()).min(1, 'Выберите хотя бы один тип мастера'),
  published: z.boolean(),
})

export function MasterCabinetPage() {
  const { accessToken, user } = useAuth()
  const cabinet = useCabinet()
  const qc = useQueryClient()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [portfolioCaption, setPortfolioCaption] = useState('')
  const [profilePhotoDraft, setProfilePhotoDraft] = useState<string | null>(null)
  const [portfolioDraft, setPortfolioDraft] = useState<string | null>(null)
  const [salonDraft, setSalonDraft] = useState<string | null>(null)
  const [typeChangePending, setTypeChangePending] = useState<{
    nextIds: string[]
    dropping: string[]
  } | null>(null)

  const orgs = useQuery({
    queryKey: ['orgs-mine'],
    queryFn: () => apiRequest<{ items: OrgItem[] }>('/v1/organizations/mine', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  // Prefer active org context (sx.selectedOrg); fall back to first salon only when unset/stale.
  const salonItems = (orgs.data?.items ?? []).filter((o) => o.organization.type !== 'supplier')
  const primaryOrg =
    (cabinet.selectedOrg && cabinet.selectedOrg.organization.type !== 'supplier'
      ? (salonItems.find((o) => o.organization.id === cabinet.selectedOrg!.organization.id) ?? null)
      : null)
    ?? salonItems[0]
  const primaryBranch =
    (primaryOrg
      && cabinet.selectedOrg?.organization.id === primaryOrg.organization.id
      && cabinet.selectedBranch
      && primaryOrg.branches.some((b) => b.id === cabinet.selectedBranch!.id)
      ? primaryOrg.branches.find((b) => b.id === cabinet.selectedBranch!.id) ?? null
      : null)
    ?? primaryOrg?.branches[0]

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
          work_types?: string[]
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
      apiRequest<{ items: Array<{ id: string; media_id: string; caption: string; media_type?: string; sort_order: number }> }>(
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
      specializations: [],
      work_types: ['private_practice'],
      profession_type_ids: [],
    },
  })
  const masterDraft = useFormDraft(masterForm, 'master-profile-form')
  const watchedWorkTypes = masterForm.watch('work_types')
  const watchedProfessionIds = masterForm.watch('profession_type_ids')
  const watchedSpecializations = masterForm.watch('specializations')
  const professionCatalog = useProfessionTypes()
  const professionSlugs = useMemo(
    () => slugsForProfessionIds(watchedProfessionIds ?? [], professionCatalog.data?.items ?? []),
    [watchedProfessionIds, professionCatalog.data?.items],
  )
  const hasSalon = Boolean(master.data?.master.organization_id || orgs.data?.items.some((o) => o.organization.type !== 'supplier'))
  const legacyEmployee = hasLegacyEmployeeFormat(
    master.data?.master.work_types?.length
      ? master.data.master.work_types
      : master.data?.master.work_type,
  )
  const missingChecks = incompleteChecks(readiness.data?.checks)
  const fieldHint = (key: string) => readinessFieldHint(readiness.data?.checks, key)

  useEffect(() => {
    if (primaryBranch) {
      branchForm.reset({ phone: primaryBranch.phone ?? '' })
    }
  }, [primaryBranch, branchForm])

  useEffect(() => {
    const m = master.data?.master
    if (!m) {
      try {
        const types = JSON.parse(sessionStorage.getItem('sx.onboard.profession_types') || '[]') as string[]
        const wts = JSON.parse(sessionStorage.getItem('sx.onboard.work_types') || 'null') as string[] | null
        const wt = sessionStorage.getItem('sx.onboard.work_type')
        if (Array.isArray(types) && types.length) {
          masterForm.setValue('profession_type_ids', types, { shouldDirty: true })
        }
        if (Array.isArray(wts) && wts.length) {
          masterForm.setValue('work_types', uniqueCanonicalWorkTypes(wts))
        } else if (wt) {
          masterForm.setValue('work_types', uniqueCanonicalWorkTypes([wt]))
        }
      } catch { /* ignore malformed onboard cache */ }
      return
    }
    const types = uniqueCanonicalWorkTypes(m.work_types?.length ? m.work_types : [m.work_type || 'private_practice'])
    masterForm.reset({
      display_name: m.display_name || user?.display_name || '',
      city: m.city || 'Красноярск',
      bio: m.bio ?? '',
      specializations: uniqueSpecializationTags(m.specializations),
      experience_years: m.experience_years ?? 1,
      education: m.education ?? '',
      work_types: types.length ? types : ['private_practice'],
      profession_type_ids: selectedProfessionIds(m),
      published: Boolean(m.published),
    })
  }, [master.data, masterForm, user?.display_name])

  function applyProfessionTypeIds(nextIds: string[]) {
    const slugs = slugsForProfessionIds(nextIds, professionCatalog.data?.items ?? [])
    const current = uniqueSpecializationTags(masterForm.getValues('specializations'))
    const dropping = incompatibleSpecializations(current, slugs)
    if (dropping.length > 0) {
      setTypeChangePending({ nextIds, dropping })
      return
    }
    masterForm.setValue('profession_type_ids', nextIds, { shouldValidate: true, shouldDirty: true })
    masterForm.setValue('specializations', filterSpecializationsForSlugs(current, slugs), {
      shouldValidate: true,
      shouldDirty: true,
    })
  }

  function confirmProfessionTypeChange() {
    if (!typeChangePending) return
    const { nextIds } = typeChangePending
    const slugs = slugsForProfessionIds(nextIds, professionCatalog.data?.items ?? [])
    const kept = filterSpecializationsForSlugs(masterForm.getValues('specializations'), slugs)
    masterForm.setValue('profession_type_ids', nextIds, { shouldValidate: true, shouldDirty: true })
    masterForm.setValue('specializations', kept, { shouldValidate: true, shouldDirty: true })
    setTypeChangePending(null)
  }

  const createOrg = useMutation({
    mutationFn: async (payload: CreateSalonPayload) => {
      const { phone, ...body } = payload
      const res = await apiRequest<{ organization: { id: string }; branch: { id: string } | null }>('/v1/organizations', {
        token: accessToken,
        body,
      })
      if (phone && res.branch?.id) {
        await apiRequest(`/v1/branches/${res.branch.id}`, { method: 'PATCH', token: accessToken, body: { phone } })
      }
      return res
    },
    onSuccess: async (res) => {
      setOk('Салон создан')
      setError(null)
      if (res.organization?.id) cabinet.setSelectedOrgId(res.organization.id)
      await qc.invalidateQueries({ queryKey: ['orgs-mine'] })
      await qc.invalidateQueries({ queryKey: ['org-readiness'] })
      await qc.invalidateQueries({ queryKey: ['branch-readiness'] })
    },
    onError: (e) => setError(formatUserError(e, 'Ошибка создания салона')),
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
      setOk('Телефон филиала сохранён')
      setError(null)
      toast.success('Телефон филиала сохранён')
      await qc.invalidateQueries({ queryKey: ['orgs-mine'] })
      await qc.invalidateQueries({ queryKey: ['org-readiness'] })
      await qc.invalidateQueries({ queryKey: ['branch-readiness'] })
    },
    onError: (e) => {
      setOk(null)
      const msg = formatUserError(e, 'Не удалось сохранить телефон')
      setError(msg)
      toast.error(msg)
    },
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
    onError: (e) => setError(formatUserError(e, 'Не удалось опубликовать филиал')),
  })

  const saveMaster = useMutation({
    mutationFn: (values: z.infer<typeof masterSchema>) => {
      const specs = filterSpecializationsForSlugs(
        values.specializations,
        slugsForProfessionIds(values.profession_type_ids, professionCatalog.data?.items ?? []),
      )
      if (specs.length === 0) {
        throw new ApiError('Выберите хотя бы одну специализацию', 'validation_error', 400)
      }
      const banned = moderationError(
        [values.display_name, values.bio ?? '', values.education ?? '', specs.join(' ')].join(' '),
      )
      if (banned) throw new ApiError(banned, 'content_not_allowed', 400)
      const org = primaryOrg
      const boundOrg = Boolean(master.data?.master.organization_id)
      const types = uniqueCanonicalWorkTypes(values.work_types)
      return apiRequest('/v1/me/master', {
        method: 'PUT',
        token: accessToken,
        body: {
          ...(org || boundOrg
            ? {
                organization_id: org?.organization.id ?? master.data?.master.organization_id,
                branch_id: primaryBranch?.id ?? org?.branches[0]?.id ?? master.data?.master.branch_id,
              }
            : {}),
          display_name: values.display_name,
          city: values.city,
          bio: values.bio ?? '',
          specializations: specs,
          experience_years: values.experience_years,
          education: values.education ?? '',
          work_type: primaryWorkType(types),
          work_types: types,
          profession_type_ids: values.profession_type_ids,
          published: values.published,
        },
      })
    },
    onSuccess: async () => {
      setOk('Профиль мастера сохранён')
      setError(null)
      toast.success('Профиль мастера сохранён')
      masterDraft.clear()
      sessionStorage.removeItem('sx.onboard.profession_types')
      sessionStorage.removeItem('sx.onboard.work_type')
      sessionStorage.removeItem('sx.onboard.work_types')
      await qc.invalidateQueries({ queryKey: ['my-master'] })
      await qc.invalidateQueries({ queryKey: ['me-master-cabinet'] })
      await qc.invalidateQueries({ queryKey: ['master-readiness'] })
    },
    onError: (e) => {
      setOk(null)
      const msg = formatUserError(e, 'Не удалось сохранить профиль')
      setError(msg)
      toast.error(msg)
    },
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
      toast.success('Расписание сохранено')
      await qc.invalidateQueries({ queryKey: ['working-hours'] })
      await qc.invalidateQueries({ queryKey: ['master-readiness'] })
    },
    onError: (e) => {
      setOk(null)
      const msg = formatUserError(e, 'Не удалось сохранить расписание')
      setError(msg)
      toast.error(msg)
    },
  })

  async function attachProfilePhoto(mediaId: string | null) {
    if (!mediaId) {
      setProfilePhotoDraft(null)
      return
    }
    if (!accessToken) return
    const org = primaryOrg
    const existing = master.data?.master
    const specializations = uniqueSpecializationTags(
      masterForm.getValues('specializations')?.length
        ? masterForm.getValues('specializations')
        : existing?.specializations,
    )
    const workTypes = uniqueCanonicalWorkTypes(
      (masterForm.getValues('work_types')?.length
        ? masterForm.getValues('work_types')
        : existing?.work_types?.length
          ? existing.work_types
          : [existing?.work_type || 'private_practice']) ?? ['private_practice'],
    )
    setError(null)
    setOk(null)
    try {
      await apiRequest('/v1/me/master', {
        method: 'PUT',
        token: accessToken,
        body: {
          ...(org || existing?.organization_id
            ? {
                organization_id: org?.organization.id ?? existing?.organization_id,
                branch_id: primaryBranch?.id ?? org?.branches[0]?.id ?? existing?.branch_id,
              }
            : {}),
          display_name: masterForm.getValues('display_name') || existing?.display_name || user?.display_name || 'Мастер',
          city: masterForm.getValues('city') || existing?.city || 'Красноярск',
          bio: masterForm.getValues('bio') ?? existing?.bio ?? '',
          specializations,
          experience_years: masterForm.getValues('experience_years') ?? existing?.experience_years ?? 0,
          // Education stays in API payload for compatibility; field is hidden in UI (PROF-04).
          education: existing?.education ?? masterForm.getValues('education') ?? '',
          published: masterForm.getValues('published') ?? Boolean(existing?.published),
          work_type: primaryWorkType(workTypes),
          work_types: workTypes,
          photo_media_id: mediaId,
          // Omit profession_type_ids when profile already exists → backend preserves them.
          ...(!existing?.id && (masterForm.getValues('profession_type_ids')?.length ?? 0) > 0
            ? { profession_type_ids: masterForm.getValues('profession_type_ids') }
            : {}),
        },
      })
      setProfilePhotoDraft(null)
      setOk('Фото профиля сохранено')
      toast.success('Фото профиля сохранено')
      await qc.invalidateQueries({ queryKey: ['my-master'] })
      await qc.invalidateQueries({ queryKey: ['master-readiness'] })
    } catch (e) {
      setOk(null)
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
    onError: (e) => setError(formatUserError(e, 'Не удалось удалить')),
  })

  const deletePortfolioItem = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/me/master/portfolio/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      setOk('Работа удалена из портфолио')
      await qc.invalidateQueries({ queryKey: ['my-portfolio'] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось удалить')),
  })

  return (
    <main className="page stack">
      <h1>Профиль мастера</h1>
      <p>Заполните профиль и типы услуг. Салон нужен только если вы владелец или работаете в чужой точке.</p>
      {error && <ErrorBanner error={error} />}
      {ok && <div className="state-box success">{ok}</div>}

      <section className="card stack" id="master-readiness">
        <h2>Что ещё заполнить</h2>
        {readiness.isLoading && <div className="state-box">Проверяем профиль…</div>}
        {readiness.isError && <ErrorBanner error={readiness.error} fallbackTitle="Не удалось проверить готовность" />}
        {readiness.data && (
          <>
            <p>
              {readiness.data.ready
                ? 'Всё готово — можно публиковать профиль в поиске.'
                : 'Не хватает пунктов ниже. Можно сохранять профиль по частям — обязательные поля отмечены у формы.'}
            </p>
            <div className="list" data-testid="master-readiness-missing">
              {missingChecks.map((c) => {
                const anchor = readinessAnchor(c.key)
                return (
                  <div key={c.key} className="list-item">
                    <div className="row between gap wrap">
                      {anchor ? (
                        <a className="master-readiness-link" href={`#${anchor}`}>
                          <strong>{c.label}</strong>
                        </a>
                      ) : (
                        <strong>{c.label}</strong>
                      )}
                      <span className="badge badge-warning">Нужно</span>
                    </div>
                  </div>
                )
              })}
              {readiness.data.ready && (
                <div className="state-box success">Профиль готов к публикации</div>
              )}
            </div>
          </>
        )}
      </section>

      <section className="card stack">
        <h2>Салон</h2>
        <p className="muted">
          Членство в организации не зависит от формата работы.
          {!hasSalon ? ' Салон можно создать здесь или принять приглашение владельца. Филиал необязателен.' : ''}
          {hasSalon ? <> Управление несколькими салонами — в <Link to="/settings/salons">Настройки → Мои салоны</Link>.</> : null}
        </p>
        {orgs.isLoading && <div className="state-box">Загрузка…</div>}
        {orgs.isError && <ErrorBanner error={orgs.error} fallbackTitle="Не удалось загрузить организации" />}
        {orgs.data && orgs.data.items.length > 0 && (
          <div className="stack-sm">
            {orgs.data.items.map((item) => (
              <div key={item.organization.id} className="stack-sm">
                <strong>{item.organization.name}</strong>
                <p>
                  {item.organization.city || item.branches[0]?.city || 'Город не указан'}
                  {(item.organization.address_line || item.branches[0]?.address_line)
                    ? `, ${item.organization.address_line || item.branches[0]?.address_line}`
                    : ''}
                </p>
                <p className="muted">
                  {item.branches.length === 0
                    ? 'Без филиалов'
                    : `Филиал: ${item.branches[0]?.published ? 'опубликован' : 'скрыт'}${item.branches[0]?.phone ? ` · ${item.branches[0].phone}` : ' · телефон не указан'}`}
                </p>
              </div>
            ))}
            {primaryBranch && (
              <form
                className="stack"
                onSubmit={branchForm.handleSubmit((v) => {
                  setOk(null)
                  setError(null)
                  saveBranch.mutate(v)
                })}
              >
                <div className="field" id="branch-phone">
                  <label htmlFor="branch-phone-input">Телефон филиала</label>
                  <input
                    id="branch-phone-input"
                    {...branchForm.register('phone')}
                    placeholder="+7 999 000-00-00"
                    inputMode="tel"
                    autoComplete="tel"
                    aria-invalid={saveBranch.isError ? true : undefined}
                  />
                  {saveBranch.isError && (
                    <span className="error" role="alert">
                      {formatUserError(saveBranch.error, 'Не удалось сохранить телефон')}
                    </span>
                  )}
                  <p className="hint">Сохраняется отдельно от профиля мастера.</p>
                </div>
                <button className="btn btn-primary btn-block" type="submit" disabled={saveBranch.isPending}>
                  {saveBranch.isPending ? 'Сохраняем…' : 'Сохранить телефон'}
                </button>
              </form>
            )}
          </div>
        )}
        {!orgs.isLoading && !orgs.isError && !hasSalon && (
          <CreateSalonForm
            pending={createOrg.isPending}
            defaultCity={user?.city || 'Красноярск'}
            onSubmit={async (payload) => { await createOrg.mutateAsync(payload) }}
          />
        )}
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

      <section className="card stack" id="master-profile">
        <h2>Профиль мастера</h2>
        <p className="muted">Можно заполнять постепенно: фото, имя и город сохраняются отдельно от необязательных полей.</p>
        {master.isError && <div className="state-box">Профиль ещё не создан — заполните форму ниже</div>}
        <div className="stack-sm">
          <h3>Фото профиля</h3>
          {master.data?.master.photo_media_id ? (
            <div className="avatar-circle" style={{ width: 120, height: 120 }}>
              <MediaImage mediaId={master.data.master.photo_media_id} token={accessToken} alt="Профиль" variant="cover" />
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
          <p className="hint">Фото можно сохранить отдельно от полного заполнения профиля.</p>
        </div>
        <form
          className="stack master-profile-form"
          onSubmit={masterForm.handleSubmit((v) => {
            const banned =
              moderationError(v.display_name) ||
              moderationError(v.bio ?? '') ||
              moderationError((v.specializations ?? []).join(' ')) ||
              moderationError(v.education ?? '')
            if (banned) {
              setOk(null)
              setError(banned)
              toast.error(banned)
              return
            }
            setOk(null)
            setError(null)
            saveMaster.mutate(v)
          })}
        >
          {/* Keep education in form state for API compat; UI hidden (PROF-04). */}
          <input type="hidden" {...masterForm.register('education')} />
          <div className="field">
            <label htmlFor="display_name">Имя в поиске</label>
            <input id="display_name" required aria-required="true" aria-invalid={Boolean(masterForm.formState.errors.display_name)} {...masterForm.register('display_name')} />
            {masterForm.formState.errors.display_name && <span className="error">{masterForm.formState.errors.display_name.message}</span>}
            {!masterForm.formState.errors.display_name && fieldHint('display_name') && (
              <span className="hint field-need" role="status">{fieldHint('display_name')}</span>
            )}
          </div>
          <div className="field">
            <label htmlFor="master-city">Город</label>
            <input id="master-city" required aria-required="true" aria-invalid={Boolean(masterForm.formState.errors.city)} {...masterForm.register('city')} />
            {masterForm.formState.errors.city && <span className="error">{masterForm.formState.errors.city.message}</span>}
            {!masterForm.formState.errors.city && fieldHint('city') && (
              <span className="hint field-need" role="status">{fieldHint('city')}</span>
            )}
          </div>
          <div className="field">
            <label htmlFor="master-bio">О себе</label>
            <textarea id="master-bio" {...masterForm.register('bio')} />
            {fieldHint('bio') && <span className="hint field-need" role="status">{fieldHint('bio')}</span>}
          </div>
          <div id="master-profession-types">
            <ProfessionTypePicker
              value={watchedProfessionIds ?? []}
              lockedIds={(master.data?.master.profession_types ?? []).filter((t) => t.locked_at).map((t) => t.id)}
              onChange={applyProfessionTypeIds}
              error={masterForm.formState.errors.profession_type_ids?.message}
            />
            {!masterForm.formState.errors.profession_type_ids && fieldHint('profession_types') && (
              <span className="hint field-need" role="status">{fieldHint('profession_types')}</span>
            )}
          </div>
          <div id="master-specializations">
            <SpecializationPicker
              professionSlugs={professionSlugs}
              value={watchedSpecializations ?? []}
              onChange={(tags) =>
                masterForm.setValue('specializations', uniqueSpecializationTags(tags), {
                  shouldValidate: true,
                  shouldDirty: true,
                })
              }
              error={masterForm.formState.errors.specializations?.message}
            />
            {!masterForm.formState.errors.specializations && fieldHint('specializations') && (
              <span className="hint field-need" role="status">{fieldHint('specializations')}</span>
            )}
          </div>
          <div className="field">
            <label htmlFor="master-experience">Опыт, лет</label>
            <input id="master-experience" type="number" inputMode="numeric" {...masterForm.register('experience_years')} />
            {masterForm.formState.errors.experience_years && <span className="error">{masterForm.formState.errors.experience_years.message}</span>}
            {!masterForm.formState.errors.experience_years && fieldHint('experience') && (
              <span className="hint field-need" role="status">{fieldHint('experience')}</span>
            )}
          </div>
          <WorkFormatPicker
            value={watchedWorkTypes ?? ['private_practice']}
            onChange={(ids) => masterForm.setValue('work_types', ids, { shouldValidate: true, shouldDirty: true })}
            error={masterForm.formState.errors.work_types?.message}
          />
          {legacyEmployee && (
            <p className="muted" role="status">
              В профиле осталось устаревшее значение «employee». Выберите актуальные форматы работы и сохраните — оно не преобразуется автоматически.
            </p>
          )}
          <button className="btn btn-primary btn-block" type="submit" disabled={saveMaster.isPending}>
            {saveMaster.isPending ? 'Сохраняем…' : 'Сохранить профиль'}
          </button>
        </form>
        {master.data && (
          <p className="muted">
            {workTypesLabel(master.data.master.work_types?.length ? master.data.master.work_types : [master.data.master.work_type || ''])}
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
        {portfolio.isError && <ErrorBanner error={portfolio.error} fallbackTitle="Не удалось загрузить портфолио" />}
        <div className="list">
          {portfolio.data?.items.map((item) => (
            <article key={item.id} className="list-item stack-sm">
              <MediaImage
                mediaId={item.media_id}
                token={accessToken}
                alt={item.caption || 'Работа'}
                className="portfolio-thumb"
                stillFrame={item.media_type === 'gif'}
              />
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

      <section className="card stack" id="master-services">
        <h2>3. Услуги</h2>
        <p className="muted">Прайс и длительности удобнее вести на отдельной странице.</p>
        {fieldHint('service') && <span className="hint field-need" role="status">{fieldHint('service')}</span>}
        <div className="row wrap gap">
          <Link className="btn btn-primary" to="/services">Управлять услугами</Link>
          <span className="muted">Сейчас: {master.data?.services.length ?? 0}</span>
        </div>
      </section>

      <section className="card stack" id="master-schedule">
        <h2>4. Расписание</h2>
        {fieldHint('schedule') && <span className="hint field-need" role="status">{fieldHint('schedule')}</span>}
        <p>Рабочие часы по умолчанию: пн–пт 10:00–19:00. Исключения дней — в календаре.</p>
        {hours.isError && <ErrorBanner error={hours.error} fallbackTitle="Не удалось загрузить расписание" />}
        <div className="row">
          <button className="btn btn-primary" type="button" disabled={saveHours.isPending} onClick={() => saveHours.mutate()}>
            Установить пн–пт 10:00–19:00
          </button>
          <Link className="btn btn-secondary" to="/calendar?panel=schedule">Установка графика</Link>
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

      <Modal
        open={Boolean(typeChangePending)}
        onClose={() => setTypeChangePending(null)}
        title="Сменить тип мастера?"
        size="sm"
        footer={(
          <div className="row gap wrap">
            <button type="button" className="btn btn-secondary" onClick={() => setTypeChangePending(null)}>
              Отмена
            </button>
            <button type="button" className="btn btn-primary" data-testid="confirm-profession-type-change" onClick={confirmProfessionTypeChange}>
              Сменить и убрать теги
            </button>
          </div>
        )}
      >
        <p>
          Некоторые выбранные специализации не подходят к новому типу и будут сняты:
        </p>
        <ul className="stack-sm">
          {(typeChangePending?.dropping ?? []).map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      </Modal>
    </main>
  )
}
