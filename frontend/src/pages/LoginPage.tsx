import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { ApiError } from '@/shared/api/client'

const schema = z.object({
  email: z.string().email('Введите корректный email'),
  password: z.string().min(8, 'Минимум 8 символов'),
})

type Form = z.infer<typeof schema>

export function LoginPage({ redirectTo = '/' }: { redirectTo?: string }) {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting }, setFocus } = useForm<Form>({
    resolver: zodResolver(schema),
  })

  return (
    <div className="page page-narrow stack" style={{ paddingTop: 48 }}>
        <div className="brand">Zlobin Beauty</div>
        <h1>Вход</h1>
        <p>Войдите, чтобы искать мастеров и управлять записями.</p>
        <form
          className="card stack"
          onSubmit={handleSubmit(async (values) => {
            setError(null)
            try {
              await login(values.email, values.password)
              navigate(redirectTo || '/')
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Не удалось войти')
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
          {error && <div className="state-box error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Входим…' : 'Войти'}
          </button>
        </form>
        <p>Нет аккаунта? <Link to="/register">Зарегистрироваться</Link></p>
    </div>
  )
}
