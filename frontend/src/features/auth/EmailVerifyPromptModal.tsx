import { useMutation } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { apiRequest } from '@/shared/api/client'
import { usePreference } from '@/shared/lib/preferences'
import { userError } from '@/shared/lib/app-error'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { Modal } from '@/shared/ui/Modal'

export const EMAIL_VERIFY_PROMPT_PREF_KEY = 'ui.email_verify_prompt'

export type EmailVerifyPromptPref = {
  status: 'pending' | 'dismissed'
  sent?: boolean
}

const DEFAULT_PROMPT: EmailVerifyPromptPref = { status: 'dismissed' }

/**
 * One-shot post-registration modal. Driven by server preference ui.email_verify_prompt
 * (set to pending on register). Survives reload; not shown on later logins after dismiss.
 */
export function EmailVerifyPromptModal() {
  const { user, accessToken } = useAuth()
  const [prompt, setPrompt] = usePreference<EmailVerifyPromptPref>(EMAIL_VERIFY_PROMPT_PREF_KEY, DEFAULT_PROMPT)

  const open =
    Boolean(user?.email) &&
    !user?.email_verified &&
    prompt.status === 'pending'

  const resend = useMutation({
    mutationFn: () =>
      apiRequest<{ message: string }>('/v1/auth/email-verification/request', {
        method: 'POST',
        token: accessToken,
        body: {},
      }),
    onSuccess: () => {
      setPrompt({ status: 'pending', sent: true })
    },
  })

  function dismiss() {
    setPrompt({ status: 'dismissed', sent: prompt.sent })
  }

  if (!user) return null

  return (
    <Modal
      open={open}
      onClose={dismiss}
      title="Подтверждение email"
      size="sm"
      className="email-verify-prompt-modal"
      footer={(
        <div className="row wrap gap" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="email-verify-prompt-resend"
            disabled={resend.isPending}
            onClick={() => resend.mutate()}
          >
            {resend.isPending ? 'Отправляем…' : 'Отправить ещё раз'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="email-verify-prompt-dismiss"
            onClick={dismiss}
          >
            Понятно
          </button>
        </div>
      )}
    >
      <div className="stack" data-testid="email-verify-prompt-modal">
        {prompt.sent ? (
          <p>
            Вам отправлено письмо для подтверждения электронной почты. Перейдите по ссылке в письме,
            чтобы подтвердить адрес.
          </p>
        ) : (
          <p>
            Не удалось автоматически отправить письмо для подтверждения {user.email}. Вы можете
            запросить письмо сейчас или позже в профиле — доступ к приложению не блокируется.
          </p>
        )}
        {resend.isSuccess && prompt.sent && (
          <div className="state-box success" role="status">Письмо отправлено</div>
        )}
        {resend.isError && (
          <ErrorBanner error={resend.error} fallbackTitle={userError(resend.error, 'Не удалось отправить письмо')} />
        )}
      </div>
    </Modal>
  )
}
