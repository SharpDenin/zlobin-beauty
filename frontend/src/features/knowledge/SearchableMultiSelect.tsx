import { useMemo, useState } from 'react'

type Option = { value: string; label: string }

type Props = {
  id: string
  label: string
  options: Option[]
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}

export function SearchableMultiSelect({ id, label, options, values, onChange, placeholder }: Props) {
  const [q, setQ] = useState('')
  const selected = useMemo(
    () => values.map((v) => options.find((o) => o.value === v) ?? { value: v, label: v }),
    [values, options],
  )
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return options
      .filter((o) => !values.includes(o.value))
      .filter((o) => !needle || o.label.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle))
      .slice(0, 12)
  }, [options, values, q])

  return (
    <div className="field kb-multiselect">
      <label htmlFor={id}>{label}</label>
      {selected.length > 0 && (
        <div className="chip-row">
          {selected.map((s) => (
            <button
              key={s.value}
              type="button"
              className="chip active"
              onClick={() => onChange(values.filter((v) => v !== s.value))}
            >
              {s.label} ×
            </button>
          ))}
        </div>
      )}
      <input
        id={id}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder ?? 'Поиск…'}
        autoComplete="off"
      />
      {filtered.length > 0 && (
        <ul className="kb-suggest">
          {filtered.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                onClick={() => {
                  onChange([...values, o.value])
                  setQ('')
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
