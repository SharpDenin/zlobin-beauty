import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { apiRequest } from '@/shared/api/client'
import { userError } from '@/shared/lib/app-error'
import { BrandLogo } from '@/shared/ui/BrandLogo'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'

const schema = z.object({
  password: z.string().min(8, 'Минимум 8 символов'),
  confirm: z.string().min(8, 'Минимум 8 символов'),
}).refine((v) => v.password === v.confirm, { message: 'Пароли не совпадают', path: ['confirm'] })

type Form = z.infer<typeof schema>

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting }, setFocus } = useForm<Form>({
    resolver: zodResolver(schema),
  })

  if (!token) {
    return (
      <div className="app-shell app-shell--auth">
        <div className="page page-narrow stack auth-screen">
          <BrandLogo size="lg" />
          <h1>Ссылка недействительна</h1>
          <p className="muted">Запросите восстановление пароля ещё раз.</p>
          <Link className="btn btn-primary" to="/forgot-password">Запросить ссылку</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell app-shell--auth">
      <div className="page page-narrow stack auth-screen" data-testid="reset-password-page">
        <BrandLogo size="lg" />
        <h1>Новый пароль</h1>
        <p className="auth-lead">Придумайте новый пароль для входа в Salon-X.</p>
        {done ? (
          <div className="card stack" role="status">
            <p>Пароль обновлён. Войдите с новым паролем. Другие устройства вышли из аккаунта.</p>
            <Link className="btn btn-primary" to="/login" data-testid="reset-go-login">Войти</Link>
          </div>
        ) : (
          <form
            className="card stack"
            onSubmit={handleSubmit(async (values) => {
              setError(null)
              try {
                await apiRequest<{ message: string }>('/v1/auth/password-reset/confirm', {
                  method: 'POST',
                  body: { token, new_password: values.password },
                  skipAuthRefresh: true,
                })
                setDone(true)
              } catch (e) {
                setError(userError(e, 'Не удалось обновить пароль. Ссылка могла истечь.'))
                setFocus('password')
              }
            })}
          >
            <div className="field">
              <label htmlFor="password">Новый пароль</label>
              <input id="password" type="password" autoComplete="new-password" aria-required="true" {...register('password')} />
              {errors.password && <span className="error">{errors.password.message}</span>}
            </div>
            <div className="field">
              <label htmlFor="confirm">Повтор пароля</label>
              <input id="confirm" type="password" autoComplete="new-password" aria-required="true" {...register('confirm')} />
              {errors.confirm && <span className="error">{errors.confirm.message}</span>}
            </div>
            {error && <ErrorBanner error={error} />}
            <button className={`btn btn-primary btn-block${isSubmitting ? ' btn-loading' : ''}`} disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Сохраняем…' : 'Сохранить пароль'}
            </button>
          </form>
        )}
        <p><Link to="/login">Ко входу</Link></p>
      </div>
    </div>
  )
}
