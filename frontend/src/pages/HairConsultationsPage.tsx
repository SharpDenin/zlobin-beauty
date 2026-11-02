import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { userError } from '@/shared/lib/app-error'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { MediaDropzone } from '@/shared/ui/MediaDropzone'
import { MediaImage } from '@/shared/ui/MediaImage'
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
  status: string
  current_version_id?: string
  conversation_id?: string | null
  created_at: string
  updated_at: string
  current_version?: Version
  versions?: Version[]
  events?: EventRow[]
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
})

const PHOTO_SLOTS: { slot: string; label: string; hint: string }[] = [
  { slot: 'overview', label: 'Общий вид', hint: 'При естественном свете, без фильтров' },
  { slot: 'roots', label: 'Корни', hint: 'Крупно корни у пробора' },
  { slot: 'length', label: 'Длина', hint: 'Средняя часть полотна' },
  { slot: 'ends', label: 'Концы', hint: 'Состояние кончиков' },
  { slot: 'strand_a4', label: 'Прядь на A4', hint: 'Прядь на белом листе A4' },
  { slot: 'reference', label: 'Референс', hint: 'Желаемый образ (необязательно)' },
]

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
  const out = { ...p }
  for (const k of Object.keys(p) as (keyof Plan)[]) {
    if (raw[k] != null) out[k] = String(raw[k])
  }
  return out
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
      return apiRequest<Consultation>('/v1/hair-consultations', {
        method: 'POST',
        token: accessToken,
        body: { master_user_id: mid },
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

  const detail = useQuery({
    queryKey: ['hair-consultation', id],
    queryFn: () => apiRequest<Consultation>(`/v1/hair-consultations/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
  })

  const c = detail.data
  const isClient = Boolean(c && user?.id === c.client_user_id)
  const isMaster = Boolean(c && user?.id === c.master_user_id)
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

  if (detail.isLoading) return <div className="page"><p className="muted">Загрузка…</p></div>
  if (!c) return <div className="page"><ErrorBanner error={error || 'Консультация не найдена'} /></div>

  return (
    <div className="page stack-gap consult-detail" data-testid="hair-consultation-detail">
      <Link className="btn btn-ghost btn-compact" to="/consultations">← К консультациям</Link>
      <header className="page-header">
        <h1>Консультация</h1>
        <p className="muted">
          {statusLabel(c.status)} · версия {current?.version_no ?? '—'} ({statusLabel(current?.status || '')})
        </p>
      </header>
      {error && <ErrorBanner error={error} />}
      {ok && <p className="ok-banner" role="status">{ok}</p>}

      <div className="row-wrap gap-sm">
        {c.conversation_id && (
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            data-testid="consult-open-chat"
            onClick={() => messenger.open(c.conversation_id!)}
          >
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

      <section className="card stack-gap" data-testid="consult-questionnaire">
        <h2>Анкета клиента</h2>
        <fieldset className="stack-gap" disabled={!clientEditable}>
          <legend className="sr-only">История волос</legend>
          <h3>История волос и процедур</h3>
          <label className="field">
            <span>Тип волос</span>
            <select value={q.hair_type} onChange={(e) => setQ({ ...q, hair_type: e.target.value })} data-testid="q-hair-type">
              <option value="">Выберите</option>
              <option value="natural">Натуральные</option>
              <option value="colored">Окрашенные</option>
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={q.salon_coloring} onChange={(e) => setQ({ ...q, salon_coloring: e.target.checked })} /> Салонное окрашивание</label>
          <label className="check"><input type="checkbox" checked={q.home_coloring} onChange={(e) => setQ({ ...q, home_coloring: e.target.checked })} /> Домашнее/коробочное окрашивание</label>
          <label className="check"><input type="checkbox" checked={q.bleaching} onChange={(e) => setQ({ ...q, bleaching: e.target.checked })} /> Осветление</label>
          <label className="field"><span>Хна и другие составы</span>
            <input value={q.henna_or_other} onChange={(e) => setQ({ ...q, henna_or_other: e.target.value })} /></label>
          <label className="field"><span>Дата последней процедуры</span>
            <input type="date" value={q.last_procedure_date} onChange={(e) => setQ({ ...q, last_procedure_date: e.target.value })} /></label>

          <h3>Пожелания</h3>
          <label className="field"><span>Желаемый результат</span>
            <textarea value={q.desired_result} onChange={(e) => setQ({ ...q, desired_result: e.target.value })} rows={3} data-testid="q-desired" /></label>
          <label className="field"><span>Референсы (описание)</span>
            <textarea value={q.references_note} onChange={(e) => setQ({ ...q, references_note: e.target.value })} rows={2} /></label>
          <label className="field"><span>Комментарии</span>
            <textarea value={q.comments} onChange={(e) => setQ({ ...q, comments: e.target.value })} rows={2} /></label>

          <h3>Особенности</h3>
          <label className="field"><span>Аллергии и чувствительность</span>
            <textarea value={q.allergies} onChange={(e) => setQ({ ...q, allergies: e.target.value })} rows={2} /></label>
          <label className="field"><span>Известные реакции на красители</span>
            <textarea value={q.dye_reactions} onChange={(e) => setQ({ ...q, dye_reactions: e.target.value })} rows={2} /></label>
          <label className="field"><span>Бюджет</span>
            <input value={q.budget} onChange={(e) => setQ({ ...q, budget: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={q.ready_to_maintain} onChange={(e) => setQ({ ...q, ready_to_maintain: e.target.checked })} /> Готов(а) поддерживать результат и уход</label>
        </fieldset>

        <h3>Фотографии</h3>
        <p className="muted">Снимайте при естественном освещении, без фильтров и обработки.</p>
        <div className="consult-photo-grid">
          {PHOTO_SLOTS.map((s) => {
            const mid = slotMedia(s.slot)
            return (
              <div key={s.slot} className="stack-gap-sm" data-testid={`photo-slot-${s.slot}`}>
                <strong>{s.label}</strong>
                <span className="muted">{s.hint}</span>
                {clientEditable ? (
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
                ) : mid ? (
                  <div className="media-frame media-frame--square">
                    <MediaImage mediaId={mid} alt={s.label} />
                  </div>
                ) : (
                  <p className="muted">Нет фото</p>
                )}
              </div>
            )
          })}
        </div>

        {clientEditable && (
          <div className="row-wrap gap-sm">
            <button type="button" className="btn btn-secondary" data-testid="consult-save-draft" onClick={() => saveQ.mutate()} disabled={saveQ.isPending}>
              Сохранить черновик
            </button>
            <button type="button" className="btn btn-primary" data-testid="consult-submit" onClick={() => submitQ.mutate()} disabled={submitQ.isPending}>
              Отправить анкету
            </button>
          </div>
        )}
      </section>

      {(isMaster || showPlanToClient || (viewing && Object.keys(viewing.master_assessment || {}).length > 0)) && (
        <section className="card stack-gap" data-testid="consult-assessment">
          <h2>Профессиональная оценка</h2>
          <fieldset className="stack-gap" disabled={!masterEditable}>
            <label className="field"><span>Натуральный уровень корней</span>
              <input value={a.natural_level_roots} onChange={(e) => setA({ ...a, natural_level_roots: e.target.value })} data-testid="a-natural-level" /></label>
            <label className="field"><span>% седины</span>
              <input value={a.gray_percent} onChange={(e) => setA({ ...a, gray_percent: e.target.value })} /></label>
            <label className="field"><span>Искусственные красители</span>
              <input value={a.artificial_color} onChange={(e) => setA({ ...a, artificial_color: e.target.value })} /></label>
            <label className="field"><span>Светлые участки</span>
              <input value={a.lightened_areas} onChange={(e) => setA({ ...a, lightened_areas: e.target.value })} /></label>
            <div className="consult-zone-grid">
              <label className="field"><span>Пористость · корни</span><input value={a.porosity_roots} onChange={(e) => setA({ ...a, porosity_roots: e.target.value })} /></label>
              <label className="field"><span>Пористость · длина</span><input value={a.porosity_length} onChange={(e) => setA({ ...a, porosity_length: e.target.value })} /></label>
              <label className="field"><span>Пористость · концы</span><input value={a.porosity_ends} onChange={(e) => setA({ ...a, porosity_ends: e.target.value })} /></label>
              <label className="field"><span>Эластичность · корни</span><input value={a.elasticity_roots} onChange={(e) => setA({ ...a, elasticity_roots: e.target.value })} /></label>
              <label className="field"><span>Эластичность · длина</span><input value={a.elasticity_length} onChange={(e) => setA({ ...a, elasticity_length: e.target.value })} /></label>
              <label className="field"><span>Эластичность · концы</span><input value={a.elasticity_ends} onChange={(e) => setA({ ...a, elasticity_ends: e.target.value })} /></label>
            </div>
            <label className="field"><span>Текстура</span><input value={a.texture} onChange={(e) => setA({ ...a, texture: e.target.value })} /></label>
            <label className="field"><span>Диаметр</span><input value={a.diameter} onChange={(e) => setA({ ...a, diameter: e.target.value })} /></label>
            <label className="field"><span>Густота</span><input value={a.density} onChange={(e) => setA({ ...a, density: e.target.value })} /></label>
            <label className="field"><span>Кожа головы</span><input value={a.scalp_condition} onChange={(e) => setA({ ...a, scalp_condition: e.target.value })} /></label>
            <label className="field"><span>Заметки</span><textarea value={a.notes} onChange={(e) => setA({ ...a, notes: e.target.value })} rows={2} /></label>
          </fieldset>
          {masterEditable && (
            <button type="button" className="btn btn-secondary" onClick={() => saveAssessment.mutate()} disabled={saveAssessment.isPending}>
              Сохранить оценку
            </button>
          )}
        </section>
      )}

      {(isMaster || showPlanToClient) && (
        <section className="card stack-gap" data-testid="consult-plan">
          <h2>План окрашивания</h2>
          <fieldset className="stack-gap" disabled={!masterEditable}>
            <label className="field"><span>Желаемый результат</span>
              <textarea value={p.desired_result} onChange={(e) => setP({ ...p, desired_result: e.target.value })} rows={2} data-testid="p-desired" /></label>
            <label className="field"><span>Техника</span>
              <input value={p.technique} onChange={(e) => setP({ ...p, technique: e.target.value })} data-testid="p-technique" /></label>
            <label className="field"><span>Карта зон</span>
              <textarea value={p.zone_map} onChange={(e) => setP({ ...p, zone_map: e.target.value })} rows={2} /></label>
            <div className="consult-zone-grid">
              <label className="field"><span>Уровень корней</span><input value={p.level_roots} onChange={(e) => setP({ ...p, level_roots: e.target.value })} /></label>
              <label className="field"><span>Уровень длины</span><input value={p.level_length} onChange={(e) => setP({ ...p, level_length: e.target.value })} /></label>
              <label className="field"><span>Уровень концов</span><input value={p.level_ends} onChange={(e) => setP({ ...p, level_ends: e.target.value })} /></label>
            </div>
            <label className="field"><span>Формула</span>
              <textarea value={p.formula} onChange={(e) => setP({ ...p, formula: e.target.value })} rows={4} data-testid="p-formula" /></label>
            <label className="field"><span>Бренд и линейка</span>
              <input value={p.brand_line} onChange={(e) => setP({ ...p, brand_line: e.target.value })} /></label>
            <label className="field"><span>Оттенки и пропорции</span>
              <textarea value={p.shades_ratios} onChange={(e) => setP({ ...p, shades_ratios: e.target.value })} rows={2} /></label>
            <label className="field"><span>Оксидант</span>
              <input value={p.oxidant} onChange={(e) => setP({ ...p, oxidant: e.target.value })} /></label>
            <label className="field"><span>Время выдержки</span>
              <input value={p.processing_time} onChange={(e) => setP({ ...p, processing_time: e.target.value })} /></label>
            <label className="field"><span>Осветление / смывка / заполнение</span>
              <textarea value={p.lightening_or_fill} onChange={(e) => setP({ ...p, lightening_or_fill: e.target.value })} rows={2} /></label>
            <label className="field"><span>Тест пряди</span>
              <textarea value={p.strand_test} onChange={(e) => setP({ ...p, strand_test: e.target.value })} rows={2} data-testid="p-strand-test" /></label>
            <label className="field"><span>Аллергопроба</span>
              <textarea value={p.allergy_test} onChange={(e) => setP({ ...p, allergy_test: e.target.value })} rows={2} data-testid="p-allergy-test" /></label>
            <p className="muted">Тест пряди и аллергопроба — разные процедуры. Интервалы — по инструкции производителя.</p>
            <label className="field"><span>Рекомендации по уходу</span>
              <textarea value={p.care_recommendations} onChange={(e) => setP({ ...p, care_recommendations: e.target.value })} rows={3} /></label>
          </fieldset>
          {masterEditable && (
            <div className="row-wrap gap-sm">
              <button type="button" className="btn btn-secondary" onClick={() => savePlan.mutate()} disabled={savePlan.isPending}>
                Сохранить план
              </button>
              <button type="button" className="btn btn-primary" data-testid="consult-send-plan" onClick={() => sendPlan.mutate()} disabled={sendPlan.isPending}>
                Отправить клиенту
              </button>
            </div>
          )}
        </section>
      )}

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
    </div>
  )
}
