import {
  CANONICAL_WORK_TYPE_OPTIONS,
  uniqueCanonicalWorkTypes,
  type CanonicalWorkType,
} from '@/shared/lib/work-types'

export function WorkFormatPicker({
  value,
  onChange,
  allowChainOwner = false,
  error,
}: {
  value: string[]
  onChange: (next: CanonicalWorkType[]) => void
  allowChainOwner?: boolean
  error?: string
}) {
  const selected = new Set(uniqueCanonicalWorkTypes(value))
  const options = CANONICAL_WORK_TYPE_OPTIONS.filter((o) => allowChainOwner || o.value !== 'chain_owner')

  function toggle(v: CanonicalWorkType) {
    const next = new Set(selected)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    const ordered = options.map((o) => o.value).filter((id) => next.has(id))
    onChange(ordered.length ? ordered : ['independent'])
  }

  return (
    <fieldset className="stack-sm" data-testid="work-format-picker">
      <legend className="label-text">Формат работы</legend>
      <p className="muted">Можно выбрать несколько моделей. Это не профессия — специализация выбирается отдельно.</p>
      <div className="work-format-grid">
        {options.map((opt) => {
          const checked = selected.has(opt.value)
          return (
            <label key={opt.value} className={`work-format-option${checked ? ' is-selected' : ''}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          )
        })}
      </div>
      {error ? <span className="error" role="alert">{error}</span> : null}
    </fieldset>
  )
}
