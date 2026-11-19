import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CUTTING_TECHNIQUE_CATALOG, normalizeCuttingTechniques } from '@/shared/lib/cutting-techniques'

type Props = {
  value: string[]
  onChange: (tags: string[]) => void
  error?: string
  disabled?: boolean
}

export function CuttingTechniquePicker({ value, onChange, error, disabled = false }: Props) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const selected = useMemo(() => normalizeCuttingTechniques(value), [value])
  const selectedKeys = useMemo(
    () => new Set(selected.map((t) => t.toLocaleLowerCase('ru'))),
    [selected],
  )

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

  function toggle(tag: string) {
    const key = tag.toLocaleLowerCase('ru')
    if (selectedKeys.has(key)) {
      onChange(selected.filter((t) => t.toLocaleLowerCase('ru') !== key))
      return
    }
    onChange(normalizeCuttingTechniques([...selected, tag]))
  }

  function remove(tag: string) {
    const key = tag.toLocaleLowerCase('ru')
    onChange(selected.filter((t) => t.toLocaleLowerCase('ru') !== key))
  }

  return (
    <div className="field specialization-picker" ref={rootRef} data-testid="cutting-technique-picker">
      <span id={`${listId}-label`}>Техника стрижки</span>
      <p className="muted">Необязательно. Можно выбрать несколько техник; на публикацию профиля не влияет.</p>

      {selected.length > 0 && (
        <div className="chip-row specialization-picker-chips" role="list" aria-label="Выбранные техники">
          {selected.map((tag) => (
            <button
              key={tag}
              type="button"
              className="chip specialization-chip is-selected"
              role="listitem"
              disabled={disabled}
              data-testid={`cut-chip-${tag}`}
              onClick={() => remove(tag)}
              aria-label={`Удалить ${tag}`}
            >
              {tag}
              <span aria-hidden="true"> ×</span>
            </button>
          ))}
        </div>
      )}

      <div className="specialization-picker-control">
        <button
          type="button"
          className="btn btn-secondary specialization-picker-trigger"
          data-testid="cutting-technique-picker-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${listId}-label`}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Скрыть список' : 'Добавить технику'}
        </button>

        {open && (
          <ul
            className="specialization-picker-menu glass-panel"
            role="listbox"
            aria-multiselectable="true"
            data-testid="cutting-technique-picker-menu"
          >
            {CUTTING_TECHNIQUE_CATALOG.map((tag) => {
              const checked = selectedKeys.has(tag.toLocaleLowerCase('ru'))
              return (
                <li key={tag} role="option" aria-selected={checked}>
                  <button
                    type="button"
                    className={`specialization-option${checked ? ' is-selected' : ''}`}
                    data-testid={`cut-option-${tag}`}
                    onClick={() => toggle(tag)}
                  >
                    <span className="specialization-option-check" aria-hidden="true">
                      {checked ? '✓' : ''}
                    </span>
                    <span>{tag}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {error && <span className="error">{error}</span>}
    </div>
  )
}
