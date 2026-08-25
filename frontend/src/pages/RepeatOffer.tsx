import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest, ApiError } from '@/shared/api/client'
import {
  formatRequirementLine,
  overallRepeatMessage,
  requirementStatusLabel,
  soonestIncomingDate,
  type RepeatPreview,
} from '@/pages/repeat-helpers'

export function RepeatOffer({
  clientUserId,
  token,
}: {
  clientUserId: string
  token: string | null
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [startsAt, setStartsAt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const options = useQuery({
    queryKey: ['repeat-options', clientUserId],
    queryFn: () =>
      apiRequest<{ item: RepeatPreview | null }>(`/v1/me/clients/${clientUserId}/repeat-options`, { token }),
    enabled: Boolean(token && clientUserId),
    retry: false,
  })

  const preview = options.data?.item
  const master = useQuery({
    queryKey: ['me-master'],
    queryFn: () =>
      apiRequest<{ master: { id: string; user_id?: string }; services?: Array<{ id: string; duration_minutes?: number }> }>(
        '/v1/me/master',
        { token },
      ),
    enabled: Boolean(token && preview),
  })

  const create = useMutation({
    mutationFn: () =>
      apiRequest('/v1/appointments', {
        token,
        body: {
          master_id: master.data?.master.id,
          service_id: preview?.service_id,
          client_user_id: clientUserId,
          starts_at: new Date(startsAt).toISOString(),
        },
      }),
    onSuccess: async () => {
      setOk('Запись создана. Склад не списан — расход будет при завершении визита.')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['appointments'] })
      await qc.invalidateQueries({ queryKey: ['calendar-appointments'] })
    },
    onError: (e) => {
      setOk(null)
      setError(e instanceof ApiError ? e.message : 'Не удалось создать запись')
    },
  })

  const incomingDate = useMemo(() => (preview ? soonestIncomingDate(preview.requirements) : null), [preview])

  if (options.isLoading || options.isError) return null
  if (!preview) return null

  const statusClass = preview.can_repeat ? 'badge-success' : preview.availability_status === 'incoming' ? 'badge-warning' : 'badge-danger'

  return (
    <section className="card stack" data-testid="repeat-offer">
      <div className="row between">
        <h2>Как в прошлый раз</h2>
        <span className={`badge ${statusClass}`}>{requirementStatusLabel(preview.availability_status || (preview.can_repeat ? 'available' : 'shortage'))}</span>
      </div>
      <p><strong>{preview.service}</strong></p>
      <p className="muted">Последний раз: {new Date(preview.date).toLocaleDateString('ru-RU')}</p>
      {preview.technique && !preview.scheme_hidden && <p className="muted">{preview.technique}</p>}
      <p data-testid="repeat-summary">{overallRepeatMessage(preview)}</p>

      {!open ? (
        <button className="btn btn-secondary btn-compact" type="button" data-testid="repeat-open-preview" onClick={() => setOpen(true)}>
          Посмотреть детали
        </button>
      ) : (
        <div className="stack" data-testid="repeat-preview">
          {preview.formula_hidden && (
            <p className="muted" data-testid="repeat-formula-hidden">{preview.hidden_reason}</p>
          )}
          {!preview.formula_hidden && (preview.components?.length ?? 0) > 0 && (
            <ul className="list">
              {preview.components!.map((c, i) => (
                <li key={`${c.name}-${i}`} className="muted">{[c.brand, c.name, c.qty, c.unit].filter(Boolean).join(' ')}</li>
              ))}
            </ul>
          )}
          <div className="list">
            {preview.requirements.map((r) => (
              <article key={r.product_id} className="history-card" data-testid="repeat-requirement">
                <div className="row between">
                  <strong>{formatRequirementLine(r)}</strong>
                  <span className={`badge ${r.status === 'available' ? 'badge-success' : r.status === 'incoming' ? 'badge-warning' : 'badge-danger'}`}>
                    {r.status === 'available' ? '✓' : '⚠'} {requirementStatusLabel(r.status)}
                  </span>
                </div>
                {r.incoming_qty > 0 && (
                  <p className="muted">В поставке: {r.incoming_qty}{r.unit ? ` ${r.unit}` : ''} · не на складе</p>
                )}
              </article>
            ))}
          </div>
          {incomingDate && (
            <p className="muted" data-testid="repeat-incoming-date">Ожидается поставка: {new Date(incomingDate).toLocaleDateString('ru-RU')}</p>
          )}
          {!preview.can_repeat && preview.availability_status !== 'incoming' && (
            <p className="muted">Запись можно создать, но материалов сейчас не хватает.</p>
          )}
          {error && <div className="state-box error">{error}</div>}
          {ok && <div className="state-box success" data-testid="repeat-created">{ok}</div>}
          <div className="field">
            <label htmlFor="repeat-starts">Дата и время новой записи</label>
            <input id="repeat-starts" data-testid="repeat-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div className="row">
            <button
              className="btn btn-primary"
              type="button"
              data-testid="repeat-use"
              disabled={create.isPending || !startsAt || !master.data?.master.id}
              onClick={() => create.mutate()}
            >
              Использовать как в прошлый раз
            </button>
            <button className="btn btn-secondary" type="button" data-testid="repeat-change" onClick={() => setOpen(false)}>
              Изменить
            </button>
          </div>
          <p className="muted">Подтверждение создаёт обычную запись. История прошлого визита не меняется.</p>
        </div>
      )}
    </section>
  )
}
