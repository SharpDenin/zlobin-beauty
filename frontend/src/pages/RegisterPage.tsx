import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { userError } from '@/shared/lib/app-error'
import { apiRequest } from '@/shared/api/client'
import { BrandLogo } from '@/shared/ui/BrandLogo'
import { ThemeToggle } from '@/shared/ui/ThemeToggle'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { ProfessionTypePicker } from '@/shared/ui/ProfessionTypePicker'
import { WorkFormatPicker } from '@/shared/ui/WorkFormatPicker'
import { primaryWorkType, uniqueCanonicalWorkTypes } from '@/shared/lib/work-types'
import { moderationError } from '@/shared/lib/moderation'
import { useFormDraft } from '@/shared/lib/useFormDraft'
import { PageLoading } from '@/shared/ui/PageLoading'

const ONBOARD_TYPES_KEY = 'sx.onboard.profession_types'
const ONBOARD_WORK_KEY = 'sx.onboard.work_type'
const ONBOARD_WORK_TYPES_KEY = 'sx.onboard.work_types'

const schema = z.object({
  display_name: z.string().min(2, 'Укажите имя'),
  email: z.string().email('Введите корректный email'),
  password: z.string().min(8, 'Минимум 8 символов'),
  role: z.enum(['client', 'master', 'supplier']),
  work_types: z.array(z.string()).optional(),
  profession_type_ids: z.array(z.string().uuid()).optional(),
}).superRefine((data, ctx) => {
  if (data.role === 'master' && (!data.profession_type_ids || data.profession_type_ids.length < 1)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Выберите хотя бы один тип мастера',
      path: ['profession_type_ids'],
    })
  }
  if (data.role === 'master' && (!data.work_types || data.work_types.length < 1)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Выберите формат работы',
      path: ['work_types'],
    })
  }
})

type Form = z.infer<typeof schema>

export function RegisterPage() {
  const { register: registerUser, user, loading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const invite = params.get('invite')?.trim() || ''
  const [error, setError] = useState<string | null>(null)
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      role: invite ? 'master' : 'client',
      work_types: invite ? ['employee'] : ['independent'],
      profession_type_ids: [],
    },
  })
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = form
  const draft = useFormDraft(form, 'register-form', { exclude: ['password'] })
  const role = watch('role')

  const inviteQ = useQuery({
    queryKey: ['invite-peek', invite],
    queryFn: () => apiRequest<{ organization_name: string; role: string }>(`/v1/invites/${encodeURIComponent(invite)}`),
    enabled: Boolean(invite),
    retry: false,
  })

  useEffect(() => {
    if (invite) {
      setValue('role', 'master')
      setValue('work_types', ['employee'])
    }
  }, [invite, setValue])

  if (loading) return <PageLoading label="Загрузка сессии" />
  if (user && invite) {
    navigate(`/invite/${invite}`, { replace: true })
    return null
  }
  if (user) {
    navigate('/', { replace: true })
    return null
  }

  return (
    <div className="app-shell app-shell--auth">
      <div className="page page-narrow stack auth-screen">
        <div className="auth-theme-bar"><ThemeToggle labelled /></div>
        <BrandLogo size="lg" />
        <h1>Регистрация</h1>
        {inviteQ.data ? (
          <p className="auth-lead">Вас приглашают в салон «{inviteQ.data.organization_name}».</p>
        ) : (
          <p className="auth-lead">Создайте аккаунт за минуту. Салон нужен только владельцам.</p>
        )}
        <form
          className="card stack"
          onSubmit={handleSubmit(async (values) => {
            setError(null)
            try {
              const banned = moderationError(values.display_name)
              if (banned) {
                setError(banned)
                return
              }
              if (values.role === 'master' && (!values.profession_type_ids || values.profession_type_ids.length < 1)) {
                setError('Выберите хотя бы один тип мастера')
                return
              }
              const workTypes = uniqueCanonicalWorkTypes(values.work_types ?? ['independent'])
              await registerUser({
                display_name: values.display_name,
                email: values.email,
                password: values.password,
                as_master: values.role === 'master',
                as_supplier: values.role === 'supplier',
              })
              draft.clear()
              if (values.role === 'master' || values.role === 'supplier') {
                sessionStorage.setItem('sx.welcome_trial', '1')
              }
              if (values.role === 'master') {
                sessionStorage.setItem(ONBOARD_TYPES_KEY, JSON.stringify(values.profession_type_ids ?? []))
                sessionStorage.setItem(ONBOARD_WORK_TYPES_KEY, JSON.stringify(workTypes))
                sessionStorage.setItem(ONBOARD_WORK_KEY, primaryWorkType(workTypes))
                if (invite) {
                  navigate(`/invite/${invite}`, { replace: true })
                  return
                }
                navigate('/master')
              } else if (values.role === 'supplier') navigate('/supplier')
              else navigate('/')
            } catch (e) {
              setError(userError(e, 'Не удалось зарегистрироваться'))
            }
          })}
        >
          <div className="field">
            <label htmlFor="display_name">Имя</label>
            <input id="display_name" required aria-required="true" {...register('display_name')} />
            {errors.display_name && <span className="error">{errors.display_name.message}</span>}
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required aria-required="true" autoComplete="email" {...register('email')} />
            {errors.email && <span className="error">{errors.email.message}</span>}
          </div>
          <div className="field">
            <label htmlFor="password">Пароль</label>
            <input id="password" type="password" required aria-required="true" autoComplete="new-password" {...register('password')} />
            {errors.password && <span className="error">{errors.password.message}</span>}
          </div>
          {!invite && (
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
            </fieldset>
          )}
          {role === 'master' && (
            <>
              <ProfessionTypePicker
                value={watch('profession_type_ids') ?? []}
                onChange={(ids) => setValue('profession_type_ids', ids, { shouldValidate: true, shouldDirty: true })}
                error={errors.profession_type_ids?.message}
              />
              {!invite && (
                <WorkFormatPicker
                  value={watch('work_types') ?? ['independent']}
                  onChange={(ids) => setValue('work_types', ids, { shouldValidate: true, shouldDirty: true })}
                  error={errors.work_types?.message}
                />
              )}
            </>
          )}
          {error && <ErrorBanner error={error} />}
          <button className={`btn btn-primary btn-block${isSubmitting ? ' btn-loading' : ''}`} disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Создаём…' : 'Создать аккаунт'}
          </button>
        </form>
        <p>Уже есть аккаунт? <Link to={invite ? `/login?next=/invite/${invite}` : '/login'}>Войти</Link></p>
      </div>
    </div>
  )
}

export { ONBOARD_TYPES_KEY, ONBOARD_WORK_KEY, ONBOARD_WORK_TYPES_KEY }
