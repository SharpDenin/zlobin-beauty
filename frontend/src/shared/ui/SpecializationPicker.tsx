import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { specializationsForSlugs, uniqueSpecializationTags } from '@/shared/lib/master-specializations'

type Props = {
  /** Profession type slugs that drive the available catalog. */
  professionSlugs: string[]
  value: string[]
  onChange: (tags: string[]) => void
  error?: string
  disabled?: boolean
}

export function SpecializationPicker({
  professionSlugs,
  value,
  onChange,
  error,
  disabled = false,
}: Props) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const selected = useMemo(() => uniqueSpecializationTags(value), [value])
  const selectedKeys = useMemo(
    () => new Set(selected.map((t) => t.toLocaleLowerCase('ru'))),
    [selected],
  )
  const options = useMemo(() => specializationsForSlugs(professionSlugs), [professionSlugs])

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
    onChange([...selected, tag])
  }

  function remove(tag: string) {
    const key = tag.toLocaleLowerCase('ru')
    onChange(selected.filter((t) => t.toLocaleLowerCase('ru') !== key))
  }

  const noTypes = professionSlugs.length === 0
  const emptyCatalog = !noTypes && options.length === 0

  return (
    <div className="field specialization-picker" ref={rootRef} data-testid="specialization-picker">
      <span className="required-mark" id={`${listId}-label`}>
        Специализации
      </span>
      <p className="muted">
        Выберите теги из списка для вашего типа мастера. Можно отметить несколько.
      </p>

      {selected.length > 0 && (
        <div className="chip-row specialization-picker-chips" role="list" aria-label="Выбранные специализации">
          {selected.map((tag) => (
            <button
              key={tag}
              type="button"
              className="chip specialization-chip is-selected"
              role="listitem"
              disabled={disabled}
              data-testid={`spec-chip-${tag}`}
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
          data-testid="specialization-picker-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${listId}-label`}
          disabled={disabled || noTypes || emptyCatalog}
          onClick={() => setOpen((v) => !v)}
        >
          {noTypes
            ? 'Сначала выберите тип мастера'
            : emptyCatalog
              ? 'Нет доступных специализаций'
              : open
                ? 'Скрыть список'
                : 'Добавить специализацию'}
        </button>

        {open && options.length > 0 && (
          <ul
            className="specialization-picker-menu glass-panel"
            role="listbox"
            aria-multiselectable="true"
            data-testid="specialization-picker-menu"
          >
            {options.map((tag) => {
              const checked = selectedKeys.has(tag.toLocaleLowerCase('ru'))
              return (
                <li key={tag} role="option" aria-selected={checked}>
                  <button
                    type="button"
                    className={`specialization-option${checked ? ' is-selected' : ''}`}
                    data-testid={`spec-option-${tag}`}
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
