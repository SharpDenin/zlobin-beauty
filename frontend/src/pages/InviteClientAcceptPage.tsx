import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { BrandLogo } from '@/shared/ui/BrandLogo'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { PageLoading } from '@/shared/ui/PageLoading'

type Peek = {
  master_user_id: string
  master_name: string
  organization_id?: string
  expires_at: string
}

export function InviteClientAcceptPage() {
  const { token = '' } = useParams()
  const { user, accessToken, loading } = useAuth()
  const navigate = useNavigate()

  const peek = useQuery({
    queryKey: ['client-invite-peek', token],
    queryFn: () => apiRequest<Peek>(`/v1/clients/invite/${encodeURIComponent(token)}`),
    enabled: Boolean(token),
    retry: false,
  })

  const accept = useMutation({
    mutationFn: () =>
      apiRequest<Peek>(`/v1/clients/invite/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        token: accessToken,
        body: { display_name: user?.display_name || 'Клиент' },
      }),
    onSuccess: () => navigate('/contacts', { replace: true }),
  })

  if (loading) return <PageLoading />

  return (
    <div className="app-shell app-shell--auth">
      <div className="page page-narrow stack auth-screen" data-testid="invite-client-accept">
        <BrandLogo size="md" />
        <h1>Приглашение от мастера</h1>
        {peek.isLoading && <div className="state-box">Проверяем приглашение…</div>}
        {peek.isError && <ErrorBanner error={peek.error} fallbackTitle="Приглашение недоступно" />}
        {peek.data && (
          <section className="card stack">
            <p>
              Мастер <strong>{peek.data.master_name}</strong> приглашает вас связаться в Salon-X.
            </p>
            <p className="muted">
              После подтверждения вы появитесь в контактах друг у друга. Данные карточки клиента не открываются
              посторонним — нужна ваша авторизация и явное согласие.
            </p>
            <p className="muted">Действует до {new Date(peek.data.expires_at).toLocaleString('ru-RU')}</p>
            {!user ? (
              <>
                <Link
                  className="btn btn-primary btn-block"
                  to={`/register?next=${encodeURIComponent(`/invite/client/${token}`)}`}
                >
                  Зарегистрироваться
                </Link>
                <Link
                  className="btn btn-secondary btn-block"
                  to={`/login?next=${encodeURIComponent(`/invite/client/${token}`)}`}
                >
                  Войти
                </Link>
              </>
            ) : (
              <>
                {accept.isError && <ErrorBanner error={accept.error} />}
                <button
                  className={`btn btn-primary btn-block${accept.isPending ? ' btn-loading' : ''}`}
                  type="button"
                  data-testid="invite-client-accept-btn"
                  disabled={accept.isPending}
                  onClick={() => accept.mutate()}
                >
                  {accept.isPending ? 'Подтверждаем…' : 'Подтвердить связь'}
                </button>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
