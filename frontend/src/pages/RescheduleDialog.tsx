import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { normalizeError } from '@/shared/lib/app-error'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Modal } from '@/shared/ui/Modal'
import { Drawer } from '@/shared/ui/Drawer'
import { toast } from '@/shared/ui/Toast'
import {
  canRescheduleAppointment,
  groupSlotsByDate,
  isRaceSlotError,
  slotDateTimeLabel,
  slotTimeLabel,
  type RescheduleOptionsResponse,
  type RescheduleSlot,
} from '@/pages/reschedule-helpers'

const INITIAL_LIMIT = 6

export type RescheduleAppointment = {
  id: string
  service_name: string
  starts_at: string
  ends_at: string
  status: string
  booking_mode?: string
  location_timezone?: string
  location_name?: string
  location_city?: string
  master_user_id: string
}

type Props = {
  open: boolean
  onClose: () => void
  appointment: RescheduleAppointment
  token: string | null | undefined
  canOpenCalendar?: boolean
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

export function RescheduleDialog({ open, onClose, appointment, token, canOpenCalendar, onSuccess }: Props) {
  const compact = useCompactSurface()
  const qc = useQueryClient()
  const [limit, setLimit] = useState(INITIAL_LIMIT)
  const [selected, setSelected] = useState<RescheduleSlot | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!open) return
    setLimit(INITIAL_LIMIT)
    setSelected(null)
    setConfirming(false)
  }, [open, appointment.id])

  const eligible = canRescheduleAppointment(appointment.status, appointment.booking_mode)
  const options = useQuery({
    queryKey: ['reschedule-options', appointment.id, limit],
    queryFn: () =>
      apiRequest<RescheduleOptionsResponse>(`/v1/appointments/${appointment.id}/reschedule-options?limit=${limit}`, {
        token,
      }),
    enabled: open && eligible && Boolean(token && appointment.id),
    placeholderData: keepPreviousData,
    retry: false,
  })

  const tz = options.data?.timezone || appointment.location_timezone || 'Europe/Moscow'
  const groups = useMemo(
    () => groupSlotsByDate(options.data?.items ?? [], tz),
    [options.data?.items, tz],
  )
  const masterName = options.data?.master_display_name
  const salon = appointment.location_name || appointment.location_city

  const commit = useMutation({
    mutationFn: (slot: RescheduleSlot) =>
      apiRequest(`/v1/appointments/${appointment.id}/reschedule`, {
        method: 'POST',
        token,
        body: { starts_at: slot.starts_at },
      }),
    onSuccess: async () => {
      toast.success(`Запись перенесена\nНовая дата:\n${slotDateTimeLabel(selected?.starts_at || appointment.starts_at, tz)}`)
      await qc.invalidateQueries({ queryKey: ['appointment', appointment.id] })
      await qc.invalidateQueries({ queryKey: ['appointments'] })
      await qc.invalidateQueries({ queryKey: ['appointment-history', appointment.id] })
      await qc.invalidateQueries({ queryKey: ['calendar-appointments'] })
      await qc.invalidateQueries({ queryKey: ['slots'] })
      await qc.invalidateQueries({ queryKey: ['reschedule-options', appointment.id] })
      onSuccess?.()
      onClose()
    },
  })

  const race = commit.isError && isRaceSlotError(normalizeError(commit.error).code)
  const commitError = commit.error
    ? race
      ? { title: 'Это время уже занято', hint: 'Кто-то успел занять этот слот. Выберите другой вариант.' }
      : commit.error
    : null

  async function onRaceRetry() {
    setSelected(null)
    setConfirming(false)
    commit.reset()
    await options.refetch()
  }

  const body = (
    <div className="stack reschedule-dialog" data-testid="reschedule-dialog">
      <section className="reschedule-current">
        <strong className="reschedule-current__service">{appointment.service_name}</strong>
        {masterName ? <p className="muted">{masterName}</p> : null}
        {salon ? <p className="muted">{salon}</p> : null}
        <p>{slotDateTimeLabel(appointment.starts_at, tz)}</p>
      </section>

      {options.isLoading && !options.data && (
        <div className="stack" data-testid="reschedule-loading" aria-busy="true">
          <p className="muted">Ищем подходящее время…</p>
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      )}

      {options.isError && (
        <ErrorBanner error={options.error} fallbackTitle="Не удалось найти варианты переноса" />
      )}

      {options.isSuccess && groups.length === 0 && (
        <EmptyState
          title="Подходящих вариантов пока нет"
          text="У этого мастера пока нет свободного времени в ближайшие дни. Попробуйте позже или обратитесь в салон."
          action={
            canOpenCalendar ? (
              <Link className="btn btn-secondary" to="/calendar" onClick={onClose}>
                Открыть календарь
              </Link>
            ) : undefined
          }
        />
      )}

      {!confirming && groups.length > 0 && (
        <div
          className="stack"
          role="radiogroup"
          aria-label="Варианты переноса"
          onKeyDown={(event) => {
            if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return
            const all = groups.flatMap((item) => item.slots)
            if (all.length === 0) return
            event.preventDefault()
            const idx = all.findIndex((item) => item.starts_at === selected?.starts_at)
            const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
            const next = all[(Math.max(idx, 0) + delta + all.length) % all.length]
            setSelected(next)
            const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-slot-start]')
            Array.from(buttons)
              .find((button) => button.dataset.slotStart === next.starts_at)
              ?.focus()
          }}
        >
          <p className="muted">Мы нашли подходящие варианты</p>
          {groups.map((group) => (
            <section key={group.dateKey} className="reschedule-day">
              <h3>{group.label}</h3>
              <div className="reschedule-slots">
                {group.slots.map((slot) => {
                  const pressed = selected?.starts_at === slot.starts_at
                  return (
                    <button
                      key={slot.starts_at}
                      type="button"
                      role="radio"
                      data-slot-start={slot.starts_at}
                      className={`occurrence-card${pressed ? ' selected' : ''}`}
                      aria-checked={pressed}
                      aria-label={`${group.label}, ${slotTimeLabel(slot.starts_at, tz)}`}
                      disabled={commit.isPending}
                      onClick={() => {
                        setSelected(slot)
                        setConfirming(true)
                        commit.reset()
                      }}
                    >
                      {slotTimeLabel(slot.starts_at, tz)}
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
          {options.data?.has_more && (
            <button
              className="btn btn-ghost"
              type="button"
              disabled={options.isFetching}
              onClick={() => setLimit((n) => n + INITIAL_LIMIT)}
            >
              Показать ещё
            </button>
          )}
        </div>
      )}

      {commitError && (
        <div className="stack">
          {typeof commitError === 'object' && 'title' in commitError ? (
            <div className="state-box error error-banner" role="alert">
              <strong className="error-banner__title">{commitError.title}</strong>
              <p className="error-banner__hint">{commitError.hint}</p>
            </div>
          ) : (
            <ErrorBanner error={commitError} fallbackTitle="Не удалось перенести запись" />
          )}
          {race && (
            <button className="btn btn-secondary" type="button" onClick={() => void onRaceRetry()}>
              Выбрать другой вариант
            </button>
          )}
        </div>
      )}

      {confirming && selected && (
        <section className="reschedule-confirm stack" data-testid="reschedule-confirm">
          <h3>Перенести запись?</h3>
          <p>
            {slotDateTimeLabel(appointment.starts_at, tz)}
            <span className="muted"> → </span>
            {slotDateTimeLabel(selected.starts_at, tz)}
          </p>
          <div className="row">
            <button
              className="btn btn-secondary"
              type="button"
              disabled={commit.isPending}
              onClick={() => {
                setConfirming(false)
                setSelected(null)
              }}
            >
              Отмена
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={commit.isPending}
              onClick={() => commit.mutate(selected)}
            >
              {commit.isPending ? 'Переносим…' : 'Перенести'}
            </button>
          </div>
        </section>
      )}
    </div>
  )

  const inner = !eligible ? (
    <ErrorBanner
      error={{ code: 'appointment_not_reschedulable', status: 409, message: 'fixed_window' }}
    />
  ) : (
    body
  )

  const title = 'Перенести запись'
  if (compact) {
    return (
      <Drawer open={open} onClose={onClose} title={title} label={title} panelClassName="reschedule-drawer-panel">
        {inner}
      </Drawer>
    )
  }
  return (
    <Modal open={open} onClose={onClose} title={title} label={title} size="md">
      {inner}
    </Modal>
  )
}
