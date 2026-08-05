import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { apiRequest } from '@/shared/api/client'

type Master = {
  id: string
  user_id: string
  display_name: string
  city: string
  specializations: string[]
  rating_avg: number
  rating_count: number
}

export function SearchPage() {
  const [city, setCity] = useState('Москва')
  const [q, setQ] = useState('')
  const [submitted, setSubmitted] = useState({ city: 'Москва', q: '' })

  const query = useQuery({
    queryKey: ['masters', submitted],
    queryFn: () => apiRequest<{ items: Master[] }>(`/v1/masters?city=${encodeURIComponent(submitted.city)}&q=${encodeURIComponent(submitted.q)}`),
  })

  return (
    <main className="page stack">
      <h1>Поиск мастеров</h1>
      <form
        className="card search-form"
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitted({ city: city.trim() || 'Москва', q: q.trim() })
        }}
      >
        <div className="field">
          <label htmlFor="city">Город</label>
          <input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="q">Имя или специализация</label>
          <input id="q" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn btn-primary" type="submit">Искать</button>
      </form>

      {query.isLoading && <div className="state-box">Ищем мастеров…</div>}
      {query.isError && <div className="state-box error">Не удалось загрузить список</div>}
      {query.data && query.data.items.length === 0 && (
        <div className="state-box">Пока нет опубликованных мастеров в этом городе</div>
      )}
      <div className="list">
        {query.data?.items.map((m) => (
          <Link key={m.id} to={`/masters/${m.id}`} className="list-item">
            <div className="row between">
              <strong>{m.display_name}</strong>
              <span className="badge badge-default">{m.city}</span>
            </div>
            <p>{m.specializations.join(', ') || 'Без специализаций'}</p>
            <p>Рейтинг {m.rating_avg.toFixed(1)} · {m.rating_count} отзывов</p>
          </Link>
        ))}
      </div>
    </main>
  )
}
