import { Link, useSearchParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { apiRequest } from '@/shared/api/client'
import { userError } from '@/shared/lib/app-error'
import { useAuth } from '@/features/auth/AuthProvider'
import { BrandLogo } from '@/shared/ui/BrandLogo'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { accessToken, user, updateUser } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(Boolean(token))

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        await apiRequest<{ message: string }>('/v1/auth/email-verification/confirm', {
          method: 'POST',
          body: { token },
          skipAuthRefresh: true,
        })
        if (cancelled) return
        setDone(true)
        if (accessToken && user) {
          try {
            const me = await apiRequest<typeof user & { email_verified?: boolean }>('/v1/auth/me', { token: accessToken })
            updateUser({ ...me, email_verified: me.email_verified ?? true } as typeof user)
          } catch {
            /* profile refresh is best-effort */
          }
        }
      } catch (e) {
        if (!cancelled) setError(userError(e, 'Не удалось подтвердить email. Ссылка могла истечь.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="app-shell app-shell--auth">
      <div className="page page-narrow stack auth-screen" data-testid="verify-email-page">
        <BrandLogo size="lg" />
        <h1>Подтверждение email</h1>
        {loading && <p className="muted">Проверяем ссылку…</p>}
        {!token && !loading && (
          <>
            <p className="muted">Откройте ссылку из письма или запросите новое подтверждение в профиле.</p>
            <Link className="btn btn-primary" to="/profile">В профиль</Link>
          </>
        )}
        {done && (
          <div className="card stack" role="status">
            <p>Email подтверждён.</p>
            <Link className="btn btn-primary" to={accessToken ? '/profile' : '/login'}>
              {accessToken ? 'В профиль' : 'Войти'}
            </Link>
          </div>
        )}
        {error && <ErrorBanner error={error} />}
        {error && <Link className="btn btn-secondary" to="/profile">В профиль</Link>}
      </div>
    </div>
  )
}
