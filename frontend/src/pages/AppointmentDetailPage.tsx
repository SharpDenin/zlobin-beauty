import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { statusBadgeClass, statusLabel } from '@/shared/lib/status'
import { datetimeLocalToIso } from '@/shared/lib/time'
import { MediaDropzone } from '@/shared/ui/MediaDropzone'
import { MediaImage } from '@/shared/ui/MediaImage'
import { useToast } from '@/shared/ui/Toast'
import { ServiceSchemeForm, buildCategoryFields } from '@/features/scheme/ServiceSchemeForm'
import { VisitSchemeSummary } from '@/features/scheme/VisitSchemeSummary'
import { hasColorFormulaInput } from '@/shared/lib/visit-visibility'

type Appointment = {
  id: string
  service_name: string
  status: string
  starts_at: string
  ends_at: string
  price_minor: number
  duration_minutes: number
  master_user_id: string
  client_user_id: string
  organization_id: string
  cancel_reason?: string
  location_timezone?: string
}

const cancelSchema = z.object({ reason: z.string().min(2, 'Укажите причину') })
const rescheduleSchema = z.object({ starts_at: z.string().min(1, 'Выберите время') })
const reviewSchema = z.object({
  master_rating: z.coerce.number().min(1).max(5),
  result_rating: z.coerce.number().min(1).max(5),
  comment: z.string().optional(),
  publish_allowed: z.boolean().optional(),
})

export function AppointmentDetailPage() {
  const { id } = useParams()
  const { accessToken, user } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [beforeDraft, setBeforeDraft] = useState<string | null>(null)
  const [afterDraft, setAfterDraft] = useState<string | null>(null)
  const [technique, setTechnique] = useState('')
  const [schemeFields, setSchemeFields] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [productName, setProductName] = useState('')
  const [productQty, setProductQty] = useState('')
  const [proportion, setProportion] = useState('')
  const [skipScheme, setSkipScheme] = useState(false)
  const [skipConfirmed, setSkipConfirmed] = useState(false)
  const [omitFormula, setOmitFormula] = useState(false)

  const query = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => apiRequest<Appointment>(`/v1/appointments/${id}`, { token: accessToken }),
    enabled: Boolean(id && accessToken),
  })

  const history = useQuery({
    queryKey: ['appointment-history', id],
    queryFn: () => apiRequest<{ items: Array<{ from_status: string | null; to_status: string; reason: string; created_at: string }> }>(`/v1/appointments/${id}/history`, { token: accessToken }),
    enabled: Boolean(id && accessToken),
    retry: false,
  })

  const photos = useQuery({
    queryKey: ['appointment-photos', id],
    queryFn: () =>
      apiRequest<{ items: Array<{ id: string; media_id: string; kind: string }> }>(
        `/v1/appointments/${id}/photos`,
        { token: accessToken },
      ),
    enabled: Boolean(id && accessToken),
  })

  const subscription = useQuery({
    queryKey: ['me-subscription'],
    queryFn: () =>
      apiRequest<{ effective_plan: string; features?: string[] }>('/v1/me/subscription', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const canSkipScheme = Boolean(subscription.data?.features?.includes('skip_service_scheme'))
  const isPremium = subscription.data?.effective_plan === 'premium'
  const [photoPending, setPhotoPending] = useState(false)

  const deletePhoto = useMutation({
    mutationFn: (photoId: string) =>
      apiRequest(`/v1/appointments/${id}/photos/${photoId}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      setOk('Фото удалено')
      await qc.invalidateQueries({ queryKey: ['appointment-photos', id] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось удалить'),
  })

  const cancelForm = useForm<z.infer<typeof cancelSchema>>({ resolver: zodResolver(cancelSchema) })
  const rescheduleForm = useForm<z.infer<typeof rescheduleSchema>>({ resolver: zodResolver(rescheduleSchema) })
  const reviewForm = useForm<z.infer<typeof reviewSchema>>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { master_rating: 5, result_rating: 5, publish_allowed: true },
  })

  const act = useMutation({
    mutationFn: async (input: { path: string; body?: unknown }) =>
      apiRequest(input.path, { method: 'POST', token: accessToken, body: input.body }),
    onSuccess: async (_, vars) => {
      setError(null)
      setOk('Изменения сохранены')
      await qc.invalidateQueries({ queryKey: ['appointment', id] })
      await qc.invalidateQueries({ queryKey: ['appointments'] })
      await qc.invalidateQueries({ queryKey: ['appointment-history', id] })
      if (vars.path.includes('complete')) {
        await qc.invalidateQueries({ queryKey: ['clients'] })
      }
    },
    onError: (e) => {
      setOk(null)
      setError(e instanceof ApiError ? e.message : 'Операция не выполнена')
    },
  })

  if (query.isLoading) return <div className="page state-box">Загрузка записи…</div>
  if (query.isError || !query.data) return <div className="page state-box error">Запись не найдена или недоступна</div>

  const a = query.data
  const isMaster = user?.id === a.master_user_id
  const isClient = user?.id === a.client_user_id
  const cancellable = ['pending_confirmation', 'confirmed'].includes(a.status)
  const canStart = isMaster && a.status === 'confirmed'
  const canComplete = isMaster && a.status === 'in_progress'
  const canNoShow = isMaster && a.status === 'confirmed'
  const canReview = isClient && a.status === 'completed'
  const canUploadPhotos = isMaster && ['confirmed', 'in_progress', 'completed'].includes(a.status)
  const hasFormula = hasColorFormulaInput(schemeFields, productName)
  const canOmitFormula = isPremium && hasFormula

  async function attachVisitPhoto(mediaId: string | null, kind: 'before' | 'after') {
    if (!mediaId) {
      if (kind === 'before') setBeforeDraft(null)
      else setAfterDraft(null)
      return
    }
    if (!accessToken || !id) return
    setPhotoPending(true)
    setError(null)
    try {
      await apiRequest(`/v1/appointments/${id}/photos`, {
        token: accessToken,
        body: { media_id: mediaId, kind },
      })
      const msg = kind === 'before' ? 'Фото «до» добавлено' : 'Фото «после» добавлено'
      setOk(msg)
      toast.success(msg)
      if (kind === 'before') setBeforeDraft(null)
      else setAfterDraft(null)
      await qc.invalidateQueries({ queryKey: ['appointment-photos', id] })
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Ошибка загрузки фото'
      setError(msg)
      toast.error(msg)
      if (kind === 'before') setBeforeDraft(null)
      else setAfterDraft(null)
    } finally {
      setPhotoPending(false)
    }
  }

  return (
    <main className="page stack">
      <div className="row between">
        <h1>Запись</h1>
        <span className={`badge ${statusBadgeClass(a.status)}`}>{statusLabel(a.status)}</span>
      </div>

      <section className="card stack-sm">
        <strong>{a.service_name}</strong>
        <p>{new Date(a.starts_at).toLocaleString('ru-RU')} — {new Date(a.ends_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</p>
        <p>{formatMoney(a.price_minor)} · {a.duration_minutes} мин</p>
        {a.cancel_reason && <p>Причина отмены: {a.cancel_reason}</p>}
      </section>

      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      {a.status === 'completed' && (
        <section className="card stack">
          <h2>Схема услуги</h2>
          <VisitSchemeSummary appointmentId={a.id} accessToken={accessToken} />
        </section>
      )}

      <section className="card stack">
        <h2>Действия</h2>
        <div className="row">
          {canStart && (
            <button className="btn btn-primary" type="button" disabled={act.isPending} onClick={() => act.mutate({ path: `/v1/appointments/${a.id}/start` })}>
              Начать приём
            </button>
          )}
          {canComplete && (
            <div className="stack">
              <h3>Схема услуги</h3>
              <p className="muted">
                {canSkipScheme
                  ? 'Можно заполнить схему или не раскрывать её — потребуется подтверждение.'
                  : 'На Free схема обязательна: техника и хотя бы один продукт или материал.'}
              </p>
              <ServiceSchemeForm
                appointmentId={a.id}
                accessToken={accessToken}
                disabled={act.isPending}
                fieldValues={schemeFields}
                onFieldChange={(key, value) => setSchemeFields((prev) => ({ ...prev, [key]: value }))}
                technique={technique}
                onTechniqueChange={setTechnique}
                notes={notes}
                onNotesChange={setNotes}
                productName={productName}
                onProductNameChange={setProductName}
                productQty={productQty}
                onProductQtyChange={setProductQty}
                proportion={proportion}
                onProportionChange={setProportion}
              />
              {canSkipScheme && (
                <label className="field-check">
                  <input
                    type="checkbox"
                    data-testid="skip-scheme"
                    checked={skipScheme}
                    onChange={(e) => {
                      setSkipScheme(e.target.checked)
                      setSkipConfirmed(false)
                    }}
                  />
                  <span>Не раскрывать схему</span>
                </label>
              )}
              {skipScheme && canSkipScheme && (
                <div className="card stack-sm" data-testid="scheme-skip-confirm">
                  <p>Схема не будет раскрыта другим мастерам. Эта возможность доступна в Premium.</p>
                  <label className="field-check">
                    <input type="checkbox" checked={skipConfirmed} onChange={(e) => setSkipConfirmed(e.target.checked)} />
                    <span>Подтверждаю, что схема не раскрывается</span>
                  </label>
                </div>
              )}
              {canOmitFormula && (
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
              <button
                className="btn btn-primary"
                type="button"
                data-testid="complete-appointment"
                disabled={act.isPending || (skipScheme && !skipConfirmed)}
                onClick={() =>
                  act.mutate({
                    path: `/v1/appointments/${a.id}/complete`,
                    body: {
                      skipped: skipScheme,
                      omit_formula: canOmitFormula && omitFormula,
                      technique,
                      notes,
                      category_fields: buildCategoryFields(undefined, schemeFields, technique),
                      components: productName ? [{ name: productName, qty: productQty, proportion, unit: 'г' }] : [],
                    },
                  })
                }
              >
                Завершить
              </button>
            </div>
          )}
          {canNoShow && (
            <button className="btn btn-danger" type="button" disabled={act.isPending} onClick={() => act.mutate({ path: `/v1/appointments/${a.id}/no-show`, body: { reason: 'no_show' } })}>
              Неявка
            </button>
          )}
          {isMaster && (
            <Link className="btn btn-secondary" to={`/clients/by-appointment/${a.id}`}>Карточка клиента</Link>
          )}
        </div>

        {cancellable && (
          <form className="stack" onSubmit={cancelForm.handleSubmit((v) => act.mutate({ path: `/v1/appointments/${a.id}/cancel`, body: v }))}>
            <div className="field">
              <label htmlFor="reason">Отмена · причина</label>
              <input id="reason" aria-invalid={Boolean(cancelForm.formState.errors.reason)} {...cancelForm.register('reason')} />
              {cancelForm.formState.errors.reason && <span className="error">{cancelForm.formState.errors.reason.message}</span>}
            </div>
            <button className="btn btn-danger btn-block" type="submit" disabled={act.isPending}>Отменить запись</button>
          </form>
        )}

        {cancellable && (
          <form className="stack" onSubmit={rescheduleForm.handleSubmit((v) => act.mutate({
            path: `/v1/appointments/${a.id}/reschedule`,
            body: { starts_at: datetimeLocalToIso(v.starts_at, a.location_timezone || 'Europe/Moscow') },
          }))}>
            <div className="field">
              <label htmlFor="starts_at">Перенос · новое время (часовой пояс салона: {a.location_timezone || 'Europe/Moscow'})</label>
              <input id="starts_at" type="datetime-local" aria-invalid={Boolean(rescheduleForm.formState.errors.starts_at)} {...rescheduleForm.register('starts_at')} />
              {rescheduleForm.formState.errors.starts_at && <span className="error">{rescheduleForm.formState.errors.starts_at.message}</span>}
            </div>
            <button className="btn btn-secondary btn-block" type="submit" disabled={act.isPending}>Перенести</button>
          </form>
        )}
      </section>

      <section className="card stack">
        <h2>Фото до / после</h2>
        <p className="muted">Видят мастер и клиент этой записи. Загрузка — только мастер.</p>
        {photos.isLoading && <div className="state-box">Загрузка фото…</div>}
        <div className="list">
          {photos.data?.items.map((p) => (
            <article key={p.id} className="list-item stack-sm">
              <strong>{p.kind === 'before' ? 'До' : 'После'}</strong>
              <MediaImage mediaId={p.media_id} token={accessToken} alt={p.kind} className="portfolio-thumb" />
              {isMaster && (
                <button
                  className="btn btn-secondary btn-compact"
                  type="button"
                  disabled={deletePhoto.isPending}
                  onClick={() => deletePhoto.mutate(p.id)}
                >
                  Удалить
                </button>
              )}
            </article>
          ))}
        </div>
        {photos.data && photos.data.items.length === 0 && (
          <div className="state-box">Фото визита пока нет</div>
        )}
        {canUploadPhotos && (
          <div className="stack">
            <div className="field">
              <label>Добавить «до»</label>
              <MediaDropzone
                purpose="before_after"
                value={beforeDraft}
                onChange={(mediaId) => {
                  setBeforeDraft(mediaId)
                  if (mediaId) void attachVisitPhoto(mediaId, 'before')
                }}
                label="Фото до процедуры"
                disabled={photoPending}
              />
            </div>
            <div className="field">
              <label>Добавить «после»</label>
              <MediaDropzone
                purpose="before_after"
                value={afterDraft}
                onChange={(mediaId) => {
                  setAfterDraft(mediaId)
                  if (mediaId) void attachVisitPhoto(mediaId, 'after')
                }}
                label="Фото после процедуры"
                disabled={photoPending}
              />
            </div>
          </div>
        )}
      </section>

      {canReview && (
        <section className="card stack">
          <h2>Оставить отзыв</h2>
          <form className="stack" onSubmit={reviewForm.handleSubmit((v) => act.mutate({
            path: '/v1/reviews',
            body: {
              appointment_id: a.id,
              master_rating: v.master_rating,
              result_rating: v.result_rating,
              comment: v.comment ?? '',
              publish_allowed: Boolean(v.publish_allowed),
            },
          }))}>
            <div className="field">
              <label htmlFor="master_rating">Оценка мастера</label>
              <input id="master_rating" type="number" min={1} max={5} {...reviewForm.register('master_rating')} />
            </div>
            <div className="field">
              <label htmlFor="result_rating">Оценка результата</label>
              <input id="result_rating" type="number" min={1} max={5} {...reviewForm.register('result_rating')} />
            </div>
            <div className="field">
              <label htmlFor="comment">Комментарий</label>
              <textarea id="comment" {...reviewForm.register('comment')} />
            </div>
            <label className="row">
              <input type="checkbox" {...reviewForm.register('publish_allowed')} />
              <span>Разрешить публикацию на странице мастера</span>
            </label>
            <button className="btn btn-primary btn-block" type="submit" disabled={act.isPending}>Отправить отзыв</button>
          </form>
        </section>
      )}

      <section className="card stack">
        <h2>История статусов</h2>
        {history.isLoading && <div className="state-box">Загрузка…</div>}
        {history.isError && <div className="state-box">История пока недоступна</div>}
        {history.data && history.data.items.length === 0 && <div className="state-box">Пока нет изменений</div>}
        <div className="list">
          {history.data?.items.map((h, i) => (
            <div key={`${h.created_at}-${i}`} className="list-item">
              <strong>{statusLabel(h.to_status)}</strong>
              <p>{new Date(h.created_at).toLocaleString('ru-RU')}</p>
              {h.reason && <p>{h.reason}</p>}
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
