import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { homePathForUser, useAuth } from '@/features/auth/AuthProvider'
import { userError } from '@/shared/lib/app-error'
import { BrandLogo } from '@/shared/ui/BrandLogo'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'

const schema = z.object({
  email: z.string().email('Введите корректный email'),
  password: z.string().min(8, 'Минимум 8 символов'),
})

type Form = z.infer<typeof schema>

export function LoginPage({ redirectTo }: { redirectTo?: string }) {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting }, setFocus } = useForm<Form>({
    resolver: zodResolver(schema),
  })

  return (
    <div className="app-shell app-shell--auth">
      <div className="page page-narrow stack auth-screen">
        <BrandLogo size="lg" />
        <h1>Вход</h1>
        <p className="auth-lead">Записи, мастера и салон — в одном кабинете.</p>
        <form
          className="card stack"
          onSubmit={handleSubmit(async (values) => {
            setError(null)
            try {
              const user = await login(values.email, values.password)
              const fallback = homePathForUser(user)
              const target = redirectTo && redirectTo !== '/' ? redirectTo : fallback
              navigate(target)
            } catch (e) {
              setError(userError(e, 'Не удалось войти'))
              setFocus('email')
            }
          }, () => setFocus(errors.email ? 'email' : 'password'))}
        >
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" aria-invalid={Boolean(errors.email)} {...register('email')} />
            {errors.email && <span className="error">{errors.email.message}</span>}
          </div>
          <div className="field">
            <label htmlFor="password">Пароль</label>
            <input id="password" type="password" autoComplete="current-password" aria-invalid={Boolean(errors.password)} {...register('password')} />
            {errors.password && <span className="error">{errors.password.message}</span>}
          </div>
          {error && <ErrorBanner error={error} />}
          <button className={`btn btn-primary btn-block${isSubmitting ? ' btn-loading' : ''}`} disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Входим…' : 'Войти'}
          </button>
        </form>
        <p>Нет аккаунта? <Link to="/register">Зарегистрироваться</Link></p>
      </div>
    </div>
  )
}
