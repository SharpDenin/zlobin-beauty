import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { apiRequest } from '@/shared/api/client'
import { hasMasterAccess, useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { useMemo, useState } from 'react'
import { VisitSchemeSummary } from '@/features/scheme/VisitSchemeSummary'
import { RepeatOffer } from '@/pages/RepeatOffer'
import { Hint } from '@/shared/ui/Hint'
import { toast } from '@/shared/ui/Toast'
import { Modal } from '@/shared/ui/Modal'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { EmptyState } from '@/shared/ui/EmptyState'
import { userError, formatUserError } from '@/shared/lib/app-error'
import { useFormDraft } from '@/shared/lib/useFormDraft'
import { useMessenger } from '@/features/messenger/MessengerProvider'
import { MediaDropzone } from '@/shared/ui/MediaDropzone'
import { MediaImage } from '@/shared/ui/MediaImage'
import { PageHeader } from '@/app/layout'

type ClientCard = {
  id: string
  organization_id: string
  user_id: string
  display_name: string
  phone: string | null
  email: string | null
  contacts_hidden?: boolean
  preferences: string
  photo_media_id?: string | null
  birth_date?: string | null
  loyalty_status?: string
  skin_type?: string
  skin_features?: string
  skin_photo_media_ids?: string[] | unknown
  general_notes?: string
  segment?: string
}

type Visit = {
  id: string
  service_name: string
  price_minor: number
  completed_at: string
  appointment_id: string
}

type VisitNote = {
  id: string
  visit_id: string
  body: string
  created_at: string
  service_name: string
  completed_at: string
}

type Formula = {
  id: string
  name?: string
  brand?: string
  oxidizer?: string
  ratio?: string
  comment?: string
  created_at: string
  redacted?: boolean
  omit_formula?: boolean
  components?: Array<{ label?: string; amount?: string; name?: string; code?: string; grams?: number | string; qty?: string; unit?: string; proportion?: string } | string>
}

type CardConsultation = {
  id: string
  status: string
  updated_at: string
  current_version?: { version_no?: number; status?: string }
}

type TabKey = 'profile' | 'history' | 'analyses'

const DISPUTE_FIELDS = [
  { key: 'hair_color', label: 'Цвет волос' },
  { key: 'hair_condition', label: 'Состояние волос' },
  { key: 'preferences', label: 'Предпочтения' },
  { key: 'display_name', label: 'Имя' },
  { key: 'phone', label: 'Телефон' },
  { key: 'email', label: 'Email' },
  { key: 'skin_type', label: 'Тип кожи' },
  { key: 'skin_features', label: 'Особенности кожи' },
  { key: 'loyalty_status', label: 'Статус клиента' },
  { key: 'birth_date', label: 'Дата рождения' },
  { key: 'general_notes', label: 'Заметки' },
] as const

const noteSchema = z.object({
  visit_id: z.string().min(1, 'Выберите визит'),
  body: z.string().min(2, 'Введите заметку'),
})

const formulaSchema = z.object({
  name: z.string().min(2, 'Укажите название'),
  brand: z.string().optional(),
  components_text: z.string().min(2, 'Укажите состав'),
  oxidizer: z.string().optional(),
  ratio: z.string().optional(),
  comment: z.string().optional(),
})

type FormulaComponent = {
  label?: string
  name?: string
  code?: string
  amount?: string
  grams?: number | string
  qty?: string
  unit?: string
  proportion?: string
}

export function formatFormulaComponent(component: FormulaComponent | string): string {
  if (typeof component === 'string') return component.trim()
  const name = [component.label, component.name, component.code].find((part) => part && String(part).trim()) ?? ''
  const grams = component.grams != null && String(component.grams).trim() !== '' ? `${component.grams} г` : ''
  const amount = [component.amount, grams, component.qty, component.unit, component.proportion]
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter(Boolean)
    .join(' ')
  return [String(name).trim(), amount].filter(Boolean).join(' · ')
}

function formulaComponents(f: Formula): string[] {
  if (!f.components || f.components.length === 0) return []
  return f.components.map((c) => formatFormulaComponent(c)).filter(Boolean)
}

function ageFromBirth(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1
  return age >= 0 && age < 130 ? age : null
}

function formatBirth(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('ru-RU')
}

function loyaltyLabel(status: string | undefined, segment?: string): string | null {
  const raw = (status || '').trim().toLowerCase()
  if (raw === 'loyal' || raw === 'постоянный' || raw === 'постоянный клиент') return 'Постоянный клиент'
  if (raw) return status!.trim()
  if (segment === 'active') return 'Постоянный клиент'
  if (segment === 'new') return 'Новый клиент'
  if (segment === 'lapsed') return 'Давно не был'
  return null
}

function asSkinPhotos(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((x) => String(x)).filter(Boolean)
}

function consultStatusLabel(status: string) {
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
    default:
      return status
  }
}

export function ClientCardPage() {
  const { id, appointmentId } = useParams()
  const { accessToken, user } = useAuth()
  const messenger = useMessenger()
  const canMaster = hasMasterAccess(user)
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('profile')
  const [editing, setEditing] = useState(false)
  const [disputeOpen, setDisputeOpen] = useState(false)
  const [disputeField, setDisputeField] = useState<(typeof DISPUTE_FIELDS)[number]['key']>('preferences')
  const [disputeComment, setDisputeComment] = useState('')
  const [disputeDone, setDisputeDone] = useState(false)

  const cardQuery = useQuery({
    queryKey: ['client', id, appointmentId],
    queryFn: async () => {
      if (appointmentId) {
        return apiRequest<ClientCard>(`/v1/clients/appointment/${appointmentId}`, { token: accessToken })
      }
      return apiRequest<ClientCard>(`/v1/clients/id/${id}`, { token: accessToken })
    },
    enabled: Boolean(accessToken && (id || appointmentId)),
    retry: false,
  })

  const cardId = cardQuery.data?.id
  const clientUserId = cardQuery.data?.user_id
  const isCardOwner = Boolean(cardQuery.data && user?.id === cardQuery.data.user_id)
  const canEditClinical = canMaster && !isCardOwner
  const canEditPersonal = isCardOwner || canMaster

  const visits = useQuery({
    queryKey: ['client-visits', cardId],
    queryFn: () => apiRequest<{ items: Visit[] }>(`/v1/clients/id/${cardId}/visits`, { token: accessToken }),
    enabled: Boolean(cardId && accessToken),
  })
  const notes = useQuery({
    queryKey: ['client-notes', cardId],
    queryFn: () => apiRequest<{ items: VisitNote[] }>(`/v1/clients/id/${cardId}/notes`, { token: accessToken }),
    enabled: Boolean(cardId && accessToken),
  })
  const formulas = useQuery({
    queryKey: ['client-formulas', cardId],
    queryFn: () => apiRequest<{ items: Formula[] }>(`/v1/clients/id/${cardId}/formulas`, { token: accessToken }),
    enabled: Boolean(cardId && accessToken),
  })
  const consultations = useQuery({
    queryKey: ['client-consultations', cardId],
    queryFn: () =>
      apiRequest<{ items: CardConsultation[] }>(`/v1/clients/id/${cardId}/consultations`, { token: accessToken }),
    enabled: Boolean(cardId && accessToken),
  })
  const subscription = useQuery({
    queryKey: ['me-subscription'],
    queryFn: () =>
      apiRequest<{ effective_plan: string }>('/v1/me/subscription', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const isPremium = subscription.data?.effective_plan === 'premium'
  const [omitFormula, setOmitFormula] = useState(false)
  const autoConfirm = useQuery({
    queryKey: ['client-auto-confirm', clientUserId],
    queryFn: () =>
      apiRequest<{ auto_confirm: boolean }>(`/v1/me/clients/${clientUserId}/auto-confirm`, {
        token: accessToken,
      }),
    enabled: Boolean(canMaster && clientUserId && accessToken),
  })
  const blacklist = useQuery({
    queryKey: ['client-blacklist', clientUserId],
    queryFn: () =>
      apiRequest<{ blocked: boolean; no_show_count: number }>(`/v1/me/clients/${clientUserId}/blacklist`, {
        token: accessToken,
      }),
    enabled: Boolean(canMaster && clientUserId && accessToken),
  })
  const setAutoConfirm = useMutation({
    mutationFn: (auto_confirm: boolean) =>
      apiRequest(`/v1/me/clients/${clientUserId}/auto-confirm`, {
        method: 'PUT',
        token: accessToken,
        body: { auto_confirm },
      }),
    onSuccess: async () => {
      setOk('Автоподтверждение обновлено')
      toast.success('Автоподтверждение обновлено')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['client-auto-confirm', clientUserId] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось сохранить')),
  })

  const unblock = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/me/clients/${clientUserId}/unblock`, {
        method: 'POST',
        token: accessToken,
        body: {},
      }),
    onSuccess: async () => {
      setOk('Клиент разблокирован')
      toast.success('Клиент разблокирован')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['client-blacklist', clientUserId] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось разблокировать')),
  })

  const noteForm = useForm<z.infer<typeof noteSchema>>({ resolver: zodResolver(noteSchema) })
  const formulaForm = useForm<z.infer<typeof formulaSchema>>({ resolver: zodResolver(formulaSchema) })
  const noteDraft = useFormDraft(noteForm, `client-note:${cardId}`)
  const formulaDraft = useFormDraft(formulaForm, `client-formula:${cardId}`)

  const [draft, setDraft] = useState({
    birth_date: '',
    loyalty_status: '',
    skin_type: '',
    skin_features: '',
    general_notes: '',
    preferences: '',
    photo_media_id: null as string | null,
    skin_photos: [] as string[],
  })

  const startEdit = () => {
    const c = cardQuery.data
    if (!c) return
    setDraft({
      birth_date: c.birth_date ?? '',
      loyalty_status: c.loyalty_status ?? '',
      skin_type: c.skin_type ?? '',
      skin_features: c.skin_features ?? '',
      general_notes: c.general_notes ?? '',
      preferences: c.preferences ?? '',
      photo_media_id: c.photo_media_id ?? null,
      skin_photos: asSkinPhotos(c.skin_photo_media_ids),
    })
    setEditing(true)
  }

  const saveProfile = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        preferences: draft.preferences,
        photo_media_id: draft.photo_media_id,
        clear_photo: !draft.photo_media_id,
        birth_date: draft.birth_date || null,
        clear_birth_date: !draft.birth_date,
      }
      if (canEditClinical) {
        body.loyalty_status = draft.loyalty_status
        body.skin_type = draft.skin_type
        body.skin_features = draft.skin_features
        body.general_notes = draft.general_notes
        body.skin_photo_media_ids = draft.skin_photos
      }
      return apiRequest<ClientCard>(`/v1/clients/id/${cardId}`, {
        method: 'PATCH',
        token: accessToken,
        body,
      })
    },
    onSuccess: async (card) => {
      qc.setQueryData(['client', id, appointmentId], card)
      await qc.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'client',
      })
      await qc.invalidateQueries({ queryKey: ['clients-mine'] })
      await qc.invalidateQueries({ queryKey: ['client-notes', cardId] })
      setEditing(false)
      setOk('Карточка сохранена')
      toast.success('Карточка сохранена')
      setError(null)
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось сохранить карточку')),
  })

  const saveNote = useMutation({
    mutationFn: (v: z.infer<typeof noteSchema>) =>
      apiRequest(`/v1/clients/id/${cardId}/notes`, { token: accessToken, body: v }),
    onSuccess: async () => {
      noteDraft.clear()
      setOk('Заметка сохранена')
      toast.success('Заметка сохранена')
      setError(null)
      noteForm.reset()
      await qc.invalidateQueries({ queryKey: ['client-notes', cardId] })
    },
    onError: (e) => setError(formatUserError(e, 'Ошибка заметки')),
  })

  const saveFormula = useMutation({
    mutationFn: (v: z.infer<typeof formulaSchema>) =>
      apiRequest(`/v1/clients/id/${cardId}/formulas`, {
        token: accessToken,
        body: {
          name: v.name,
          brand: v.brand ?? '',
          components: v.components_text.split(',').map((s) => s.trim()).filter(Boolean).map((label) => ({ label })),
          oxidizer: v.oxidizer ?? '',
          ratio: v.ratio ?? '',
          comment: v.comment ?? '',
          omit_formula: isPremium && omitFormula,
        },
      }),
    onSuccess: async () => {
      formulaDraft.clear()
      setOk('Состав сохранён')
      toast.success('Состав сохранён')
      setError(null)
      formulaForm.reset()
      setOmitFormula(false)
      await qc.invalidateQueries({ queryKey: ['client-formulas', cardId] })
    },
    onError: (e) => setError(formatUserError(e, 'Ошибка состава')),
  })

  const submitDispute = useMutation({
    mutationFn: () =>
      apiRequest<{ dispute: { id: string; field_key: string; status: string }; already_open?: boolean }>(
        `/v1/clients/id/${cardId}/disputes`,
        { token: accessToken, body: { field_key: disputeField, comment: disputeComment } },
      ),
    onSuccess: async (res) => {
      setError(null)
      setDisputeDone(true)
      const msg = Boolean(res.already_open) ? 'Несоответствие уже зарегистрировано' : 'Несоответствие зафиксировано'
      setOk(msg)
      toast.success(msg)
      await qc.invalidateQueries({ queryKey: ['client', id, appointmentId] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось зафиксировать несоответствие')),
  })

  const lastVisit = useMemo(() => visits.data?.items?.[0] ?? null, [visits.data])
  const age = ageFromBirth(cardQuery.data?.birth_date)
  const loyalty = loyaltyLabel(cardQuery.data?.loyalty_status, cardQuery.data?.segment)
  const skinPhotos = asSkinPhotos(cardQuery.data?.skin_photo_media_ids)

  if (cardQuery.isLoading) return <div className="page state-box">Загрузка карточки…</div>
  if (cardQuery.isError) {
    return (
      <main className="page">
        <ErrorBanner error={cardQuery.error} fallbackTitle="Не удалось открыть карточку клиента" />
      </main>
    )
  }
  if (!cardQuery.data) {
    return (
      <main className="page">
        <EmptyState title="Карточка недоступна" text="Завершите визит, чтобы карточка клиента появилась." />
      </main>
    )
  }

  const card = cardQuery.data
  const roleBadge = isCardOwner ? 'Клиент' : 'Мастер'

  return (
    <main className="page stack client-card-page" data-testid="client-card-page">
      <PageHeader
        title="Клиент"
        subtitle={card.display_name}
        actions={<span className="badge" data-testid="client-card-role">{roleBadge}</span>}
      />

      {error && <ErrorBanner error={error} />}
      {ok && <div className="state-box success">{ok}</div>}

      <section className="card client-card-hero" data-testid="client-card-hero">
        <div className="client-card-hero-row">
          <div className="media-frame media-frame--square client-card-avatar">
            {(editing ? draft.photo_media_id : card.photo_media_id) ? (
              <MediaImage
                mediaId={(editing ? draft.photo_media_id : card.photo_media_id)!}
                token={accessToken}
                alt={card.display_name}
                variant="cover"
              />
            ) : (
              <div className="media-fallback" aria-hidden>
                {card.display_name.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <div className="stack-sm client-card-hero-meta">
            <strong data-testid="client-card-name">{card.display_name}</strong>
            <p className="muted" data-testid="client-card-age">
              {[age != null ? `${age} ${age === 1 ? 'год' : age < 5 ? 'года' : 'лет'}` : null, card.birth_date ? formatBirth(card.birth_date) : null]
                .filter(Boolean)
                .join(' · ') || 'Возраст не указан'}
            </p>
            {loyalty && (
              <span className="badge badge-success" data-testid="client-loyalty">
                {loyalty}
              </span>
            )}
            {card.contacts_hidden ? (
              <p className="muted" data-testid="contacts-hidden">Контакты скрыты политикой салона</p>
            ) : (
              <p className="client-passport" data-testid="client-contacts">
                {[card.phone, card.email].filter(Boolean).join(' · ') || 'Контакты не указаны'}
              </p>
            )}
          </div>
        </div>
        <div className="row-wrap gap-sm">
          <button
            className="btn btn-secondary btn-compact"
            type="button"
            data-testid="write-client"
            onClick={async () => {
              try {
                await messenger.start({ type: 'client_master', client_user_id: card.user_id })
              } catch (e) {
                setError(userError(e, 'Не удалось открыть переписку'))
              }
            }}
          >
            Написать
          </button>
          <button
            className="btn btn-secondary btn-compact"
            type="button"
            data-testid="dispute-open"
            onClick={() => {
              setDisputeOpen(true)
              setDisputeDone(false)
            }}
          >
            Не соответствует
          </button>
          {canEditPersonal && !editing && (
            <button className="btn btn-secondary btn-compact" type="button" data-testid="client-card-edit" onClick={startEdit}>
              Редактировать
            </button>
          )}
        </div>
      </section>

      <nav className="tabs client-card-tabs" aria-label="Разделы карточки" data-testid="client-card-tabs">
        {(
          [
            ['profile', 'Профиль'],
            ['history', 'История'],
            ['analyses', 'Анализы'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'active' : ''}
            aria-pressed={tab === key}
            data-testid={`client-tab-${key}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'profile' && (
        <div className="stack" data-testid="client-tab-profile-panel">
          {editing ? (
            <section className="card stack" data-testid="client-card-edit-form">
              <h2>Редактирование</h2>
              <MediaDropzone
                purpose="profile"
                value={draft.photo_media_id}
                allowGif={false}
                label="Фото клиента"
                onChange={(mediaId) => setDraft((d) => ({ ...d, photo_media_id: mediaId }))}
              />
              <label className="field">
                <span>Дата рождения</span>
                <input
                  type="date"
                  value={draft.birth_date}
                  onChange={(e) => setDraft((d) => ({ ...d, birth_date: e.target.value }))}
                  data-testid="edit-birth-date"
                />
              </label>
              <label className="field">
                <span>Предпочтения</span>
                <textarea
                  value={draft.preferences}
                  onChange={(e) => setDraft((d) => ({ ...d, preferences: e.target.value }))}
                  rows={2}
                />
              </label>
              {canEditClinical && (
                <>
                  <label className="field">
                    <span>Статус клиента</span>
                    <select
                      value={draft.loyalty_status}
                      onChange={(e) => setDraft((d) => ({ ...d, loyalty_status: e.target.value }))}
                      data-testid="edit-loyalty"
                    >
                      <option value="">Не указан</option>
                      <option value="loyal">Постоянный клиент</option>
                      <option value="new">Новый клиент</option>
                      <option value="lapsed">Давно не был</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Тип кожи</span>
                    <input
                      value={draft.skin_type}
                      onChange={(e) => setDraft((d) => ({ ...d, skin_type: e.target.value }))}
                      placeholder="например, комбинированная"
                      data-testid="edit-skin-type"
                    />
                  </label>
                  <label className="field">
                    <span>Особенности</span>
                    <textarea
                      value={draft.skin_features}
                      onChange={(e) => setDraft((d) => ({ ...d, skin_features: e.target.value }))}
                      rows={2}
                      data-testid="edit-skin-features"
                    />
                  </label>
                  <label className="field">
                    <span>Заметки</span>
                    <textarea
                      value={draft.general_notes}
                      onChange={(e) => setDraft((d) => ({ ...d, general_notes: e.target.value }))}
                      rows={2}
                      data-testid="edit-general-notes"
                    />
                  </label>
                  <div className="stack-sm">
                    <strong>Фото кожи</strong>
                    <MediaDropzone
                      purpose="portfolio"
                      value={null}
                      allowGif={false}
                      label="Добавить фото кожи"
                      onChange={(mediaId) => {
                        if (!mediaId) return
                        setDraft((d) => ({ ...d, skin_photos: [...d.skin_photos, mediaId].slice(0, 8) }))
                      }}
                    />
                    {draft.skin_photos.length > 0 && (
                      <div className="client-skin-thumbs">
                        {draft.skin_photos.map((mid) => (
                          <button
                            key={mid}
                            type="button"
                            className="media-frame media-frame--thumb"
                            aria-label="Удалить фото"
                            onClick={() => setDraft((d) => ({ ...d, skin_photos: d.skin_photos.filter((x) => x !== mid) }))}
                          >
                            <MediaImage mediaId={mid} token={accessToken} alt="" variant="cover" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className="row-wrap gap-sm">
                <button
                  className="btn btn-primary"
                  type="button"
                  data-testid="client-card-save"
                  disabled={saveProfile.isPending}
                  onClick={() => saveProfile.mutate()}
                >
                  Сохранить
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => setEditing(false)}>
                  Отмена
                </button>
              </div>
            </section>
          ) : (
            <>
              <section className="card stack" data-testid="client-skin-section">
                <h2>Кожа и особенности</h2>
                <p>
                  <span className="muted">Тип кожи: </span>
                  <strong>{card.skin_type || '—'}</strong>
                </p>
                <p>
                  <span className="muted">Особенности: </span>
                  {card.skin_features || '—'}
                </p>
                {card.preferences && (
                  <p className="muted" data-testid="client-preferences">
                    Предпочтения: {card.preferences}
                  </p>
                )}
                {skinPhotos.length > 0 && (
                  <div className="client-skin-thumbs" data-testid="client-skin-photos">
                    {skinPhotos.map((mid) => (
                      <div key={mid} className="media-frame media-frame--thumb">
                        <MediaImage mediaId={mid} token={accessToken} alt="Кожа" variant="cover" />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="card stack" data-testid="client-last-visit">
                <h2>Последний визит</h2>
                {lastVisit ? (
                  <Link className="client-last-visit-row" to={`/appointments/${lastVisit.appointment_id}`}>
                    <span aria-hidden>📅</span>
                    <div>
                      <strong>{formatBirth(lastVisit.completed_at)}</strong>
                      <p className="muted">{lastVisit.service_name}</p>
                    </div>
                  </Link>
                ) : (
                  <p className="muted">Посещений пока нет</p>
                )}
              </section>

              <section className="card stack" data-testid="client-notes-section">
                <h2>Заметки</h2>
                {card.general_notes && <p data-testid="client-general-notes">{card.general_notes}</p>}
                {(notes.data?.items ?? []).length === 0 && !card.general_notes && (
                  <p className="muted">Заметок пока нет</p>
                )}
                <ul className="list stack-sm">
                  {(notes.data?.items ?? []).slice(0, 5).map((n) => (
                    <li key={n.id} className="client-note-item">
                      <p>{n.body}</p>
                      <p className="muted">
                        {n.service_name} · {new Date(n.created_at).toLocaleDateString('ru-RU')}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          {canMaster && (
            <section className="card stack">
              <h2>
                Автоподтверждение записей <Hint id="auto-confirm" title="Автоподтверждение">Для этого клиента новые записи подтверждаются сразу.</Hint>
              </h2>
              {autoConfirm.data && (
                <label className="field-check">
                  <input
                    type="checkbox"
                    data-testid="auto-confirm-toggle"
                    checked={autoConfirm.data.auto_confirm}
                    disabled={setAutoConfirm.isPending}
                    onChange={(e) => setAutoConfirm.mutate(e.target.checked)}
                  />
                  <span>Автоподтверждение для этого клиента</span>
                </label>
              )}
            </section>
          )}

          {canMaster && card.user_id && (
            <section className="card stack">
              <h2>Чёрный список (no-show)</h2>
              <p className="muted">
                No-show: {blacklist.data?.no_show_count ?? 0} · статус:{' '}
                {blacklist.data?.blocked ? 'заблокирован' : 'доступна запись'}
              </p>
              {blacklist.data?.blocked && (
                <button className="btn btn-secondary" type="button" disabled={unblock.isPending} onClick={() => unblock.mutate()}>
                  Разблокировать клиента
                </button>
              )}
            </section>
          )}

          {canMaster && clientUserId && (
            <Link className="btn btn-primary btn-block" to={`/calendar?client=${clientUserId}`} data-testid="client-book-cta">
              Записать на приём
            </Link>
          )}
          {canMaster && clientUserId && <RepeatOffer clientUserId={clientUserId} token={accessToken} />}
        </div>
      )}

      {tab === 'history' && (
        <div className="stack" data-testid="client-tab-history-panel">
          <section className="stack">
            <h2>История посещений</h2>
            {visits.isLoading && <div className="state-box">Загрузка…</div>}
            {visits.data && visits.data.items.length === 0 && (
              <div className="empty-state">
                <h2>Посещений пока нет</h2>
              </div>
            )}
            <div className="list">
              {visits.data?.items.map((v) => (
                <article key={v.id} className="history-card">
                  <div className="row between">
                    <strong>{v.service_name}</strong>
                    <span>{formatMoney(v.price_minor)}</span>
                  </div>
                  <p className="muted">{new Date(v.completed_at).toLocaleString('ru-RU')}</p>
                  <VisitSchemeSummary appointmentId={v.appointment_id} accessToken={accessToken} />
                </article>
              ))}
            </div>
          </section>

          {canMaster && (
            <section className="card stack">
              <h2>Новая заметка</h2>
              <form className="stack" onSubmit={noteForm.handleSubmit((v) => saveNote.mutate(v))}>
                <div className="field">
                  <label htmlFor="visit_id">Визит</label>
                  <select id="visit_id" aria-invalid={Boolean(noteForm.formState.errors.visit_id)} {...noteForm.register('visit_id')}>
                    <option value="">Выберите</option>
                    {visits.data?.items.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.service_name} · {new Date(v.completed_at).toLocaleDateString('ru-RU')}
                      </option>
                    ))}
                  </select>
                  {noteForm.formState.errors.visit_id && <span className="error">{noteForm.formState.errors.visit_id.message}</span>}
                </div>
                <div className="field">
                  <label htmlFor="body">Текст</label>
                  <textarea id="body" aria-invalid={Boolean(noteForm.formState.errors.body)} {...noteForm.register('body')} />
                  {noteForm.formState.errors.body && <span className="error">{noteForm.formState.errors.body.message}</span>}
                </div>
                <button className="btn btn-primary btn-block" type="submit" disabled={saveNote.isPending}>
                  Сохранить заметку
                </button>
              </form>
            </section>
          )}
        </div>
      )}

      {tab === 'analyses' && (
        <div className="stack" data-testid="client-tab-analyses-panel">
          <section className="stack">
            <h2>Диагностики волос</h2>
            {(consultations.data?.items ?? []).length === 0 && <p className="muted">Диагностик пока нет</p>}
            <ul className="list stack-sm">
              {(consultations.data?.items ?? []).map((c) => (
                <li key={c.id} className="card">
                  <Link to={`/consultations/${c.id}`} data-testid={`card-consult-${c.id}`}>
                    <strong>{consultStatusLabel(c.status)}</strong>
                    <div className="muted">
                      v{c.current_version?.version_no ?? '—'} · {new Date(c.updated_at).toLocaleString('ru-RU')}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="stack">
            <h2>Составы окрашивания</h2>
            {formulas.data && formulas.data.items.length === 0 && (
              <div className="empty-state">
                <h2>Составов пока нет</h2>
              </div>
            )}
            <div className="list">
              {formulas.data?.items.map((f) => {
                if (f.redacted) {
                  return (
                    <article key={f.id} className="formula-card" data-testid="formula-redacted">
                      <p className="muted">Состав скрыт</p>
                    </article>
                  )
                }
                const comps = formulaComponents(f)
                return (
                  <article key={f.id} className="formula-card" data-testid="formula-visible">
                    <div className="row between">
                      <strong>{f.name}</strong>
                      <span className="muted">{new Date(f.created_at).toLocaleDateString('ru-RU')}</span>
                    </div>
                    <div className="formula-grid">
                      <div className="formula-field">
                        <span>Бренд</span>
                        <strong>{f.brand || '—'}</strong>
                      </div>
                      <div className="formula-field">
                        <span>Окислитель</span>
                        <strong>{f.oxidizer || '—'}</strong>
                      </div>
                      <div className="formula-field">
                        <span>Пропорция</span>
                        <strong>{f.ratio || '—'}</strong>
                      </div>
                      <div className="formula-field">
                        <span>Компоненты</span>
                        <strong>{comps.join(', ') || '—'}</strong>
                      </div>
                    </div>
                    {f.comment && <p>{f.comment}</p>}
                  </article>
                )
              })}
            </div>
            {canMaster && (
              <form className="card stack" onSubmit={formulaForm.handleSubmit((v) => saveFormula.mutate(v))}>
                <h3>Новый состав</h3>
                <div className="field">
                  <label>Название</label>
                  <input {...formulaForm.register('name')} />
                </div>
                <div className="field">
                  <label>Бренд</label>
                  <input {...formulaForm.register('brand')} />
                </div>
                <div className="field">
                  <label>Компоненты через запятую</label>
                  <input {...formulaForm.register('components_text')} placeholder="8.1 30g, 9.13 20g" />
                </div>
                <div className="field">
                  <label>Окислитель</label>
                  <input {...formulaForm.register('oxidizer')} />
                </div>
                <div className="field">
                  <label>Пропорция</label>
                  <input {...formulaForm.register('ratio')} placeholder="1:2" />
                </div>
                <div className="field">
                  <label>Комментарий</label>
                  <textarea {...formulaForm.register('comment')} />
                </div>
                {isPremium && (
                  <label className="field-check">
                    <input
                      type="checkbox"
                      data-testid="omit-formula"
                      checked={omitFormula}
                      onChange={(e) => setOmitFormula(e.target.checked)}
                    />
                    <span>Не указывать формулу</span>
                  </label>
                )}
                <button className="btn btn-primary btn-block" type="submit" disabled={saveFormula.isPending}>
                  Сохранить состав
                </button>
              </form>
            )}
          </section>
        </div>
      )}

      <Modal open={disputeOpen} onClose={() => setDisputeOpen(false)} title="Не соответствует действительности">
        {disputeDone ? (
          <div className="state-box success" data-testid="dispute-success">
            {ok || 'Несоответствие зафиксировано'}
          </div>
        ) : (
          <>
            <p className="muted">Исходные данные клиента не изменятся. Будет зафиксирован спор.</p>
            <div className="field">
              <label htmlFor="dispute-field">Спорное поле</label>
              <select
                id="dispute-field"
                data-testid="dispute-field"
                value={disputeField}
                onChange={(e) => setDisputeField(e.target.value as typeof disputeField)}
              >
                {DISPUTE_FIELDS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="dispute-comment">Комментарий</label>
              <textarea
                id="dispute-comment"
                data-testid="dispute-comment"
                value={disputeComment}
                onChange={(e) => setDisputeComment(e.target.value)}
                placeholder="Что именно неверно"
              />
            </div>
            <button
              className="btn btn-primary btn-block"
              type="button"
              data-testid="dispute-submit"
              disabled={submitDispute.isPending}
              onClick={() => submitDispute.mutate()}
            >
              Отправить
            </button>
          </>
        )}
      </Modal>
    </main>
  )
}
