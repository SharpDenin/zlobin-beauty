import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { userError } from '@/shared/lib/app-error'
import { BrandLogo } from '@/shared/ui/BrandLogo'
import { ThemeToggle } from '@/shared/ui/ThemeToggle'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'

const schema = z.object({
  display_name: z.string().min(2, 'Укажите имя'),
  email: z.string().email('Введите корректный email'),
  password: z.string().min(8, 'Минимум 8 символов'),
  role: z.enum(['client', 'master', 'supplier']),
})

type Form = z.infer<typeof schema>

export function RegisterPage() {
  const { register: registerUser } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'client' },
  })
  const role = watch('role')

  return (
    <div className="app-shell app-shell--auth">
      <div className="page page-narrow stack auth-screen">
        <div className="auth-theme-bar"><ThemeToggle labelled /></div>
        <BrandLogo size="lg" />
        <h1>Регистрация</h1>
        <p className="auth-lead">Создайте кабинет за минуту.</p>
        <form
          className="card stack"
          onSubmit={handleSubmit(async (values) => {
            setError(null)
            try {
              await registerUser({
                display_name: values.display_name,
                email: values.email,
                password: values.password,
                as_master: values.role === 'master',
                as_supplier: values.role === 'supplier',
              })
              if (values.role === 'master' || values.role === 'supplier') {
                sessionStorage.setItem('sx.welcome_trial', '1')
              }
              if (values.role === 'master') navigate('/master')
              else if (values.role === 'supplier') navigate('/supplier')
              else navigate('/')
            } catch (e) {
              setError(userError(e, 'Не удалось зарегистрироваться'))
            }
          })}
        >
          <div className="field">
            <label htmlFor="display_name">Имя</label>
            <input id="display_name" {...register('display_name')} />
            {errors.display_name && <span className="error">{errors.display_name.message}</span>}
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" {...register('email')} />
            {errors.email && <span className="error">{errors.email.message}</span>}
          </div>
          <div className="field">
            <label htmlFor="password">Пароль</label>
            <input id="password" type="password" autoComplete="new-password" {...register('password')} />
            {errors.password && <span className="error">{errors.password.message}</span>}
          </div>
          <fieldset className="stack-sm">
            <legend className="label-text">Роль</legend>
            <div className="segmented" role="radiogroup" aria-label="Роль">
              <label className={role === 'client' ? 'is-active' : ''}>
                <input type="radio" value="client" {...register('role')} />
                Клиент
              </label>
              <label className={role === 'master' ? 'is-active' : ''}>
                <input type="radio" value="master" {...register('role')} />
                Мастер
              </label>
              <label className={role === 'supplier' ? 'is-active' : ''}>
                <input type="radio" value="supplier" {...register('role')} />
                Поставщик
              </label>
            </div>
            {errors.role && <span className="error">{errors.role.message}</span>}
          </fieldset>
          {error && <ErrorBanner error={error} />}
          <button className={`btn btn-primary btn-block${isSubmitting ? ' btn-loading' : ''}`} disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Создаём…' : 'Создать аккаунт'}
          </button>
        </form>
        <p>Уже есть аккаунт? <Link to="/login">Войти</Link></p>
      </div>
    </div>
  )
}
