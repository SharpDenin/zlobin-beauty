import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { userError, formatUserError } from '@/shared/lib/app-error'
import { apiRequest } from '@/shared/api/client'
import { BrandLogo } from '@/shared/ui/BrandLogo'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { ProfessionTypePicker } from '@/shared/ui/ProfessionTypePicker'
import { WorkFormatPicker } from '@/shared/ui/WorkFormatPicker'
import { CreateSalonForm, type CreateSalonPayload } from '@/shared/ui/CreateSalonForm'
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
  create_salon: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (data.role === 'master' && (!data.profession_type_ids || data.profession_type_ids.length < 1)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Выберите хотя бы один тип мастера',
      path: ['profession_type_ids'],
    })
  }
})

type Form = z.infer<typeof schema>
type Step = 'contacts' | 'role' | 'formats' | 'salon' | 'done'

export function RegisterPage() {
  const { register: registerUser, user, loading, accessToken } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const invite = params.get('invite')?.trim() || ''
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('contacts')
  const [salonPending, setSalonPending] = useState(false)
  const [salonCreated, setSalonCreated] = useState(false)
  const registeredRef = useRef(false)
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      role: invite ? 'master' : 'client',
      work_types: ['private_practice'],
      profession_type_ids: [],
      create_salon: false,
    },
  })
  const { register, watch, setValue, trigger, getValues, formState: { errors, isSubmitting } } = form
  const draft = useFormDraft(form, 'register-form', { exclude: ['password'] })
  const role = watch('role')
  const createSalon = watch('create_salon')

  const inviteQ = useQuery({
    queryKey: ['invite-peek', invite],
    queryFn: () => apiRequest<{ organization_name: string; role: string }>(`/v1/invites/${encodeURIComponent(invite)}`),
    enabled: Boolean(invite),
    retry: false,
  })

  useEffect(() => {
    if (invite) setValue('role', 'master')
  }, [invite, setValue])

  // Already signed-in users landing on /register go home (except invite deep-link).
  useEffect(() => {
    if (loading || registeredRef.current) return
    if (user && invite) {
      navigate(`/invite/${invite}`, { replace: true })
      return
    }
    if (user && step === 'contacts') {
      navigate('/', { replace: true })
    }
  }, [loading, user, invite, navigate, step])

  if (loading) return <PageLoading label="Загрузка сессии" />

  async function finishWithoutSalon() {
    const values = getValues()
    navigateAfterRegister(values.role)
  }

  function navigateAfterRegister(r: Form['role']) {
    if (r === 'master') {
      navigate('/master', { replace: true })
    } else if (r === 'supplier') {
      navigate('/supplier', { replace: true })
    } else {
      navigate('/', { replace: true })
    }
  }

  function readSessionToken(): string | undefined {
    try {
      const raw = localStorage.getItem('zb.auth')
      if (!raw) return accessToken ?? undefined
      return (JSON.parse(raw) as { accessToken?: string }).accessToken || accessToken || undefined
    } catch {
      return accessToken ?? undefined
    }
  }

  async function ensureRegistered(): Promise<string | null> {
    if (registeredRef.current) {
      return readSessionToken() ?? null
    }
    const values = getValues()
    setError(null)
    try {
      const banned = moderationError(values.display_name)
      if (banned) {
        setError(banned)
        return null
      }
      if (values.role === 'master' && (!values.profession_type_ids || values.profession_type_ids.length < 1)) {
        setError('Выберите хотя бы один тип мастера')
        return null
      }
      if (values.role === 'master' && !invite) {
        const picked = uniqueCanonicalWorkTypes(values.work_types ?? [])
        if (!picked.length) {
          setError('Выберите формат работы')
          return null
        }
      }
      const workTypes = invite
        ? []
        : uniqueCanonicalWorkTypes(values.work_types ?? ['private_practice'])
      await registerUser({
        display_name: values.display_name,
        email: values.email,
        password: values.password,
        as_master: values.role === 'master',
        as_supplier: values.role === 'supplier',
      })
      registeredRef.current = true
      draft.clear()
      if (values.role === 'master' || values.role === 'supplier') {
        sessionStorage.setItem('sx.welcome_trial', '1')
      }
      if (values.role === 'master') {
        sessionStorage.setItem(ONBOARD_TYPES_KEY, JSON.stringify(values.profession_type_ids ?? []))
        if (workTypes.length) {
          sessionStorage.setItem(ONBOARD_WORK_TYPES_KEY, JSON.stringify(workTypes))
          sessionStorage.setItem(ONBOARD_WORK_KEY, primaryWorkType(workTypes))
        }
      }
      return readSessionToken() ?? null
    } catch (e) {
      setError(userError(e, 'Не удалось зарегистрироваться'))
      return null
    }
  }

  async function createSalonNow(payload: CreateSalonPayload) {
    if (salonCreated) {
      finishWithoutSalon()
      return
    }
    if (salonPending) return
    setSalonPending(true)
    setError(null)
    try {
      const token = await ensureRegistered()
      if (!token) return
      const { phone, ...body } = payload
      const res = await apiRequest<{ organization: { id: string }; branch: { id: string } | null }>(
        '/v1/organizations',
        { token, body },
      )
      if (phone && res.branch?.id) {
        await apiRequest(`/v1/branches/${res.branch.id}`, {
          method: 'PATCH',
          token,
          body: { phone },
        })
      }
      setSalonCreated(true)
      localStorage.setItem('sx.selectedOrg', res.organization.id)
      navigateAfterRegister(getValues().role)
    } catch (e) {
      setError(formatUserError(e, 'Не удалось создать салон. Аккаунт уже создан — можно повторить.'))
    } finally {
      setSalonPending(false)
    }
  }

  async function goNextFromContacts() {
    const ok = await trigger(['display_name', 'email', 'password'])
    if (ok) setStep(invite ? 'formats' : 'role')
  }

  async function goNextFromRole() {
    if (role === 'master') {
      setStep('formats')
      return
    }
    // Client / supplier: optional salon for client only
    if (role === 'client') {
      setStep('salon')
      return
    }
    // Supplier: register and go
    const token = await ensureRegistered()
    if (token) navigateAfterRegister('supplier')
  }

  async function goNextFromFormats() {
    const okTypes = await trigger(['profession_type_ids', 'work_types'])
    if (!okTypes) return
    if (invite) {
      const token = await ensureRegistered()
      if (token) navigate(`/invite/${invite}`, { replace: true })
      return
    }
    setStep('salon')
  }

  async function skipSalon() {
    const token = await ensureRegistered()
    if (!token) return
    if (invite) {
      navigate(`/invite/${invite}`, { replace: true })
      return
    }
    navigateAfterRegister(getValues().role)
  }

  const stepIndex = ['contacts', 'role', 'formats', 'salon'].indexOf(step)

  return (
    <div className="app-shell app-shell--auth">
      <div className="page page-narrow stack auth-screen">
        <BrandLogo size="lg" />
        <h1>Регистрация</h1>
        {inviteQ.data ? (
          <p className="auth-lead">Вас приглашают в салон «{inviteQ.data.organization_name}».</p>
        ) : (
          <p className="auth-lead">Создайте аккаунт за минуту. Салон можно добавить сразу или позже.</p>
        )}

        {!invite && step !== 'done' && (
          <ol className="wizard-steps register-steps" aria-label="Шаги регистрации">
            {['Контакты', 'Роль', role === 'master' ? 'Форматы' : '—', 'Салон'].map((label, i) => (
              <li
                key={label + i}
                className={`wizard-step${i === stepIndex ? ' active' : ''}${i < stepIndex ? ' done' : ''}${label === '—' ? ' is-skip' : ''}`}
              >
                {label === '—' ? '·' : label}
              </li>
            ))}
          </ol>
        )}

        {error && <ErrorBanner error={error} />}

        {step === 'contacts' && (
          <form
            className="card stack"
            onSubmit={(e) => {
              e.preventDefault()
              void goNextFromContacts()
            }}
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
            <button className="btn btn-primary btn-block" type="submit">Далее</button>
          </form>
        )}

        {step === 'role' && !invite && (
          <div className="card stack">
            <fieldset className="stack-sm">
              <legend className="label-text">Кто вы?</legend>
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
              <p className="muted">Владение салоном — не роль аккаунта. Салон можно создать на следующем шаге или позже в настройках.</p>
            </fieldset>
            <div className="row gap wrap">
              <button className="btn btn-secondary" type="button" onClick={() => setStep('contacts')}>Назад</button>
              <button className="btn btn-primary" type="button" disabled={isSubmitting} onClick={() => void goNextFromRole()}>
                Далее
              </button>
            </div>
          </div>
        )}

        {step === 'formats' && (
          <div className="card stack">
            <ProfessionTypePicker
              value={watch('profession_type_ids') ?? []}
              onChange={(ids) => setValue('profession_type_ids', ids, { shouldValidate: true, shouldDirty: true })}
              error={errors.profession_type_ids?.message}
            />
            {!invite && (
              <WorkFormatPicker
                value={watch('work_types') ?? ['private_practice']}
                onChange={(ids) => setValue('work_types', ids, { shouldValidate: true, shouldDirty: true })}
                error={errors.work_types?.message}
              />
            )}
            {invite && (
              <p className="muted">После присоединения к салону формат работы можно указать в профиле мастера.</p>
            )}
            <div className="row gap wrap">
              <button className="btn btn-secondary" type="button" onClick={() => setStep(invite ? 'contacts' : 'role')}>Назад</button>
              <button className="btn btn-primary" type="button" disabled={isSubmitting} onClick={() => void goNextFromFormats()}>
                Далее
              </button>
            </div>
          </div>
        )}

        {step === 'salon' && (
          <div className="card stack">
            <h2>Салон</h2>
            <p className="muted">Можно пропустить и создать салон позже в «Настройки → Мои салоны».</p>
            <div className="field switch-field">
              <label className="switch" htmlFor="create_salon">
                <input
                  id="create_salon"
                  type="checkbox"
                  checked={Boolean(createSalon)}
                  onChange={(e) => setValue('create_salon', e.target.checked)}
                />
                <span className="switch-track" aria-hidden />
                <span className="switch-label">Создать салон сейчас</span>
              </label>
            </div>
            {createSalon ? (
              <CreateSalonForm
                pending={salonPending || isSubmitting}
                defaultCity="Красноярск"
                onSubmit={(payload) => createSalonNow(payload)}
              />
            ) : (
              <div className="row gap wrap">
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setStep(role === 'master' ? 'formats' : 'role')}
                >
                  Назад
                </button>
                <button className="btn btn-primary" type="button" disabled={isSubmitting} onClick={() => void skipSalon()}>
                  {isSubmitting ? 'Создаём…' : 'Завершить'}
                </button>
              </div>
            )}
            {createSalon && (
              <button className="btn btn-secondary btn-block" type="button" onClick={() => setValue('create_salon', false)}>
                Не создавать салон сейчас
              </button>
            )}
          </div>
        )}

        <p>Уже есть аккаунт? <Link to={invite ? `/login?next=/invite/${invite}` : '/login'}>Войти</Link></p>
      </div>
    </div>
  )
}

export { ONBOARD_TYPES_KEY, ONBOARD_WORK_KEY, ONBOARD_WORK_TYPES_KEY }
