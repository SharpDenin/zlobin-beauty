import { minutesToHHMM, parseHHMM } from '@/pages/calendar-helpers'

/** Half-hour options including 24:00. Native `input[type=time]` does not shrink on iOS. */
export const TIME_SELECT_OPTIONS = Array.from({ length: 49 }, (_, i) => minutesToHHMM(i * 30))

export function timeSelectOptions(current: string, stepMinutes = 30) {
  const base =
    stepMinutes === 30
      ? TIME_SELECT_OPTIONS
      : Array.from({ length: Math.floor((24 * 60) / stepMinutes) + 1 }, (_, i) => minutesToHHMM(i * stepMinutes))
  if (!current || base.includes(current)) return base
  return [...base, current].sort((a, b) => (parseHHMM(a) ?? 0) - (parseHHMM(b) ?? 0))
}

type TimeSelectProps = {
  id?: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  'aria-required'?: boolean
  className?: string
  stepMinutes?: number
}

/**
 * Compact time control that fits side-by-side field pairs on iPhone.
 * Prefer this over `input[type=time]` whenever two times share one row.
 */
export function TimeSelect({
  id,
  value,
  onChange,
  disabled,
  'aria-required': ariaRequired,
  className,
  stepMinutes = 30,
}: TimeSelectProps) {
  return (
    <select
      id={id}
      className={['time-select', className].filter(Boolean).join(' ')}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-required={ariaRequired}
    >
      {timeSelectOptions(value, stepMinutes).map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  )
}
