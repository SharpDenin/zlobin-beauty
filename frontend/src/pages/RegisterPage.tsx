import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { ApiError } from '@/shared/api/client'

const schema = z.object({
  display_name: z.string().min(2, 'Укажите имя'),
  email: z.string().email('Введите корректный email'),
  password: z.string().min(8, 'Минимум 8 символов'),
  as_master: z.boolean().optional(),
})

type Form = z.infer<typeof schema>

export function RegisterPage() {
  const { register: registerUser } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { as_master: false },
  })

  return (
    <div className="app-shell app-shell--auth">
      <div className="page page-narrow stack">
        <div className="brand">Zlobin Beauty</div>
        <h1>Регистрация</h1>
        <p>Создайте аккаунт клиента или мастера.</p>
        <form
          className="card stack"
          onSubmit={handleSubmit(async (values) => {
            setError(null)
            try {
              await registerUser(values)
              navigate(values.as_master ? '/master' : '/')
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Не удалось зарегистрироваться')
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
            <input id="email" type="email" {...register('email')} />
            {errors.email && <span className="error">{errors.email.message}</span>}
          </div>
          <div className="field">
            <label htmlFor="password">Пароль</label>
            <input id="password" type="password" {...register('password')} />
            {errors.password && <span className="error">{errors.password.message}</span>}
          </div>
          <label className="row">
            <input type="checkbox" {...register('as_master')} />
            <span>Я мастер / владелец салона</span>
          </label>
          {error && <div className="state-box error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Создаём…' : 'Создать аккаунт'}
          </button>
        </form>
        <p>Уже есть аккаунт? <Link to="/login">Войти</Link></p>
      </div>
    </div>
  )
}
