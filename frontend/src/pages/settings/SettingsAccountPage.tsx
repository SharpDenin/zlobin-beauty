import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { ApiError, apiRequest } from '@/shared/api/client'
import { userError } from '@/shared/lib/app-error'
import { disableDevicePush } from '@/features/pwa/push'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { Modal } from '@/shared/ui/Modal'

function ownedOrgMessage(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.code !== 'account_owned_organizations') return null
  const orgs = err.details?.organizations
  if (Array.isArray(orgs) && orgs.length > 0) {
    const names = orgs.map((o) => String(o)).filter(Boolean).join(', ')
    return `Нельзя удалить аккаунт, пока вы владелец организации: ${names}. Передайте владение или закройте салон, затем повторите.`
  }
  return 'Нельзя удалить аккаунт, пока вы владелец организации. Передайте владение или закройте салон, затем повторите.'
}

function alreadyDeletedMessage(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.code !== 'account_already_deleted') return null
  return 'Аккаунт уже удалён. Войдите с другим аккаунтом или зарегистрируйтесь заново.'
}

function cleanupFailedMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null
  if (err.status !== 503 && err.code !== 'conflict') return null
  const msg = (err.technicalMessage || err.message || '').toLowerCase()
  if (!msg.includes('temporarily unavailable') && !msg.includes('retry later')) return null
  return 'Сейчас нельзя завершить удаление: недоступен один из сервисов. Повторите попытку через минуту — аккаунт ещё не удалён.'
}

export function SettingsAccountPage() {
  const { accessToken, logout } = useAuth()
  const navigate = useNavigate()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  function openConfirm() {
    setError(null)
    setPassword('')
    setConfirmOpen(true)
  }

  function closeConfirm() {
    if (busy) return
    setConfirmOpen(false)
    setPassword('')
    setError(null)
  }

  async function submitDelete() {
    if (!accessToken || busy) return
    const pwd = password.trim()
    if (!pwd) {
      setError('Введите пароль для подтверждения')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await apiRequest('/v1/auth/account', {
        method: 'DELETE',
        token: accessToken,
        body: { password: pwd },
        skipAuthRefresh: true,
      })
      try {
        await disableDevicePush(accessToken)
      } catch {
        /* server already wiped push; local unsubscribe is best-effort */
      }
      setConfirmOpen(false)
      await logout()
      navigate('/login', { replace: true })
    } catch (err) {
      setError(ownedOrgMessage(err) ?? alreadyDeletedMessage(err) ?? cleanupFailedMessage(err) ?? err)
      setBusy(false)
    }
  }

  return (
    <div className="stack" data-testid="settings-account-page">
      <section className="card stack" data-testid="settings-account-danger">
        <h2 className="text-danger" style={{ color: 'var(--color-danger)', margin: 0 }}>Удаление аккаунта</h2>
        <p className="muted">
          Удаление необратимо: вы потеряете доступ к Salon-X. История записей, заказов и сообщений салонов
          сохраняется в обезличенном виде. Действующие сессии и push-уведомления будут отозваны.
        </p>
        <p className="muted">
          Если вы владелец салона, сначала передайте владение другому администратору или закройте организацию.
        </p>
        <button
          type="button"
          className="btn btn-danger"
          data-testid="settings-account-delete-open"
          onClick={openConfirm}
        >
          Удалить аккаунт
        </button>
      </section>

      <Modal
        open={confirmOpen}
        onClose={closeConfirm}
        title="Подтвердите удаление"
        size="sm"
        closeOnBackdrop={!busy}
        closeOnEscape={!busy}
        className="settings-account-delete-modal"
        footer={(
          <div className="row wrap gap" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={closeConfirm}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn-danger"
              data-testid="settings-account-delete-confirm"
              disabled={busy || !password.trim()}
              onClick={() => void submitDelete()}
            >
              {busy ? 'Удаляем…' : 'Удалить навсегда'}
            </button>
          </div>
        )}
      >
        <div className="stack">
          <p>
            Это действие нельзя отменить. Для подтверждения введите пароль аккаунта.
          </p>
          <label className="field">
            <span>Пароль</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              data-testid="settings-account-delete-password"
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitDelete()
              }}
            />
          </label>
          {typeof error === 'string' ? (
            <ErrorBanner error={error} />
          ) : error ? (
            <ErrorBanner error={error} fallbackTitle={userError(error, 'Не удалось удалить аккаунт')} />
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
