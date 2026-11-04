import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { SearchField } from '@/shared/ui/SearchField'
import { apiRequest } from '@/shared/api/client'
import { useAuth, hasMasterAccess } from '@/features/auth/AuthProvider'

type ClientRow = {
  id: string
  display_name: string
  phone: string | null
  email: string | null
  contacts_hidden?: boolean
  segment: string
  visit_count: number
  last_visit_at: string | null
}

const segmentLabel: Record<string, string> = {
  new: 'Новые',
  active: 'Активные',
  lapsed: 'Давно не были',
  unknown: 'Без визитов',
}

function matchesClientQuery(c: ClientRow, q: string) {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = [c.display_name, c.phone ?? '', c.email ?? ''].join(' ').toLowerCase()
  return hay.includes(needle)
}

export function ClientsPage() {
  const { accessToken, user } = useAuth()
  const [segment, setSegment] = useState('')
  const [q, setQ] = useState('')
  const isMaster = hasMasterAccess(user)

  const clients = useQuery({
    queryKey: ['clients-mine', segment],
    queryFn: () => {
      const qs = segment ? `?segment=${encodeURIComponent(segment)}` : ''
      return apiRequest<{ items: ClientRow[] }>(`/v1/clients/mine${qs}`, { token: accessToken })
    },
    enabled: Boolean(accessToken && isMaster),
  })

  const filtered = useMemo(
    () => (clients.data?.items ?? []).filter((c) => matchesClientQuery(c, q)),
    [clients.data?.items, q],
  )

  if (!isMaster) {
    return (
      <main className="page">
        <div className="state-box">Список клиентов доступен мастерам и владельцам салона</div>
      </main>
    )
  }

  return (
    <main className="page stack">
      <h1>Клиенты</h1>
      <p className="muted">
        Сегменты по визитам: новые (первый визит ≤ 30 дн.), активные (последний ≤ 90 дн.), давно не были (&gt; 90 дн.).
      </p>
      <SearchField
        value={q}
        onChange={setQ}
        placeholder="Имя, телефон или email"
        aria-label="Поиск клиентов"
        clearable
        data-testid="clients-search"
      />
      <div className="row wrap">
        {[
          { value: '', label: 'Все' },
          { value: 'new', label: 'Новые' },
          { value: 'active', label: 'Активные' },
          { value: 'lapsed', label: 'Давно не были' },
        ].map((t) => (
          <button
            key={t.value || 'all'}
            type="button"
            className={`btn ${segment === t.value ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSegment(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {clients.isLoading && <div className="state-box">Загрузка…</div>}
      {clients.isError && <ErrorBanner error={clients.error} fallbackTitle="Не удалось загрузить клиентов" />}
      {clients.data && filtered.length === 0 && (
        <div className="state-box">
          {q.trim()
            ? 'Никого не нашли по этому запросу'
            : 'Клиентов пока нет — они появляются после завершённых визитов'}
        </div>
      )}
      <div className="list">
        {filtered.map((c) => (
          <article key={c.id} className="list-item">
            <div className="row between">
              <strong>{c.display_name}</strong>
              <span className="badge badge-default">{segmentLabel[c.segment] ?? c.segment}</span>
            </div>
            <p className="muted">
              Визитов: {c.visit_count}
              {c.last_visit_at ? ` · последний ${new Date(c.last_visit_at).toLocaleDateString('ru-RU')}` : ''}
              {c.contacts_hidden ? ' · контакты скрыты' : c.phone ? ` · ${c.phone}` : ''}
            </p>
            <Link className="btn btn-secondary btn-compact" to={`/clients/${c.id}`}>Карточка</Link>
          </article>
        ))}
      </div>
    </main>
  )
}
