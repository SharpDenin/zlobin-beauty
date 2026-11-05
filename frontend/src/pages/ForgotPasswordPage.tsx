import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { apiRequest } from '@/shared/api/client'
import { userError } from '@/shared/lib/app-error'
import { BrandLogo } from '@/shared/ui/BrandLogo'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'

const schema = z.object({
  email: z.string().email('Введите корректный email'),
})

type Form = z.infer<typeof schema>

export function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting }, setFocus } = useForm<Form>({
    resolver: zodResolver(schema),
  })

  return (
    <div className="app-shell app-shell--auth">
      <div className="page page-narrow stack auth-screen" data-testid="forgot-password-page">
        <BrandLogo size="lg" />
        <h1>Восстановление пароля</h1>
        <p className="auth-lead">Укажите email аккаунта — мы отправим ссылку, если он зарегистрирован.</p>
        {done ? (
          <div className="card stack" role="status">
            <p>Если аккаунт с таким email существует, мы отправили инструкции по восстановлению пароля.</p>
            <p className="muted">Проверьте почту и папку «Спам». Ссылка действует ограниченное время.</p>
            <Link className="btn btn-primary" to="/login">Ко входу</Link>
          </div>
        ) : (
          <form
            className="card stack"
            onSubmit={handleSubmit(async (values) => {
              setError(null)
              try {
                await apiRequest<{ message: string }>('/v1/auth/password-reset/request', {
                  method: 'POST',
                  body: { email: values.email },
                  skipAuthRefresh: true,
                })
                setDone(true)
              } catch (e) {
                setError(userError(e, 'Не удалось отправить запрос'))
                setFocus('email')
              }
            }, () => setFocus('email'))}
          >
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="email" inputMode="email" aria-required="true" {...register('email')} />
              {errors.email && <span className="error">{errors.email.message}</span>}
            </div>
            {error && <ErrorBanner error={error} />}
            <button className={`btn btn-primary btn-block${isSubmitting ? ' btn-loading' : ''}`} disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Отправляем…' : 'Отправить ссылку'}
            </button>
          </form>
        )}
        <p><Link to="/login">← Назад ко входу</Link></p>
      </div>
    </div>
  )
}
