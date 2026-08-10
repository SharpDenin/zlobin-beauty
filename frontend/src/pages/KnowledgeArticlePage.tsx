import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'

type Article = {
  id: string
  title: string
  category: string
  content: string
  author_name: string
  created_at: string
}

export function KnowledgeArticlePage() {
  const { id } = useParams()
  const { accessToken } = useAuth()

  const query = useQuery({
    queryKey: ['knowledge', id],
    queryFn: () => apiRequest<Article>(`/v1/knowledge/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
  })

  if (query.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (query.isError || !query.data) {
    return (
      <main className="page stack">
        <div className="state-box error">Статья не найдена</div>
        <Link className="btn btn-secondary" to="/knowledge">К списку</Link>
      </main>
    )
  }

  const a = query.data

  return (
    <main className="page stack">
      <Link className="btn btn-secondary btn-compact" to="/knowledge">← К списку</Link>
      <h1>{a.title}</h1>
      <p className="muted">
        {a.category && <span className="badge badge-default">{a.category}</span>}
        {' '}
        {a.author_name || 'Автор не указан'}
        {' · '}
        {new Date(a.created_at).toLocaleDateString('ru-RU')}
      </p>
      <section className="card">
        <div style={{ whiteSpace: 'pre-wrap' }}>{a.content}</div>
      </section>
    </main>
  )
}
