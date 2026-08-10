import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'

type Article = {
  id: string
  title: string
  category: string
  author_name: string
  created_at: string
}

export function KnowledgeListPage() {
  const { accessToken } = useAuth()
  const [category, setCategory] = useState('')
  const [submitted, setSubmitted] = useState('')

  const query = useQuery({
    queryKey: ['knowledge', submitted],
    queryFn: () => {
      const qs = submitted ? `?category=${encodeURIComponent(submitted)}` : ''
      return apiRequest<{ items: Article[] }>(`/v1/knowledge${qs}`, { token: accessToken })
    },
    enabled: Boolean(accessToken),
  })

  return (
    <main className="page stack">
      <h1>База знаний</h1>
      <form
        className="card search-form"
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitted(category.trim())
        }}
      >
        <div className="field">
          <label htmlFor="category">Категория</label>
          <input
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Например: техники, материалы"
          />
        </div>
        <button className="btn btn-primary" type="submit">Фильтровать</button>
        {submitted && (
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => {
              setCategory('')
              setSubmitted('')
            }}
          >
            Сбросить
          </button>
        )}
      </form>

      {query.isLoading && <div className="state-box">Загрузка…</div>}
      {query.isError && <div className="state-box error">Не удалось загрузить статьи</div>}
      {query.data && query.data.items.length === 0 && (
        <div className="state-box">Статей пока нет</div>
      )}
      <div className="list">
        {query.data?.items.map((a) => (
          <Link key={a.id} to={`/knowledge/${a.id}`} className="list-item">
            <div className="row between">
              <strong>{a.title}</strong>
              {a.category && <span className="badge badge-default">{a.category}</span>}
            </div>
            <p className="muted">
              {a.author_name || 'Автор не указан'}
              {' · '}
              {new Date(a.created_at).toLocaleDateString('ru-RU')}
            </p>
          </Link>
        ))}
      </div>
    </main>
  )
}
