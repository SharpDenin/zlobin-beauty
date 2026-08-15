import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg } from '@/shared/lib/commerce'
import { statusBadgeClass } from '@/shared/lib/status'

type Agreement = {
  id: string
  status: string
  frequency: string
  start_date: string
}

export function RecurringPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const { supplierOrgId, orgs } = useSupplierOrg()

  const list = useQuery({
    queryKey: ['recurring', supplierOrgId],
    queryFn: () =>
      apiRequest<{ items: Agreement[] }>(
        `/v1/commerce/recurring?organization_id=${supplierOrgId}&role=supplier`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && supplierOrgId),
  })

  const decide = useMutation({
    mutationFn: (input: { id: string; action: 'approve' | 'reject' }) =>
      apiRequest(`/v1/commerce/recurring/${input.id}/decide`, {
        token: accessToken,
        body: { action: input.action },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['recurring'] })
    },
  })

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>

  return (
    <main className="page stack">
      <h1>Регулярные поставки</h1>
      <p className="muted">Заявки салонов. После одобрения создаются заказы на ближайший горизонт, не бесконечно.</p>
      {decide.isError && <div className="state-box error">{decide.error instanceof ApiError ? decide.error.message : 'Ошибка'}</div>}
      {(list.data?.items ?? []).length === 0 && <div className="empty-state"><h2>Заявок нет</h2></div>}
      <div className="list">
        {(list.data?.items ?? []).map((a) => (
          <article key={a.id} className="list-item stack-sm">
            <div className="row between">
              <strong>{a.frequency === 'weekly' ? 'Еженедельно' : a.frequency === 'monthly' ? 'Ежемесячно' : 'Раз в две недели'}</strong>
              <span className={`badge ${statusBadgeClass(a.status)}`}>
                {a.status === 'pending' ? 'Ожидает' : a.status === 'active' ? 'Активно' : a.status === 'paused' ? 'Пауза' : a.status}
              </span>
            </div>
            <p className="muted">Старт {a.start_date}</p>
            {a.status === 'pending' && (
              <div className="row">
                <button className="btn btn-primary btn-compact" type="button" onClick={() => decide.mutate({ id: a.id, action: 'approve' })}>Одобрить</button>
                <button className="btn btn-secondary btn-compact" type="button" onClick={() => decide.mutate({ id: a.id, action: 'reject' })}>Отклонить</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </main>
  )
}
