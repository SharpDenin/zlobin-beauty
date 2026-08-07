import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { clientOrderLabel, statusBadgeClass } from '@/shared/lib/status'

type OrgItem = {
  organization: { id: string; name: string }
}

type Delivery = {
  id: string
  status: string
  total_minor: number
  delivery_address: string
  delivery_comment: string
  user_id: string
  items: Array<{ product_id: string; product_name: string; brand: string; qty: number; qty_delivered: number; price_minor: number }>
}

export function RepPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [collected, setCollected] = useState('')
  const [paymentReceived, setPaymentReceived] = useState(false)

  const orgs = useQuery({
    queryKey: ['orgs-mine'],
    queryFn: () => apiRequest<{ items: OrgItem[] }>('/v1/organizations/mine', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const orgId = orgs.data?.items[0]?.organization.id

  const deliveries = useQuery({
    queryKey: ['rep-deliveries', orgId],
    queryFn: () =>
      apiRequest<{ items: Delivery[] }>(
        `/v1/commerce/rep/deliveries?organization_id=${orgId}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && orgId),
  })

  const complete = useMutation({
    mutationFn: (order: Delivery) =>
      apiRequest(`/v1/commerce/rep/deliveries/${order.id}/complete`, {
        token: accessToken,
        body: {
          items: order.items.map((it) => ({
            product_id: it.product_id,
            qty_delivered: it.qty,
          })),
          note: note.trim(),
          amount_collected_minor: Math.round((Number(collected) || 0) * 100),
          payment_received: paymentReceived,
        },
      }),
    onSuccess: async () => {
      setOk('Доставка подтверждена. Задолженность пересчитана на сервере.')
      setError(null)
      setActiveId(null)
      setNote('')
      setCollected('')
      setPaymentReceived(false)
      await qc.invalidateQueries({ queryKey: ['rep-deliveries'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка доставки'),
  })

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!orgId) {
    return (
      <main className="page">
        <div className="state-box">
          Нужна организация, где вы представитель или владелец. Создайте её в <Link to="/master">кабинете</Link>.
        </div>
      </main>
    )
  }

  const pending = (deliveries.data?.items ?? []).filter((d) => d.status === 'in_delivery')
  const done = (deliveries.data?.items ?? []).filter((d) => d.status === 'delivered')

  return (
    <main className="page stack">
      <h1>Доставки</h1>
      <p>Маршрут — упорядоченный список адресов. Карта появится после подключения картографической службы.</p>
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      <section className="card stack">
        <h2>Сегодня / в пути</h2>
        {deliveries.isLoading && <div className="state-box">Загрузка…</div>}
        {deliveries.isError && (
          <div className="state-box error">
            Не удалось загрузить доставки. Нужна роль rep или owner/admin в организации поставщика.
          </div>
        )}
        {!deliveries.isLoading && pending.length === 0 && (
          <div className="state-box">Нет назначенных доставок в статусе «в доставке»</div>
        )}
        <ol className="list" style={{ listStyle: 'decimal', paddingLeft: 20 }}>
          {pending.map((d) => (
            <li key={d.id} className="list-item" style={{ listStyle: 'inherit' }}>
              <div className="row between">
                <strong>{d.delivery_address || 'Адрес не указан'}</strong>
                <span className={`badge ${statusBadgeClass(d.status)}`}>{clientOrderLabel(d.status)}</span>
              </div>
              <p>{formatMoney(d.total_minor)} · позиций {d.items?.length ?? 0}</p>
              {d.delivery_comment && <p className="muted">{d.delivery_comment}</p>}
              <button className="btn btn-primary btn-compact" type="button" onClick={() => setActiveId(d.id)}>
                Подтвердить доставку
              </button>
              {activeId === d.id && (
                <div className="stack" style={{ marginTop: 12 }}>
                  <div className="list">
                    {d.items.map((it) => (
                      <div key={it.product_id} className="muted">
                        {it.brand} {it.product_name} × {it.qty} · {formatMoney(it.price_minor)}
                      </div>
                    ))}
                  </div>
                  <div className="field">
                    <label>Комментарий / фото-заметка</label>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Получил клиент, без повреждений" />
                  </div>
                  <div className="field">
                    <label>Получено, ₽</label>
                    <input type="number" value={collected} onChange={(e) => setCollected(e.target.value)} />
                  </div>
                  <label className="row">
                    <input type="checkbox" checked={paymentReceived} onChange={(e) => setPaymentReceived(e.target.checked)} />
                    <span>Оплата получена (уменьшает задолженность)</span>
                  </label>
                  <div className="row">
                    <button className="btn btn-primary" type="button" disabled={complete.isPending} onClick={() => complete.mutate(d)}>
                      Завершить доставку
                    </button>
                    <button className="btn btn-secondary" type="button" onClick={() => setActiveId(null)}>Отмена</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="card stack">
        <h2>Завершённые</h2>
        {done.length === 0 && <div className="state-box">Пока нет завершённых доставок</div>}
        <div className="list">
          {done.map((d) => (
            <article key={d.id} className="list-item">
              <div className="row between">
                <strong>{d.delivery_address || '—'}</strong>
                <span className={`badge ${statusBadgeClass(d.status)}`}>{clientOrderLabel(d.status)}</span>
              </div>
              <p>{formatMoney(d.total_minor)}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
