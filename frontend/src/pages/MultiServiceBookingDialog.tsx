import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { normalizeError } from '@/shared/lib/app-error'
import { formatMoney } from '@/shared/lib/money'
import { formatLocalInTimezone } from '@/shared/lib/time'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Modal } from '@/shared/ui/Modal'
import { Drawer } from '@/shared/ui/Drawer'
import { toast } from '@/shared/ui/Toast'
import {
  canJoinMultiService,
  confirmLegsFromPlan,
  formatVisitMinutes,
  isVisitPlanRace,
  salonCompanionServices,
  swapServiceOrder,
  visitPlanKey,
  type VisitPlan,
  type VisitPlansResponse,
  type VisitService,
} from '@/pages/visit-plan-helpers'

type Props = {
  open: boolean
  onClose: () => void
  token: string | null | undefined
  organizationId: string
  firstService: VisitService
  onSuccess?: () => void
}

function useCompactSurface() {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : true,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const onChange = () => setCompact(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return compact
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function MultiServiceBookingDialog({
  open,
  onClose,
  token,
  organizationId,
  firstService,
  onSuccess,
}: Props) {
  const compact = useCompactSurface()
  const qc = useQueryClient()
  const [secondId, setSecondId] = useState('')
  const [order, setOrder] = useState<string[] | null>(null)
  const [from, setFrom] = useState(todayISO)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!open) return
    setSecondId('')
    setOrder(null)
    setFrom(todayISO())
    setSelectedKey(null)
    setConfirming(false)
  }, [open, firstService.id])

  const catalog = useQuery({
    queryKey: ['org-services', organizationId],
    queryFn: () =>
      apiRequest<{ items: VisitService[] }>(`/v1/services?organization_id=${encodeURIComponent(organizationId)}`),
    enabled: open && Boolean(organizationId),
    retry: false,
  })

  const companions = useMemo(
    () => salonCompanionServices(catalog.data?.items ?? [], firstService.id),
    [catalog.data?.items, firstService.id],
  )
  const second = companions.find((item) => item.id === secondId)

  const serviceIds = second ? [firstService.id, second.id] : []
  const requestOrder = order && order.length === 2 ? order : undefined

  const plans = useQuery({
    queryKey: ['visit-plans', serviceIds[0], serviceIds[1], requestOrder?.[0], requestOrder?.[1], from],
    queryFn: () =>
      apiRequest<VisitPlansResponse>('/v1/appointments/plans', {
        token,
        body: {
          service_ids: serviceIds,
          order: requestOrder,
          from,
          limit: 6,
        },
      }),
    enabled: open && Boolean(token && second && canJoinMultiService(firstService) && canJoinMultiService(second)),
    placeholderData: keepPreviousData,
    retry: false,
  })

  const tz = plans.data?.timezone || 'Europe/Moscow'
  const selected = plans.data?.items.find((plan) => visitPlanKey(plan) === selectedKey) ?? null
  const currentOrder = requestOrder ?? plans.data?.recommended_order ?? serviceIds

  const confirm = useMutation({
    mutationFn: (plan: VisitPlan) =>
      apiRequest<{ items: Array<{ id: string }> }>('/v1/appointments/plans/confirm', {
        token,
        body: { legs: confirmLegsFromPlan(plan) },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      toast.success('Визит записан')
      await qc.invalidateQueries({ queryKey: ['appointments'] })
      await qc.invalidateQueries({ queryKey: ['home-appointments'] })
      await qc.invalidateQueries({ queryKey: ['slots'] })
      await qc.invalidateQueries({ queryKey: ['visit-plans'] })
      onSuccess?.()
      onClose()
    },
  })

  const race = confirm.isError && isVisitPlanRace(normalizeError(confirm.error).code)
  const confirmError = confirm.error
    ? race
      ? { title: 'Расписание изменилось', hint: 'Один из выбранных слотов уже занят. Выберите другой вариант.' }
      : confirm.error
    : null

  function swapOrder() {
    if (currentOrder.length !== 2) return
    setSelectedKey(null)
    setConfirming(false)
    confirm.reset()
    setOrder(swapServiceOrder(currentOrder))
  }

  const body = (
    <div className="stack visit-plan-dialog" data-testid="multi-service-booking">
      <section className="visit-plan-current">
        <p className="muted">Услуга 1</p>
        <strong>{firstService.name}</strong>
        <p className="muted">
          {firstService.duration_minutes} мин · {firstService.price_display || formatMoney(firstService.price_minor)}
        </p>
      </section>

      {catalog.isLoading && (
        <div className="stack" aria-busy="true">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-card" />
        </div>
      )}
      {catalog.isError && <ErrorBanner error={catalog.error} fallbackTitle="Не удалось загрузить услуги салона" />}

      {!second && !catalog.isLoading && (
        <div className="stack">
          <p>Выберите вторую услугу того же салона</p>
          {companions.length === 0 && (
            <EmptyState title="Нет второй услуги" text="В этом салоне пока нет другой гибкой услуги для совместной записи." />
          )}
          <div className="list">
            {companions.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`occurrence-card${secondId === item.id ? ' selected' : ''}`}
                onClick={() => {
                  setSecondId(item.id)
                  setOrder(null)
                  setSelectedKey(null)
                  setConfirming(false)
                }}
              >
                <div className="row between">
                  <strong>{item.name}</strong>
                  <span>{item.price_display || formatMoney(item.price_minor)}</span>
                </div>
                <p className="muted">{item.category} · {item.duration_minutes} мин</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {second && (
        <div className="stack">
          <div className="row between">
            <div>
              <p className="muted">Услуга 2</p>
              <strong>{second.name}</strong>
            </div>
            <button
              className="btn btn-ghost btn-compact"
              type="button"
              onClick={() => {
                setSecondId('')
                setOrder(null)
                setSelectedKey(null)
                setConfirming(false)
              }}
            >
              Изменить
            </button>
          </div>

          <div className="field">
            <label htmlFor="visit-from">Дата поиска</label>
            <input
              id="visit-from"
              type="date"
              value={from}
              min={todayISO()}
              onChange={(e) => {
                setFrom(e.target.value)
                setSelectedKey(null)
                setConfirming(false)
              }}
            />
          </div>

          <button className="btn btn-secondary" type="button" onClick={swapOrder} disabled={plans.isFetching}>
            Изменить порядок
          </button>
          {plans.data?.order_warning ? <p className="muted">{plans.data.order_warning}</p> : null}
        </div>
      )}

      {second && plans.isLoading && !plans.data && (
        <div className="stack" data-testid="visit-plan-loading" aria-busy="true">
          <p className="muted">Подбираем мастеров и свободное время…</p>
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      )}

      {second && plans.isError && (
        <ErrorBanner error={plans.error} fallbackTitle="Не удалось подобрать расписание" />
      )}

      {second && plans.isSuccess && plans.data.items.length === 0 && (
        <EmptyState
          title="Не удалось подобрать общее время"
          text="Попробуйте другую услугу или другую дату."
        />
      )}

      {second && !confirming && plans.isSuccess && plans.data.items.length > 0 && (
        <div className="stack" role="radiogroup" aria-label="Варианты визита">
          <p className="muted">Найденные варианты</p>
          {plans.data!.items.map((plan) => {
            const key = visitPlanKey(plan)
            const pressed = selectedKey === key
            return (
              <button
                key={key}
                type="button"
                role="radio"
                className={`occurrence-card visit-plan-card${pressed ? ' selected' : ''}`}
                aria-checked={pressed}
                onClick={() => {
                  setSelectedKey(key)
                  setConfirming(true)
                  confirm.reset()
                }}
              >
                {plan.legs.map((leg) => (
                  <div key={`${leg.service_id}-${leg.starts_at}`} className="visit-plan-leg">
                    <strong>{formatLocalInTimezone(leg.starts_at, tz, { hour: '2-digit', minute: '2-digit' })}</strong>
                    <span>{leg.service_name}</span>
                    <span className="muted">{leg.master_display_name}</span>
                  </div>
                ))}
                <p className="muted">
                  {formatVisitMinutes(plan.total_minutes)}
                  {plan.wait_minutes > 0 ? ` · ожидание ${plan.wait_minutes} мин` : ''}
                  {plan.same_master ? ' · один мастер' : ''}
                </p>
              </button>
            )
          })}
        </div>
      )}

      {confirmError && (
        <div className="stack">
          {typeof confirmError === 'object' && 'title' in confirmError ? (
            <div className="state-box error error-banner" role="alert">
              <strong className="error-banner__title">{confirmError.title}</strong>
              <p className="error-banner__hint">{confirmError.hint}</p>
            </div>
          ) : (
            <ErrorBanner error={confirmError} fallbackTitle="Не удалось подтвердить визит" />
          )}
          {race && (
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => {
                setConfirming(false)
                setSelectedKey(null)
                confirm.reset()
                void plans.refetch()
              }}
            >
              Выбрать другой вариант
            </button>
          )}
        </div>
      )}

      {confirming && selected && (
        <section className="visit-plan-confirm stack" data-testid="visit-plan-confirm">
          <h3>Ваш визит</h3>
          {selected.legs.map((leg) => (
            <p key={`${leg.service_id}-${leg.starts_at}`}>
              <strong>{formatLocalInTimezone(leg.starts_at, tz, { hour: '2-digit', minute: '2-digit' })}</strong>
              {' '}
              {leg.service_name}
              <span className="muted"> · {leg.master_display_name}</span>
            </p>
          ))}
          <p>Общая продолжительность: {formatVisitMinutes(selected.total_minutes)}</p>
          <p>Стоимость: {formatMoney(plans.data?.total_price_minor ?? selected.legs.reduce((n, l) => n + l.price_minor, 0))}</p>
          <div className="row">
            <button
              className="btn btn-secondary"
              type="button"
              disabled={confirm.isPending}
              onClick={() => {
                setConfirming(false)
                setSelectedKey(null)
              }}
            >
              Назад
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate(selected)}
            >
              {confirm.isPending ? 'Записываем…' : 'Подтвердить'}
            </button>
          </div>
        </section>
      )}
    </div>
  )

  if (compact) {
    return (
      <Drawer
        open={open}
        onClose={onClose}
        title="Две услуги"
        panelClassName="reschedule-drawer-panel"
      >
        {body}
      </Drawer>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Две услуги" size="lg">
      {body}
    </Modal>
  )
}
