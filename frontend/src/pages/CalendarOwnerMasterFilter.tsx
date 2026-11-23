import { useEffect, useId, useRef, useState } from 'react'
import type { MasterCol } from '@/pages/CalendarMastersDay'

type Props = {
  masters: MasterCol[]
  /** null = all masters of the branch */
  selectedIds: string[] | null
  onChange: (next: string[] | null) => void
}

export function CalendarOwnerMasterFilter({ masters, selectedIds, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()
  const allSelected = selectedIds == null
  const selectedSet = allSelected ? null : new Set(selectedIds)

  const label = (() => {
    if (allSelected || masters.length === 0) return 'Все мастера'
    if (selectedIds!.length === 0) return 'Никого не выбрано'
    if (selectedIds!.length === 1) {
      return masters.find((m) => m.userId === selectedIds![0])?.name ?? '1 мастер'
    }
    return `Мастера: ${selectedIds!.length}`
  })()

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggleAll() {
    onChange(null)
  }

  function toggleOne(id: string) {
    if (allSelected) {
      // Explicit single pick from «Все» — needed so «График» can target that master.
      onChange([id])
      return
    }
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    // Do not collapse a full individual selection back to null: only «Все мастера» does.
    // Otherwise a 1-master branch could never express «exactly one» for ScheduleEditor.
    onChange([...next])
  }

  return (
    <div className="cal-owner-master-filter" ref={rootRef} data-testid="calendar-owner-master-filter">
      <button
        type="button"
        className="btn btn-secondary btn-compact cal-owner-master-filter-trigger cal-touch"
        aria-expanded={open}
        aria-controls={listId}
        data-testid="calendar-owner-master-filter-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open ? (
        <div className="cal-owner-master-filter-panel glass-panel" id={listId} role="group" aria-label="Фильтр мастеров">
          <label className="cal-owner-master-filter-option">
            <input
              type="checkbox"
              checked={allSelected}
              data-testid="calendar-owner-master-all"
              onChange={toggleAll}
            />
            <span>Все мастера</span>
          </label>
          {masters.map((m) => {
            const checked = allSelected || Boolean(selectedSet?.has(m.userId))
            return (
              <label key={m.userId} className="cal-owner-master-filter-option">
                <input
                  type="checkbox"
                  checked={checked}
                  data-testid={`calendar-owner-master-${m.userId}`}
                  onChange={() => toggleOne(m.userId)}
                />
                <span>{m.name}</span>
              </label>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
