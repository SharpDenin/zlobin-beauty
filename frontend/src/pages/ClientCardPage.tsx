import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { apiRequest } from '@/shared/api/client'
import { hasMasterAccess, useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { useState } from 'react'
import { VisitSchemeSummary } from '@/features/scheme/VisitSchemeSummary'
import { RepeatOffer } from '@/pages/RepeatOffer'
import { Hint } from '@/shared/ui/Hint'
import { Modal } from '@/shared/ui/Modal'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { EmptyState } from '@/shared/ui/EmptyState'
import { userError, formatUserError } from '@/shared/lib/app-error'
import { useFormDraft } from '@/shared/lib/useFormDraft'
import { useMessenger } from '@/features/messenger/MessengerProvider'

type ClientCard = {
  id: string
  organization_id: string
  user_id: string
  display_name: string
  phone: string | null
  email: string | null
  contacts_hidden?: boolean
  preferences: string
}

type Visit = {
  id: string
  service_name: string
  price_minor: number
  completed_at: string
  appointment_id: string
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
  components?: Array<{ label?: string; amount?: string } | string>
}

const DISPUTE_FIELDS = [
  { key: 'hair_color', label: 'Цвет волос' },
  { key: 'hair_condition', label: 'Состояние волос' },
  { key: 'preferences', label: 'Предпочтения' },
  { key: 'display_name', label: 'Имя' },
  { key: 'phone', label: 'Телефон' },
  { key: 'email', label: 'Email' },
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

function formulaComponents(f: Formula): string[] {
  if (!f.components || f.components.length === 0) return []
  return f.components.map((c) => {
    if (typeof c === 'string') return c
    return [c.label, c.amount].filter(Boolean).join(' ')
  }).filter(Boolean)
}

export function ClientCardPage() {
  const { id, appointmentId } = useParams()
  const { accessToken, user } = useAuth()
  const messenger = useMessenger()
  const canMaster = hasMasterAccess(user)
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
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
  const visits = useQuery({
    queryKey: ['client-visits', cardId],
    queryFn: () => apiRequest<{ items: Visit[] }>(`/v1/clients/id/${cardId}/visits`, { token: accessToken }),
    enabled: Boolean(cardId && accessToken),
  })
  const formulas = useQuery({
    queryKey: ['client-formulas', cardId],
    queryFn: () => apiRequest<{ items: Formula[] }>(`/v1/clients/id/${cardId}/formulas`, { token: accessToken }),
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
      setError(null)
      await qc.invalidateQueries({ queryKey: ['client-blacklist', clientUserId] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось разблокировать')),
  })

  const noteForm = useForm<z.infer<typeof noteSchema>>({ resolver: zodResolver(noteSchema) })
  const formulaForm = useForm<z.infer<typeof formulaSchema>>({ resolver: zodResolver(formulaSchema) })
  const noteDraft = useFormDraft(noteForm, `client-note:${cardId}`)
  const formulaDraft = useFormDraft(formulaForm, `client-formula:${cardId}`)

  const saveNote = useMutation({
    mutationFn: (v: z.infer<typeof noteSchema>) =>
      apiRequest(`/v1/clients/id/${cardId}/notes`, { token: accessToken, body: v }),
    onSuccess: async () => {
      noteDraft.clear()
      setOk('Заметка сохранена')
      setError(null)
      noteForm.reset()
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
      setOk(Boolean(res.already_open) ? 'Несоответствие уже зарегистрировано' : 'Несоответствие зафиксировано')
      await qc.invalidateQueries({ queryKey: ['client', id, appointmentId] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось зафиксировать несоответствие')),
  })

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

  return (
    <main className="page stack">
      <section className="hero">
        <div className="stack">
          <h1>{card.display_name} <Hint id="client-scheme" title="Карточка клиента">Здесь история визитов, автоподтверждение и схема окрашивания. Контакты зависят от политики салона.</Hint></h1>
          {card.contacts_hidden ? (
            <p className="muted" data-testid="contacts-hidden">Контакты скрыты политикой салона</p>
          ) : (
            <p data-testid="client-contacts">{card.phone || card.email || 'Контакты не указаны'}</p>
          )}
          {card.preferences && <p className="muted" data-testid="client-preferences">Предпочтения: {card.preferences}</p>}
          <button
            className="btn btn-secondary"
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
            className="btn btn-secondary"
            type="button"
            data-testid="dispute-open"
            onClick={() => {
              setDisputeOpen(true)
              setDisputeDone(false)
            }}
          >
            Не соответствует действительности
          </button>
        </div>
      </section>

      {error && <ErrorBanner error={error} />}
      {ok && <div className="state-box success">{ok}</div>}

      {canMaster && (
        <section className="card stack">
          <h2>Автоподтверждение записей <Hint id="auto-confirm" title="Автоподтверждение">Для этого клиента новые записи подтверждаются сразу. Чёрный список имеет приоритет.</Hint></h2>
          <p className="muted">Новые записи этого клиента будут подтверждаться автоматически.</p>
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
            <button
              className="btn btn-secondary"
              type="button"
              disabled={unblock.isPending}
              onClick={() => unblock.mutate()}
            >
              Разблокировать клиента
            </button>
          )}
        </section>
      )}

      <section className="stack">
        <h2>История посещений</h2>
        {visits.isLoading && <div className="state-box">Загрузка…</div>}
        {visits.data && visits.data.items.length === 0 && <div className="empty-state"><h2>Посещений пока нет</h2></div>}
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

      {canMaster && clientUserId && (
        <RepeatOffer clientUserId={clientUserId} token={accessToken} />
      )}

      <section className="card stack">
        <h2>Заметка</h2>
        <form className="stack" onSubmit={noteForm.handleSubmit((v) => saveNote.mutate(v))}>
          <div className="field">
            <label htmlFor="visit_id">Визит</label>
            <select id="visit_id" aria-invalid={Boolean(noteForm.formState.errors.visit_id)} {...noteForm.register('visit_id')}>
              <option value="">Выберите</option>
              {visits.data?.items.map((v) => (
                <option key={v.id} value={v.id}>{v.service_name} · {new Date(v.completed_at).toLocaleDateString('ru-RU')}</option>
              ))}
            </select>
            {noteForm.formState.errors.visit_id && <span className="error">{noteForm.formState.errors.visit_id.message}</span>}
          </div>
          <div className="field">
            <label htmlFor="body">Текст</label>
            <textarea id="body" aria-invalid={Boolean(noteForm.formState.errors.body)} {...noteForm.register('body')} />
            {noteForm.formState.errors.body && <span className="error">{noteForm.formState.errors.body.message}</span>}
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={saveNote.isPending}>Сохранить заметку</button>
        </form>
      </section>

      <section className="stack">
        <h2>Составы окрашивания</h2>
        {formulas.data && formulas.data.items.length === 0 && (
          <div className="empty-state"><h2>Составов пока нет</h2></div>
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
                  <div className="formula-field"><span>Бренд</span><strong>{f.brand || '—'}</strong></div>
                  <div className="formula-field"><span>Окислитель</span><strong>{f.oxidizer || '—'}</strong></div>
                  <div className="formula-field"><span>Пропорция</span><strong>{f.ratio || '—'}</strong></div>
                  <div className="formula-field"><span>Компоненты</span><strong>{comps.join(', ') || '—'}</strong></div>
                </div>
                {f.comment && <p>{f.comment}</p>}
              </article>
            )
          })}
        </div>
        <form className="card stack" onSubmit={formulaForm.handleSubmit((v) => saveFormula.mutate(v))}>
          <h3>Новый состав</h3>
          <div className="field"><label>Название</label><input {...formulaForm.register('name')} /></div>
          <div className="field"><label>Бренд</label><input {...formulaForm.register('brand')} /></div>
          <div className="field"><label>Компоненты через запятую</label><input {...formulaForm.register('components_text')} placeholder="8.1 30g, 9.13 20g" /></div>
          <div className="field"><label>Окислитель</label><input {...formulaForm.register('oxidizer')} /></div>
          <div className="field"><label>Пропорция</label><input {...formulaForm.register('ratio')} placeholder="1:2" /></div>
          <div className="field"><label>Комментарий</label><textarea {...formulaForm.register('comment')} /></div>
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
          <button className="btn btn-primary btn-block" type="submit" disabled={saveFormula.isPending}>Сохранить состав</button>
        </form>
      </section>

      <Modal
        open={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        title="Не соответствует действительности"
      >
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
                      <option key={f.key} value={f.key}>{f.label}</option>
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
