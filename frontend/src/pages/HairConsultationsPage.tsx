import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { userError } from '@/shared/lib/app-error'
import { formatMoney } from '@/shared/lib/money'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { MediaDropzone } from '@/shared/ui/MediaDropzone'
import { MediaImage } from '@/shared/ui/MediaImage'
import { Modal } from '@/shared/ui/Modal'
import { useMessenger } from '@/features/messenger/MessengerProvider'
import { openConversation } from '@/features/messenger/api'
import { toast } from '@/shared/ui/Toast'

type MediaRow = { id: string; media_id: string; slot: string; uploaded_by: string; created_at: string }

type Version = {
  id: string
  version_no: number
  status: string
  client_questionnaire: Record<string, unknown>
  master_assessment: Record<string, unknown>
  plan: Record<string, unknown>
  client_comment: string
  created_by: string
  submitted_at?: string | null
  sent_at?: string | null
  approved_at?: string | null
  immutable_at?: string | null
  updated_at?: string
  media: MediaRow[]
}

type EventRow = {
  id: string
  actor_user_id: string
  action: string
  from_status?: string
  to_status: string
  version_id?: string
  meta?: Record<string, unknown>
  created_at: string
}

type Consultation = {
  id: string
  client_user_id: string
  master_user_id: string
  organization_id?: string | null
  client_card_id?: string | null
  status: string
  current_version_id?: string
  conversation_id?: string | null
  created_at: string
  updated_at: string
  current_version?: Version
  versions?: Version[]
  events?: EventRow[]
}

type CatalogService = {
  id: string
  name: string
  category?: string
  price_minor: number
  duration_minutes?: number
  published?: boolean
}

type Questionnaire = {
  hair_type: string
  salon_coloring: boolean
  home_coloring: boolean
  bleaching: boolean
  henna_or_other: string
  last_procedure_date: string
  desired_result: string
  references_note: string
  comments: string
  allergies: string
  dye_reactions: string
  budget: string
  ready_to_maintain: boolean
  root_tone_level: string
  gray_percent: string
  highlighting: string
  light_strands_level: string
}

type Assessment = {
  natural_level_roots: string
  gray_percent: string
  artificial_color: string
  lightened_areas: string
  porosity_roots: string
  porosity_length: string
  porosity_ends: string
  elasticity_roots: string
  elasticity_length: string
  elasticity_ends: string
  texture: string
  diameter: string
  density: string
  scalp_condition: string
  notes: string
}

type Plan = {
  desired_result: string
  technique: string
  zone_map: string
  level_roots: string
  level_length: string
  level_ends: string
  formula: string
  brand_line: string
  shades_ratios: string
  oxidant: string
  processing_time: string
  lightening_or_fill: string
  strand_test: string
  allergy_test: string
  care_recommendations: string
  tone_correction: string
  selected_service_ids: string[]
  price_total_minor: number
}

const emptyQ = (): Questionnaire => ({
  hair_type: '',
  salon_coloring: false,
  home_coloring: false,
  bleaching: false,
  henna_or_other: '',
  last_procedure_date: '',
  desired_result: '',
  references_note: '',
  comments: '',
  allergies: '',
  dye_reactions: '',
  budget: '',
  ready_to_maintain: false,
  root_tone_level: '',
  gray_percent: '',
  highlighting: '',
  light_strands_level: '',
})

const emptyA = (): Assessment => ({
  natural_level_roots: '',
  gray_percent: '',
  artificial_color: '',
  lightened_areas: '',
  porosity_roots: '',
  porosity_length: '',
  porosity_ends: '',
  elasticity_roots: '',
  elasticity_length: '',
  elasticity_ends: '',
  texture: '',
  diameter: '',
  density: '',
  scalp_condition: '',
  notes: '',
})

const emptyP = (): Plan => ({
  desired_result: '',
  technique: '',
  zone_map: '',
  level_roots: '',
  level_length: '',
  level_ends: '',
  formula: '',
  brand_line: '',
  shades_ratios: '',
  oxidant: '',
  processing_time: '',
  lightening_or_fill: '',
  strand_test: '',
  allergy_test: '',
  care_recommendations: '',
  tone_correction: '',
  selected_service_ids: [],
  price_total_minor: 0,
})

const PHOTO_SLOTS: { slot: string; label: string; hint: string }[] = [
  { slot: 'strand_a4', label: 'Прядь на A4', hint: 'Прядь на белом листе A4 при естественном и искусственном свете' },
  { slot: 'overview', label: 'Общий вид', hint: 'При естественном свете, без фильтров' },
  { slot: 'roots', label: 'Корни', hint: 'Крупно корни у пробора' },
  { slot: 'length', label: 'Длина', hint: 'Средняя часть полотна' },
  { slot: 'ends', label: 'Концы', hint: 'Состояние кончиков' },
  { slot: 'reference', label: 'Референс', hint: 'Желаемый образ (необязательно)' },
]

const ROOT_LEVELS = ['3.0', '4.0', '5.0', '6.0', '7.0', '8.0', '9.0', '10.0']
const GRAY_OPTIONS = ['0%', '5%', '10%', '15%', '20%', '30%', '40%', '50%', '70%', '100%']
const LIGHT_LEVELS = ['7–8 уровень', '8–9 уровень', '9–10 уровень', '10+ уровень']

function statusLabel(status: string) {
  switch (status) {
    case 'draft':
      return 'Черновик'
    case 'awaiting_master':
      return 'Ожидает мастера'
    case 'in_progress':
      return 'В работе'
    case 'awaiting_client':
      return 'На согласовании'
    case 'approved':
      return 'Утверждено'
    case 'closed':
      return 'Закрыто'
    case 'submitted':
      return 'Отправлена'
    case 'in_review':
      return 'На оценке'
    case 'sent':
      return 'Отправлен клиенту'
    case 'changes_requested':
      return 'Запрошены правки'
    case 'superseded':
      return 'Заменена'
    default:
      return status
  }
}

function actionLabel(action: string) {
  switch (action) {
    case 'created':
      return 'Создана консультация'
    case 'questionnaire_updated':
      return 'Обновлена анкета'
    case 'questionnaire_submitted':
      return 'Анкета отправлена'
    case 'work_started':
      return 'Мастер начал работу'
    case 'assessment_updated':
      return 'Обновлена оценка'
    case 'plan_updated':
      return 'Обновлён план'
    case 'plan_sent':
      return 'План отправлен'
    case 'changes_requested':
      return 'Запрошены правки'
    case 'plan_approved':
      return 'План утверждён'
    case 'version_created':
      return 'Создана новая версия'
    case 'revision_started':
      return 'Начата доработка'
    case 'media_attached':
      return 'Добавлено фото'
    default:
      return action
  }
}

function asQuestionnaire(raw: Record<string, unknown> | undefined): Questionnaire {
  const q = emptyQ()
  if (!raw) return q
  return {
    ...q,
    hair_type: String(raw.hair_type ?? ''),
    salon_coloring: Boolean(raw.salon_coloring),
    home_coloring: Boolean(raw.home_coloring),
    bleaching: Boolean(raw.bleaching),
    henna_or_other: String(raw.henna_or_other ?? ''),
    last_procedure_date: String(raw.last_procedure_date ?? ''),
    desired_result: String(raw.desired_result ?? ''),
    references_note: String(raw.references_note ?? ''),
    comments: String(raw.comments ?? ''),
    allergies: String(raw.allergies ?? ''),
    dye_reactions: String(raw.dye_reactions ?? ''),
    budget: String(raw.budget ?? ''),
    ready_to_maintain: Boolean(raw.ready_to_maintain),
    root_tone_level: String(raw.root_tone_level ?? ''),
    gray_percent: String(raw.gray_percent ?? ''),
    highlighting: String(raw.highlighting ?? ''),
    light_strands_level: String(raw.light_strands_level ?? ''),
  }
}

function asAssessment(raw: Record<string, unknown> | undefined): Assessment {
  const a = emptyA()
  if (!raw) return a
  const out = { ...a }
  for (const k of Object.keys(a) as (keyof Assessment)[]) {
    if (raw[k] != null) out[k] = String(raw[k])
  }
  return out
}

function asPlan(raw: Record<string, unknown> | undefined): Plan {
  const p = emptyP()
  if (!raw) return p
  const ids = Array.isArray(raw.selected_service_ids)
    ? raw.selected_service_ids.map((x) => String(x)).filter(Boolean)
    : []
  const price =
    typeof raw.price_total_minor === 'number'
      ? raw.price_total_minor
      : Number(raw.price_total_minor) || 0
  return {
    ...p,
    desired_result: String(raw.desired_result ?? ''),
    technique: String(raw.technique ?? ''),
    zone_map: String(raw.zone_map ?? ''),
    level_roots: String(raw.level_roots ?? ''),
    level_length: String(raw.level_length ?? ''),
    level_ends: String(raw.level_ends ?? ''),
    formula: String(raw.formula ?? ''),
    brand_line: String(raw.brand_line ?? ''),
    shades_ratios: String(raw.shades_ratios ?? ''),
    oxidant: String(raw.oxidant ?? ''),
    processing_time: String(raw.processing_time ?? ''),
    lightening_or_fill: String(raw.lightening_or_fill ?? ''),
    strand_test: String(raw.strand_test ?? ''),
    allergy_test: String(raw.allergy_test ?? ''),
    care_recommendations: String(raw.care_recommendations ?? ''),
    tone_correction: String(raw.tone_correction ?? ''),
    selected_service_ids: ids,
    price_total_minor: price,
  }
}

function hairCategory(name: string, category?: string): 'main' | 'popular' {
  const hay = `${category ?? ''} ${name}`.toLowerCase()
  if (/уход|ботокс|кератин|кончик|восстанов|стрижк/.test(hay)) return 'popular'
  return 'main'
}

export function HairConsultationsPage() {
  const { accessToken } = useAuth()
  const cabinet = useCabinet()
  const isMaster = cabinet.kind !== 'client' && cabinet.kind !== 'supplier' && cabinet.kind !== 'supplier_rep'
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [masterId, setMasterId] = useState(searchParams.get('master') || '')
  const [masterQuery, setMasterQuery] = useState('')

  const list = useQuery({
    queryKey: ['hair-consultations', isMaster],
    queryFn: () =>
      apiRequest<{ items: Consultation[] }>(`/v1/hair-consultations?as=${isMaster ? 'master' : 'client'}`, {
        token: accessToken,
      }),
    enabled: Boolean(accessToken),
  })

  const masters = useQuery({
    queryKey: ['consult-master-search', masterQuery],
    queryFn: () =>
      apiRequest<{ items: { id: string; user_id?: string; display_name: string; city?: string }[] }>(
        `/v1/masters?q=${encodeURIComponent(masterQuery)}&limit=8`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken) && !isMaster && masterQuery.trim().length >= 2,
  })

  const create = useMutation({
    mutationFn: async () => {
      const mid = masterId.trim()
      if (!mid) throw new ApiError('Выберите мастера', 'validation_error', 400)
      const body: Record<string, string> = { master_user_id: mid }
      const orgId = cabinet.selectedOrg?.organization.id
      if (orgId) body.organization_id = orgId
      return apiRequest<Consultation>('/v1/hair-consultations', {
        method: 'POST',
        token: accessToken,
        body,
      })
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['hair-consultations'] })
      navigate(`/consultations/${c.id}`)
    },
    onError: (e) => setError(userError(e, 'Не удалось создать консультацию')),
  })

  return (
    <div className="page stack-gap" data-testid="hair-consultations-page">
      <header className="page-header">
        <h1>Консультации по волосам</h1>
        <p className="muted">Анкета, профессиональная оценка и согласование плана окрашивания</p>
      </header>
      {error && <ErrorBanner error={error} />}

      {!isMaster && (
        <section className="card stack-gap" data-testid="consult-create">
          <h2>Новая консультация</h2>
          <label className="field">
            <span>Мастер (user id или поиск)</span>
            <input
              value={masterId}
              onChange={(e) => setMasterId(e.target.value)}
              placeholder="UUID мастера"
              data-testid="consult-master-id"
            />
          </label>
          <label className="field">
            <span>Поиск мастера</span>
            <input
              value={masterQuery}
              onChange={(e) => setMasterQuery(e.target.value)}
              placeholder="Имя или город"
              data-testid="consult-master-search"
            />
          </label>
          {(masters.data?.items ?? []).length > 0 && (
            <ul className="list stack-gap-sm">
              {masters.data!.items.map((m) => {
                const uid = m.user_id || m.id
                return (
                  <li key={uid}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
                      onClick={() => setMasterId(uid)}
                    >
                      {m.display_name}
                      {m.city ? ` · ${m.city}` : ''}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={create.isPending || !masterId.trim()}
            onClick={() => create.mutate()}
            data-testid="consult-create-btn"
          >
            Создать консультацию
          </button>
        </section>
      )}

      <section className="stack-gap">
        <h2>Мои консультации</h2>
        {list.isLoading && <p className="muted">Загрузка…</p>}
        {(list.data?.items ?? []).length === 0 && !list.isLoading && (
          <p className="muted">Пока нет консультаций</p>
        )}
        <ul className="list stack-gap">
          {(list.data?.items ?? []).map((c) => (
            <li key={c.id} className="card">
              <Link to={`/consultations/${c.id}`} data-testid={`consult-item-${c.id}`}>
                <strong>{statusLabel(c.status)}</strong>
                <div className="muted">
                  v{c.current_version?.version_no ?? '—'} · {new Date(c.updated_at).toLocaleString('ru-RU')}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export function HairConsultationDetailPage() {
  const { id } = useParams()
  const { accessToken, user } = useAuth()
  const cabinet = useCabinet()
  const messenger = useMessenger()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [q, setQ] = useState<Questionnaire>(emptyQ())
  const [a, setA] = useState<Assessment>(emptyA())
  const [p, setP] = useState<Plan>(emptyP())
  const [returnComment, setReturnComment] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [viewVersionId, setViewVersionId] = useState<string | null>(null)
  const [servicesOpen, setServicesOpen] = useState(false)
  const [schemeOpen, setSchemeOpen] = useState(false)
  const [serviceQuery, setServiceQuery] = useState('')

  const detail = useQuery({
    queryKey: ['hair-consultation', id],
    queryFn: () => apiRequest<Consultation>(`/v1/hair-consultations/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
  })

  const c = detail.data
  const isClient = Boolean(c && user?.id === c.client_user_id)
  const isMaster = Boolean(c && user?.id === c.master_user_id)

  // Marketplace services always belong to an organization (solo masters still have a solo org).
  // Prefer the assigned master's attached services; otherwise resolve org and list published catalog.
  const masterBundle = useQuery({
    queryKey: ['consult-master-bundle', c?.master_user_id],
    queryFn: () =>
      apiRequest<{
        master: { organization_id?: string | null; user_id?: string }
        services?: CatalogService[]
      }>(`/v1/masters/${c!.master_user_id}`, { token: accessToken }),
    enabled: Boolean(accessToken && c?.master_user_id),
  })
  const orgId =
    detail.data?.organization_id ||
    cabinet.selectedOrg?.organization.id ||
    masterBundle.data?.master?.organization_id ||
    undefined
  const masterServices = masterBundle.data?.services ?? []
  const services = useQuery({
    queryKey: ['consult-services', orgId],
    queryFn: () =>
      apiRequest<{ items: CatalogService[] }>(
        `/v1/services?organization_id=${encodeURIComponent(orgId!)}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && orgId && masterServices.length === 0),
  })
  const current = c?.current_version
  const viewing = useMemo(() => {
    if (!c?.versions?.length) return current
    if (viewVersionId) return c.versions.find((v) => v.id === viewVersionId) || current
    return current
  }, [c, current, viewVersionId])

  useEffect(() => {
    if (!current) return
    setQ(asQuestionnaire(current.client_questionnaire))
    setA(asAssessment(current.master_assessment))
    setP(asPlan(current.plan))
    setViewVersionId(current.id)
  }, [current?.id, current?.updated_at])

  const slotMedia = (slot: string) => (viewing?.media ?? []).find((m) => m.slot === slot)?.media_id ?? null

  const saveQ = useMutation({
    mutationFn: () =>
      apiRequest<Consultation>(`/v1/hair-consultations/${id}/questionnaire`, {
        method: 'PATCH',
        token: accessToken,
        body: { questionnaire: q },
      }),
    onSuccess: (res) => {
      qc.setQueryData(['hair-consultation', id], res)
      setOk('Черновик анкеты сохранён')
      toast.success('Сохранено')
    },
    onError: (e) => setError(userError(e, 'Не удалось сохранить анкету')),
  })

  const submitQ = useMutation({
    mutationFn: async () => {
      await saveQ.mutateAsync()
      return apiRequest<Consultation>(`/v1/hair-consultations/${id}/submit`, {
        method: 'POST',
        token: accessToken,
        body: {},
      })
    },
    onSuccess: (res) => {
      qc.setQueryData(['hair-consultation', id], res)
      setOk('Анкета отправлена мастеру')
      toast.success('Отправлено')
    },
    onError: (e) => setError(userError(e, 'Не удалось отправить анкету')),
  })

  const attach = useMutation({
    mutationFn: ({ mediaId, slot }: { mediaId: string; slot: string }) =>
      apiRequest<Consultation>(`/v1/hair-consultations/${id}/media`, {
        method: 'POST',
        token: accessToken,
        body: { media_id: mediaId, slot },
      }),
    onSuccess: (res) => qc.setQueryData(['hair-consultation', id], res),
    onError: (e) => setError(userError(e, 'Не удалось прикрепить фото')),
  })

  const detach = useMutation({
    mutationFn: (mediaId: string) =>
      apiRequest<Consultation>(`/v1/hair-consultations/${id}/media/${mediaId}`, {
        method: 'DELETE',
        token: accessToken,
      }),
    onSuccess: (res) => qc.setQueryData(['hair-consultation', id], res),
    onError: (e) => setError(userError(e, 'Не удалось удалить фото')),
  })

  const start = useMutation({
    mutationFn: () =>
      apiRequest<Consultation>(`/v1/hair-consultations/${id}/start`, { method: 'POST', token: accessToken, body: {} }),
    onSuccess: (res) => {
      qc.setQueryData(['hair-consultation', id], res)
      toast.success('Работа начата')
    },
    onError: (e) => setError(userError(e, 'Не удалось начать работу')),
  })

  const saveAssessment = useMutation({
    mutationFn: () =>
      apiRequest<Consultation>(`/v1/hair-consultations/${id}/assessment`, {
        method: 'PATCH',
        token: accessToken,
        body: { assessment: a },
      }),
    onSuccess: (res) => {
      qc.setQueryData(['hair-consultation', id], res)
      toast.success('Оценка сохранена')
    },
    onError: (e) => setError(userError(e, 'Не удалось сохранить оценку')),
  })

  const savePlan = useMutation({
    mutationFn: () =>
      apiRequest<Consultation>(`/v1/hair-consultations/${id}/plan`, {
        method: 'PATCH',
        token: accessToken,
        body: { plan: p },
      }),
    onSuccess: (res) => {
      qc.setQueryData(['hair-consultation', id], res)
      if (res.current_version?.plan) setP(asPlan(res.current_version.plan))
      toast.success('План сохранён')
    },
    onError: (e) => setError(userError(e, 'Не удалось сохранить план')),
  })

  const sendPlan = useMutation({
    mutationFn: async () => {
      await saveAssessment.mutateAsync()
      await savePlan.mutateAsync()
      let conversationId = c?.conversation_id || null
      if (!conversationId && c) {
        const conv = await openConversation(accessToken, { type: 'client_master', client_user_id: c.client_user_id })
        conversationId = conv.id
      }
      return apiRequest<Consultation>(`/v1/hair-consultations/${id}/send`, {
        method: 'POST',
        token: accessToken,
        body: { conversation_id: conversationId },
      })
    },
    onSuccess: (res) => {
      qc.setQueryData(['hair-consultation', id], res)
      setOk('План отправлен клиенту')
      toast.success('План отправлен')
    },
    onError: (e) => setError(userError(e, 'Не удалось отправить план')),
  })

  const approve = useMutation({
    mutationFn: () =>
      apiRequest<Consultation>(`/v1/hair-consultations/${id}/approve`, { method: 'POST', token: accessToken, body: {} }),
    onSuccess: (res) => {
      qc.setQueryData(['hair-consultation', id], res)
      setOk('План утверждён')
      toast.success('Утверждено')
    },
    onError: (e) => setError(userError(e, 'Не удалось утвердить')),
  })

  const requestChanges = useMutation({
    mutationFn: () =>
      apiRequest<Consultation>(`/v1/hair-consultations/${id}/request-changes`, {
        method: 'POST',
        token: accessToken,
        body: { comment: returnComment },
      }),
    onSuccess: (res) => {
      qc.setQueryData(['hair-consultation', id], res)
      setReturnComment('')
      setOk('Запрос на правки отправлен')
      toast.success('Правки запрошены')
    },
    onError: (e) => setError(userError(e, 'Не удалось вернуть план')),
  })

  const revision = useMutation({
    mutationFn: () =>
      apiRequest<Consultation>(`/v1/hair-consultations/${id}/revisions`, { method: 'POST', token: accessToken, body: {} }),
    onSuccess: (res) => {
      qc.setQueryData(['hair-consultation', id], res)
      toast.success('Новая версия создана')
    },
    onError: (e) => setError(userError(e, 'Не удалось создать версию')),
  })

  const clientEditable = isClient && c?.status === 'draft' && current?.status === 'draft'
  const masterEditable =
    isMaster && c?.status === 'in_progress' && (current?.status === 'draft' || current?.status === 'in_review')
  const showPlanToClient =
    isClient &&
    viewing &&
    (viewing.status === 'sent' || viewing.status === 'approved' || viewing.status === 'changes_requested' || viewing.status === 'superseded')
  const canApprove = isClient && c?.status === 'awaiting_client' && current?.status === 'sent'

  const catalog = masterServices.length > 0 ? masterServices : (services.data?.items ?? [])
  const filteredServices = catalog.filter((s) => {
    if (!serviceQuery.trim()) return true
    const qv = serviceQuery.trim().toLowerCase()
    return s.name.toLowerCase().includes(qv) || (s.category ?? '').toLowerCase().includes(qv)
  })
  const mainServices = filteredServices.filter((s) => hairCategory(s.name, s.category) === 'main')
  const popularServices = filteredServices.filter((s) => hairCategory(s.name, s.category) === 'popular')
  const selectedServices = catalog.filter((s) => p.selected_service_ids.includes(s.id))
  // Prefer live catalog sum when services are loaded; fall back to server-normalized total.
  const computedPrice = selectedServices.reduce((sum, s) => sum + (s.price_minor || 0), 0)
  const displayPrice =
    selectedServices.length > 0
      ? computedPrice
      : p.price_total_minor > 0
        ? p.price_total_minor
        : 0
  const strandPhoto = slotMedia('strand_a4') || slotMedia('overview')
  const roleBadge = isMaster ? 'Мастер' : 'Клиент'

  function toggleService(svc: CatalogService) {
    const has = p.selected_service_ids.includes(svc.id)
    const ids = has ? p.selected_service_ids.filter((x) => x !== svc.id) : [...p.selected_service_ids, svc.id]
    const next = catalog.filter((s) => ids.includes(s.id))
    setP({
      ...p,
      selected_service_ids: ids,
      price_total_minor: next.reduce((sum, s) => sum + (s.price_minor || 0), 0),
    })
  }

  if (detail.isLoading) return <div className="page"><p className="muted">Загрузка…</p></div>
  if (!c) return <div className="page"><ErrorBanner error={error || 'Консультация не найдена'} /></div>

  return (
    <div className="page stack-gap consult-detail" data-testid="hair-consultation-detail">
      <Link className="btn btn-ghost btn-compact" to="/consultations">← К консультациям</Link>
      <header className="page-header row between">
        <div>
          <h1>Диагностика волос</h1>
          <p className="muted">
            {statusLabel(c.status)} · версия {current?.version_no ?? '—'}
            {c.client_card_id ? (
              <>
                {' · '}
                <Link to={`/clients/${c.client_card_id}`}>Карточка клиента</Link>
              </>
            ) : null}
          </p>
        </div>
        <span className="badge" data-testid="consult-role-badge">{roleBadge}</span>
      </header>
      {error && <ErrorBanner error={error} />}
      {ok && <p className="ok-banner" role="status">{ok}</p>}

      <div className="row-wrap gap-sm">
        {c.conversation_id && (
          <button type="button" className="btn btn-secondary btn-compact" data-testid="consult-open-chat" onClick={() => messenger.open(c.conversation_id!)}>
            Открыть чат
          </button>
        )}
        {isMaster && c.status === 'awaiting_master' && (
          <button type="button" className="btn btn-primary" data-testid="consult-start" onClick={() => start.mutate()} disabled={start.isPending}>
            Начать работу
          </button>
        )}
        {isMaster && c.status === 'approved' && (
          <button type="button" className="btn btn-secondary" data-testid="consult-revision" onClick={() => revision.mutate()} disabled={revision.isPending}>
            Новая версия
          </button>
        )}
        {(isMaster || isClient) && (
          <button type="button" className="btn btn-secondary btn-compact" data-testid="consult-open-services" onClick={() => setServicesOpen(true)}>
            Услуги для волос
          </button>
        )}
      </div>

      {(c.versions?.length ?? 0) > 1 && (
        <section className="card stack-gap">
          <h2>Версии</h2>
          <div className="row-wrap gap-sm">
            {c.versions!.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`chip${viewVersionId === v.id ? ' active' : ''}`}
                onClick={() => setViewVersionId(v.id)}
                data-testid={`consult-version-${v.version_no}`}
              >
                v{v.version_no} · {statusLabel(v.status)}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card stack-gap" data-testid="consult-strand-photo">
        <h2>Фото пряди</h2>
        <p className="muted">Прядь на листе A4 при естественном и искусственном освещении.</p>
        {strandPhoto ? (
          <>
            <div className="media-frame media-frame--landscape">
              <MediaImage mediaId={strandPhoto} alt="Прядь на A4" />
            </div>
            <p className="consult-photo-status" data-testid="consult-photo-uploaded">✓ Фото загружено</p>
          </>
        ) : (
          <p className="muted">Фото ещё не загружено</p>
        )}
        {clientEditable && (
          <MediaDropzone
            purpose="hair_consultation"
            value={slotMedia('strand_a4')}
            allowGif={false}
            accept="image/jpeg,image/png,image/webp"
            label="Загрузить прядь на A4"
            onChange={(mediaId) => {
              const mid = slotMedia('strand_a4')
              if (!mediaId) {
                if (mid) detach.mutate(mid)
                return
              }
              attach.mutate({ mediaId, slot: 'strand_a4' })
            }}
          />
        )}
      </section>

      <section className="card stack-gap" data-testid="consult-questionnaire">
        <h2>Параметры волос</h2>
        <fieldset className="consult-param-list" disabled={!clientEditable && !masterEditable}>
          <label className="consult-param-row">
            <span>Уровень глубины тона корней</span>
            <select
              value={q.root_tone_level || a.natural_level_roots}
              onChange={(e) => {
                const v = e.target.value
                if (clientEditable) setQ({ ...q, root_tone_level: v })
                else setA({ ...a, natural_level_roots: v })
              }}
              data-testid="q-root-tone"
            >
              <option value="">—</option>
              {ROOT_LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="consult-param-row">
            <span>Процент седины</span>
            <select
              value={q.gray_percent || a.gray_percent}
              onChange={(e) => {
                const v = e.target.value
                if (clientEditable) setQ({ ...q, gray_percent: v })
                else setA({ ...a, gray_percent: v })
              }}
              data-testid="q-gray"
            >
              <option value="">—</option>
              {GRAY_OPTIONS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="consult-param-row">
            <span>Натуральные или окрашенные</span>
            <select value={q.hair_type} onChange={(e) => setQ({ ...q, hair_type: e.target.value })} data-testid="q-hair-type" disabled={!clientEditable}>
              <option value="">—</option>
              <option value="natural">Натуральные</option>
              <option value="colored">Окрашенные</option>
            </select>
          </label>
          <label className="consult-param-row">
            <span>Мелирование</span>
            <select value={q.highlighting} onChange={(e) => setQ({ ...q, highlighting: e.target.value })} data-testid="q-highlighting" disabled={!clientEditable}>
              <option value="">—</option>
              <option value="yes">Да</option>
              <option value="no">Нет</option>
            </select>
          </label>
          <label className="consult-param-row">
            <span>Уровень светлых прядей</span>
            <select value={q.light_strands_level} onChange={(e) => setQ({ ...q, light_strands_level: e.target.value })} data-testid="q-light-level" disabled={!clientEditable}>
              <option value="">—</option>
              {LIGHT_LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
        </fieldset>

        {(clientEditable || q.desired_result || q.comments) && (
          <div className="stack-sm">
            <h3>Со слов клиентки</h3>
            {clientEditable ? (
              <textarea
                value={q.desired_result || q.comments}
                onChange={(e) => setQ({ ...q, desired_result: e.target.value, comments: e.target.value })}
                rows={3}
                data-testid="q-desired"
                placeholder="Пожелания к результату"
              />
            ) : (
              <p data-testid="consult-client-words">{q.desired_result || q.comments || '—'}</p>
            )}
          </div>
        )}

        {clientEditable && (
          <details className="stack-sm">
            <summary>Дополнительная анкета</summary>
            <label className="check"><input type="checkbox" checked={q.salon_coloring} onChange={(e) => setQ({ ...q, salon_coloring: e.target.checked })} /> Салонное окрашивание</label>
            <label className="check"><input type="checkbox" checked={q.home_coloring} onChange={(e) => setQ({ ...q, home_coloring: e.target.checked })} /> Домашнее окрашивание</label>
            <label className="check"><input type="checkbox" checked={q.bleaching} onChange={(e) => setQ({ ...q, bleaching: e.target.checked })} /> Осветление</label>
            <label className="field"><span>Аллергии</span><textarea value={q.allergies} onChange={(e) => setQ({ ...q, allergies: e.target.value })} rows={2} /></label>
            <label className="field"><span>Бюджет</span><input value={q.budget} onChange={(e) => setQ({ ...q, budget: e.target.value })} /></label>
            <div className="consult-photo-grid">
              {PHOTO_SLOTS.filter((s) => s.slot !== 'strand_a4').map((s) => {
                const mid = slotMedia(s.slot)
                return (
                  <div key={s.slot} className="stack-gap-sm" data-testid={`photo-slot-${s.slot}`}>
                    <strong>{s.label}</strong>
                    <span className="muted">{s.hint}</span>
                    <MediaDropzone
                      purpose="hair_consultation"
                      value={mid}
                      allowGif={false}
                      accept="image/jpeg,image/png,image/webp"
                      label={`Загрузить: ${s.label}`}
                      onChange={(mediaId) => {
                        if (!mediaId) {
                          if (mid) detach.mutate(mid)
                          return
                        }
                        attach.mutate({ mediaId, slot: s.slot })
                      }}
                    />
                  </div>
                )
              })}
            </div>
          </details>
        )}

        {clientEditable && (
          <div className="row-wrap gap-sm">
            <button type="button" className="btn btn-secondary" data-testid="consult-save-draft" onClick={() => saveQ.mutate()} disabled={saveQ.isPending}>
              Сохранить черновик
            </button>
            <button type="button" className="btn btn-primary" data-testid="consult-submit" onClick={() => submitQ.mutate()} disabled={submitQ.isPending}>
              Подтвердить диагностику
            </button>
          </div>
        )}
      </section>

      {isMaster && (
        <section className="card stack-gap consult-master-block" data-testid="consult-master-extras">
          <h2>Данные мастера</h2>
          <button type="button" className="consult-master-link" data-testid="consult-scheme-open" onClick={() => setSchemeOpen(true)}>
            <div>
              <strong>Схема окрашивания</strong>
              <p className="muted">
                {[p.technique && `Техника: ${p.technique}`, p.tone_correction && `Коррекция: ${p.tone_correction}`, p.desired_result && `Результат: ${p.desired_result}`]
                  .filter(Boolean)
                  .join(' · ') || 'Заполнить схему'}
              </p>
            </div>
            <span aria-hidden>›</span>
          </button>
          <div className="consult-param-row">
            <span>Косметика</span>
            <input
              value={p.brand_line}
              onChange={(e) => setP({ ...p, brand_line: e.target.value })}
              disabled={!masterEditable}
              placeholder="Бренд / линейка"
              data-testid="p-brand"
            />
          </div>
          <div className="consult-param-row">
            <span>Оксид</span>
            <input
              value={p.oxidant}
              onChange={(e) => setP({ ...p, oxidant: e.target.value })}
              disabled={!masterEditable}
              placeholder="например, 3%"
              data-testid="p-oxidant"
            />
          </div>
          {masterEditable && (
            <div className="row-wrap gap-sm">
              <button type="button" className="btn btn-secondary" onClick={() => { void saveAssessment.mutateAsync(); void savePlan.mutateAsync() }} disabled={savePlan.isPending}>
                Сохранить
              </button>
              <button type="button" className="btn btn-primary" data-testid="consult-send-plan" onClick={() => sendPlan.mutate()} disabled={sendPlan.isPending}>
                Подтвердить диагностику
              </button>
            </div>
          )}
        </section>
      )}

      {(isMaster || showPlanToClient || (viewing && Object.keys(viewing.master_assessment || {}).length > 0)) && (
        <details className="card stack-gap" data-testid="consult-assessment">
          <summary>Профессиональная оценка (подробно)</summary>
          <fieldset className="stack-gap" disabled={!masterEditable}>
            <label className="field"><span>Искусственные красители</span>
              <input value={a.artificial_color} onChange={(e) => setA({ ...a, artificial_color: e.target.value })} /></label>
            <label className="field"><span>Светлые участки</span>
              <input value={a.lightened_areas} onChange={(e) => setA({ ...a, lightened_areas: e.target.value })} /></label>
            <label className="field"><span>Заметки</span><textarea value={a.notes} onChange={(e) => setA({ ...a, notes: e.target.value })} rows={2} /></label>
          </fieldset>
        </details>
      )}

      <section className="card consult-price-card" data-testid="consult-price">
        <p className="muted">Окончательная сумма</p>
        <p className="consult-price-value">{displayPrice > 0 ? formatMoney(displayPrice) : '—'}</p>
        {selectedServices.length > 0 && (
          <p className="muted">{selectedServices.map((s) => s.name).join(', ')}</p>
        )}
      </section>

      {canApprove && (
        <section className="card stack-gap" data-testid="consult-approve-block">
          <h2>Согласование</h2>
          <button type="button" className="btn btn-primary" data-testid="consult-approve" onClick={() => approve.mutate()} disabled={approve.isPending}>
            Утвердить план
          </button>
          <label className="field"><span>Комментарий при возврате</span>
            <textarea value={returnComment} onChange={(e) => setReturnComment(e.target.value)} rows={3} data-testid="consult-return-comment" /></label>
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="consult-request-changes"
            onClick={() => requestChanges.mutate()}
            disabled={requestChanges.isPending || !returnComment.trim()}
          >
            Вернуть с комментарием
          </button>
        </section>
      )}

      {viewing?.client_comment && (
        <section className="card">
          <h2>Комментарий клиента</h2>
          <p>{viewing.client_comment}</p>
        </section>
      )}

      <section className="card stack-gap">
        <button type="button" className="btn btn-ghost btn-compact" onClick={() => setHistoryOpen((v) => !v)} data-testid="consult-history-toggle">
          {historyOpen ? 'Скрыть историю' : 'История действий'}
        </button>
        {historyOpen && (
          <ul className="list stack-gap-sm" data-testid="consult-history">
            {(c.events ?? []).map((e) => (
              <li key={e.id}>
                <strong>{actionLabel(e.action)}</strong>
                <div className="muted">
                  {new Date(e.created_at).toLocaleString('ru-RU')}
                  {e.from_status
                    ? ` · с ${statusLabel(e.from_status)} на ${statusLabel(e.to_status)}`
                    : ` · ${statusLabel(e.to_status)}`}
                </div>
                {typeof e.meta?.comment === 'string' && <p>{e.meta.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={schemeOpen} onClose={() => setSchemeOpen(false)} title="Схема окрашивания" size="lg">
        <fieldset className="stack-gap" disabled={!masterEditable}>
          <label className="field"><span>Техника</span>
            <input value={p.technique} onChange={(e) => setP({ ...p, technique: e.target.value })} data-testid="p-technique" /></label>
          <label className="field"><span>Коррекция оттенка</span>
            <input value={p.tone_correction} onChange={(e) => setP({ ...p, tone_correction: e.target.value })} data-testid="p-tone-correction" /></label>
          <label className="field"><span>Желаемый результат</span>
            <textarea value={p.desired_result} onChange={(e) => setP({ ...p, desired_result: e.target.value })} rows={2} data-testid="p-desired" /></label>
          <label className="field"><span>Формула</span>
            <textarea value={p.formula} onChange={(e) => setP({ ...p, formula: e.target.value })} rows={3} data-testid="p-formula" /></label>
          <label className="field"><span>Оттенки и пропорции</span>
            <textarea value={p.shades_ratios} onChange={(e) => setP({ ...p, shades_ratios: e.target.value })} rows={2} /></label>
          <label className="field"><span>Тест пряди</span>
            <textarea value={p.strand_test} onChange={(e) => setP({ ...p, strand_test: e.target.value })} rows={2} data-testid="p-strand-test" /></label>
          <label className="field"><span>Аллергопроба</span>
            <textarea value={p.allergy_test} onChange={(e) => setP({ ...p, allergy_test: e.target.value })} rows={2} data-testid="p-allergy-test" /></label>
        </fieldset>
        {masterEditable && (
          <button type="button" className="btn btn-primary" onClick={() => { savePlan.mutate(); setSchemeOpen(false) }}>
            Готово
          </button>
        )}
      </Modal>

      <Modal open={servicesOpen} onClose={() => setServicesOpen(false)} title="Услуги для волос" size="lg">
        <p className="muted">Выберите услуги из каталога. Итоговая сумма попадёт в диагностику.</p>
        <label className="field">
          <span className="visually-hidden">Поиск</span>
          <input
            value={serviceQuery}
            onChange={(e) => setServiceQuery(e.target.value)}
            placeholder="Поиск услуги…"
            data-testid="consult-service-search"
          />
        </label>
        {!orgId && (
          <p className="muted" data-testid="consult-services-no-org">
            Каталог услуг недоступен: у мастера не найдена организация. В Salon-X услуги всегда привязаны к организации
            (в том числе у частного мастера — к его solo-организации).
          </p>
        )}
        {orgId && services.isLoading && <p className="muted">Загрузка услуг…</p>}
        <div className="stack-gap" data-testid="consult-service-picker">
          {mainServices.length > 0 && (
            <div className="stack-sm">
              <h3>Основные</h3>
              <div className="consult-service-list">
                {mainServices.map((s) => {
                  const checked = p.selected_service_ids.includes(s.id)
                  return (
                    <label key={s.id} className={`consult-service-item${checked ? ' is-checked' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleService(s)} disabled={!masterEditable && !clientEditable} />
                      <span>{s.name}</span>
                      <strong>{formatMoney(s.price_minor)}</strong>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
          {popularServices.length > 0 && (
            <div className="stack-sm">
              <h3>Популярные манипуляции</h3>
              <div className="consult-service-list">
                {popularServices.map((s) => {
                  const checked = p.selected_service_ids.includes(s.id)
                  return (
                    <label key={s.id} className={`consult-service-item${checked ? ' is-checked' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleService(s)} disabled={!masterEditable && !clientEditable} />
                      <span>{s.name}</span>
                      <strong>{formatMoney(s.price_minor)}</strong>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        <div className="consult-price-card">
          <p className="muted">Окончательная сумма</p>
          <p className="consult-price-value">{formatMoney(computedPrice)}</p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-block"
          data-testid="consult-services-apply"
          onClick={() => {
            const next = { ...p, price_total_minor: computedPrice }
            setP(next)
            setServicesOpen(false)
            if (masterEditable) {
              void apiRequest<Consultation>(`/v1/hair-consultations/${id}/plan`, {
                method: 'PATCH',
                token: accessToken,
                body: { plan: next },
              }).then((res) => {
                qc.setQueryData(['hair-consultation', id], res)
                if (res.current_version?.plan) setP(asPlan(res.current_version.plan))
                toast.success('Услуги применены')
              }).catch((e) => setError(userError(e, 'Не удалось сохранить услуги')))
            }
          }}
        >
          Применить
        </button>
      </Modal>
    </div>
  )
}
