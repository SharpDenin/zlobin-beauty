import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'

const schema = z.object({
  name: z.string().min(2, 'Минимум 2 символа'),
  city: z.string().min(2, 'Укажите город'),
  address_line: z.string().optional().or(z.literal('')),
  with_branch: z.boolean(),
  branch_name: z.string().optional().or(z.literal('')),
  branch_address_line: z.string().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
}).superRefine((data, ctx) => {
  if (!data.with_branch) return
  if (!data.branch_name || data.branch_name.trim().length < 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Укажите название филиала', path: ['branch_name'] })
  }
  const addr = (data.branch_address_line || data.address_line || '').trim()
  if (addr.length < 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Укажите адрес филиала', path: ['branch_address_line'] })
  }
})

export type CreateSalonValues = z.infer<typeof schema>

export type CreateSalonPayload = {
  name: string
  city: string
  address_line: string
  type: 'salon'
  branch_name?: string
  branch_city?: string
  branch_address_line?: string
  phone?: string
}

export function buildCreateSalonBody(values: CreateSalonValues): CreateSalonPayload {
  const body: CreateSalonPayload = {
    name: values.name.trim(),
    city: values.city.trim(),
    address_line: (values.address_line ?? '').trim(),
    type: 'salon',
  }
  if (values.with_branch) {
    body.branch_name = (values.branch_name ?? '').trim()
    body.branch_city = body.city
    body.branch_address_line = (values.branch_address_line || values.address_line || '').trim()
  }
  const phone = (values.phone ?? '').trim()
  if (phone) body.phone = phone
  return body
}

export function CreateSalonForm({
  submitLabel = 'Создать салон',
  pending = false,
  onSubmit,
  defaultCity = 'Красноярск',
}: {
  submitLabel?: string
  pending?: boolean
  onSubmit: (payload: CreateSalonPayload) => void | Promise<void>
  defaultCity?: string
}) {
  const [withBranch, setWithBranch] = useState(false)
  const [localPending, setLocalPending] = useState(false)
  const form = useForm<CreateSalonValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      city: defaultCity,
      address_line: '',
      with_branch: false,
      branch_name: '',
      branch_address_line: '',
      phone: '',
    },
  })
  const busy = pending || localPending || form.formState.isSubmitting

  return (
    <form
      className="stack"
      data-testid="create-salon-form"
      onSubmit={form.handleSubmit(async (values) => {
        if (pending || localPending) return
        setLocalPending(true)
        try {
          await onSubmit(buildCreateSalonBody({ ...values, with_branch: withBranch }))
        } finally {
          setLocalPending(false)
        }
      })}
    >
      <div className="field">
        <label htmlFor="salon-name">Название салона</label>
        <input id="salon-name" aria-invalid={Boolean(form.formState.errors.name)} {...form.register('name')} />
        {form.formState.errors.name && <span className="error">{form.formState.errors.name.message}</span>}
      </div>
      <div className="field">
        <label htmlFor="salon-city">Город</label>
        <input id="salon-city" aria-invalid={Boolean(form.formState.errors.city)} {...form.register('city')} />
        {form.formState.errors.city && <span className="error">{form.formState.errors.city.message}</span>}
      </div>
      <div className="field">
        <label htmlFor="salon-address">Адрес организации <span className="muted">(необязательно)</span></label>
        <input id="salon-address" {...form.register('address_line')} placeholder="Улица, дом" />
      </div>

      <div className="field switch-field">
        <label className="switch" htmlFor="with-branch">
          <input
            id="with-branch"
            type="checkbox"
            checked={withBranch}
            onChange={(e) => {
              const on = e.target.checked
              setWithBranch(on)
              form.setValue('with_branch', on, { shouldValidate: true })
            }}
          />
          <span className="switch-track" aria-hidden />
          <span className="switch-label">Добавить филиал сейчас</span>
        </label>
        <p className="hint">Филиал необязателен — его можно создать позже в настройках салона.</p>
      </div>

      {withBranch && (
        <div className="stack-sm" data-testid="create-salon-branch-fields">
          <div className="field">
            <label htmlFor="branch-name">Название филиала</label>
            <input id="branch-name" aria-invalid={Boolean(form.formState.errors.branch_name)} {...form.register('branch_name')} />
            {form.formState.errors.branch_name && <span className="error">{form.formState.errors.branch_name.message}</span>}
          </div>
          <div className="field">
            <label htmlFor="branch-address">Адрес филиала</label>
            <input
              id="branch-address"
              aria-invalid={Boolean(form.formState.errors.branch_address_line)}
              {...form.register('branch_address_line')}
              placeholder="Если пусто — возьмём адрес организации"
            />
            {form.formState.errors.branch_address_line && (
              <span className="error">{form.formState.errors.branch_address_line.message}</span>
            )}
          </div>
          <div className="field">
            <label htmlFor="branch-phone">Телефон филиала <span className="muted">(необязательно)</span></label>
            <input id="branch-phone" {...form.register('phone')} placeholder="+7 999 000-00-00" inputMode="tel" />
          </div>
        </div>
      )}

      <button className="btn btn-primary btn-block" type="submit" disabled={busy} aria-busy={busy}>
        {busy ? 'Создаём…' : submitLabel}
      </button>
    </form>
  )
}
