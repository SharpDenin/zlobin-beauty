import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { BrandLogo } from '@/shared/ui/BrandLogo'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { PageLoading } from '@/shared/ui/PageLoading'
import { ThemeToggle } from '@/shared/ui/ThemeToggle'

type Peek = { organization_id: string; organization_name: string; role: string; expires_at: string }

export function InvitePage() {
  const { token = '' } = useParams()
  const { user, accessToken, loading } = useAuth()
  const navigate = useNavigate()

  const peek = useQuery({
    queryKey: ['invite-peek', token],
    queryFn: () => apiRequest<Peek>(`/v1/invites/${encodeURIComponent(token)}`),
    enabled: Boolean(token),
    retry: false,
  })

  const accept = useMutation({
    mutationFn: () =>
      apiRequest<Peek>(`/v1/invites/${encodeURIComponent(token)}/accept`, { method: 'POST', token: accessToken }),
    onSuccess: () => navigate('/master', { replace: true }),
  })

  if (loading) return <PageLoading />

  return (
    <div className="app-shell app-shell--auth">
      <div className="page page-narrow stack auth-screen">
        <div className="auth-theme-bar"><ThemeToggle labelled /></div>
        <BrandLogo size="md" />
        <h1>Приглашение в салон</h1>
        {peek.isLoading && <div className="state-box">Проверяем приглашение…</div>}
        {peek.isError && <ErrorBanner error={peek.error} fallbackTitle="Приглашение недоступно" />}
        {peek.data && (
          <section className="card stack">
            <p>
              Салон <strong>{peek.data.organization_name}</strong>
              {' · '}
              роль: {peek.data.role === 'admin' ? 'администратор' : 'мастер'}
            </p>
            {!user ? (
              <>
                <p className="muted">Создайте аккаунт мастера или войдите, чтобы присоединиться.</p>
                <Link className="btn btn-primary btn-block" to={`/register?invite=${encodeURIComponent(token)}`}>Зарегистрироваться</Link>
                <Link className="btn btn-secondary btn-block" to={`/login?next=/invite/${encodeURIComponent(token)}`}>Войти</Link>
              </>
            ) : (
              <>
                {accept.isError && <ErrorBanner error={accept.error} />}
                <button
                  className="btn btn-primary btn-block"
                  type="button"
                  disabled={accept.isPending}
                  onClick={() => accept.mutate()}
                >
                  {accept.isPending ? 'Присоединяем…' : 'Присоединиться к салону'}
                </button>
              </>
            )}
          </section>
        )}
        <p><Link to="/">На главную</Link></p>
      </div>
    </div>
  )
}
