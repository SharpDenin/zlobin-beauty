import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/shared/ui/Modal'
import { Drawer } from '@/shared/ui/Drawer'
import {
  buildHalfHourSlots,
  minutesFromMidnight,
  minutesToHHMM,
  snapMinutes,
  zonedYmd,
} from '@/pages/calendar-helpers'

type Props = {
  open: boolean
  mode: 'move' | 'copy'
  multiDay?: boolean
  title: string
  timezone: string
  initialStart: Date
  durationMinutes: number
  compact?: boolean
  onClose: () => void
  onConfirm: (targets: Array<{ day: string; startMin: number }>) => void | Promise<void>
  busy?: boolean
}

const SLOT_FROM = 6 * 60
const SLOT_TO = 22 * 60

function useCompactSurface(forced?: boolean) {
  const [auto, setAuto] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : true,
  )
  useEffect(() => {
    if (forced != null) return
    const mq = window.matchMedia('(max-width: 767px)')
    const onChange = () => setAuto(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [forced])
  return forced ?? auto
}

function formatDayLabel(ymd: string) {
  const [y, mo, d] = ymd.split('-').map(Number)
  const local = new Date(y, mo - 1, d, 12)
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }).format(local)
}

export function CalendarMoveCopyDialog({
  open,
  mode,
  multiDay = false,
  title,
  timezone,
  initialStart,
  durationMinutes,
  compact: compactProp,
  onClose,
  onConfirm,
  busy,
}: Props) {
  const compact = useCompactSurface(compactProp)
  const [day, setDay] = useState(() => zonedYmd(initialStart, timezone))
  const [startMin, setStartMin] = useState(() => snapMinutes(minutesFromMidnight(initialStart, timezone), 30))
  const [extraDays, setExtraDays] = useState<string[]>([])

  const timeSlots = useMemo(() => buildHalfHourSlots(SLOT_FROM, SLOT_TO), [])

  useEffect(() => {
    if (!open) return
    setDay(zonedYmd(initialStart, timezone))
    setStartMin(snapMinutes(minutesFromMidnight(initialStart, timezone), 30))
    setExtraDays([])
  }, [open, initialStart, timezone])

  const confirmLabel = mode === 'move' ? 'Перенести' : 'Копировать'

  async function submit() {
    const primary = { day, startMin }
    const targets = multiDay && mode === 'copy' ? [primary, ...extraDays.map((d) => ({ day: d, startMin }))] : [primary]
    await onConfirm(targets)
  }

  function addExtraDay(ymd: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return
    if (ymd === day || extraDays.includes(ymd)) return
    setExtraDays((prev) => [...prev, ymd].sort())
  }

  function removeExtraDay(ymd: string) {
    setExtraDays((prev) => prev.filter((d) => d !== ymd))
  }

  const body = (
    <div className="stack gap cal-move-copy-body" data-testid="calendar-move-copy">
      <p className="muted" style={{ margin: 0 }}>
        Длительность: {durationMinutes} мин
      </p>

      <label className="field stack gap-1">
        <span>День</span>
        <input
          type="date"
          className="input"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          disabled={busy}
        />
      </label>

      <label className="field stack gap-1">
        <span>Время</span>
        <select
          className="input"
          value={startMin}
          onChange={(e) => setStartMin(Number(e.target.value))}
          disabled={busy}
        >
          {timeSlots.map((m) => (
            <option key={m} value={m}>
              {minutesToHHMM(m)}
            </option>
          ))}
        </select>
      </label>

      {multiDay && mode === 'copy' ? (
        <div className="stack gap-2">
          <span className="field-label">Дополнительные дни</span>
          <div className="row gap wrap">
            <input
              type="date"
              className="input"
              aria-label="Добавить день копирования"
              onChange={(e) => {
                addExtraDay(e.target.value)
                e.target.value = ''
              }}
              disabled={busy}
            />
          </div>
          {extraDays.length > 0 ? (
            <ul className="cal-move-copy-days" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {extraDays.map((d) => (
                <li key={d} className="row between gap" style={{ padding: '6px 0' }}>
                  <span>{formatDayLabel(d)}</span>
                  <button type="button" className="btn btn-ghost btn-compact" onClick={() => removeExtraDay(d)} disabled={busy}>
                    Убрать
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              Выберите даты — блок скопируется на основной и дополнительные дни.
            </p>
          )}
        </div>
      ) : null}

      <div className="row gap end">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
          {busy ? '…' : confirmLabel}
        </button>
      </div>
    </div>
  )

  if (compact) {
    return (
      <Drawer open={open} onClose={onClose} title={title} showClose>
        {body}
      </Drawer>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" showClose>
      {body}
    </Modal>
  )
}