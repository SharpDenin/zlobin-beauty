import { useId, type InputHTMLAttributes } from 'react'
import { AppIcon } from '@/shared/ui/AppIcon'

export type SearchFieldProps = {
  value: string
  onChange: (value: string) => void
  /** Shown above the control when provided. */
  label?: string
  placeholder?: string
  /** Clears value; when omitted but clearable, calls onChange(''). */
  onClear?: () => void
  clearable?: boolean
  disabled?: boolean
  loading?: boolean
  className?: string
  inputClassName?: string
  id?: string
  name?: string
  'aria-label'?: string
  'data-testid'?: string
  autoComplete?: string
  enterKeyHint?: InputHTMLAttributes<HTMLInputElement>['enterKeyHint']
  type?: 'search' | 'text'
  onKeyDown?: InputHTMLAttributes<HTMLInputElement>['onKeyDown']
}

/**
 * Shared search control for Search / Shop / Knowledge / Contacts / Clients.
 * Does not own debounce or query APIs — parents keep that logic.
 */
export function SearchField({
  value,
  onChange,
  label,
  placeholder = 'Поиск',
  onClear,
  clearable = false,
  disabled = false,
  loading = false,
  className,
  inputClassName,
  id,
  name,
  'aria-label': ariaLabel,
  'data-testid': testId,
  autoComplete = 'off',
  enterKeyHint = 'search',
  type = 'search',
  onKeyDown,
}: SearchFieldProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const showClear = clearable && Boolean(value) && !disabled

  function handleClear() {
    if (onClear) onClear()
    else onChange('')
  }

  return (
    <div className={['search-field', className].filter(Boolean).join(' ')} data-loading={loading || undefined}>
      {label ? (
        <label className="search-field__label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <div className="search-field__control">
        <span className="search-field__icon" aria-hidden="true">
          <AppIcon name="search" size={18} />
        </span>
        <input
          id={inputId}
          name={name}
          className={['search-field__input', inputClassName].filter(Boolean).join(' ')}
          type={type}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={autoComplete}
          enterKeyHint={enterKeyHint}
          aria-label={ariaLabel ?? (label ? undefined : placeholder)}
          aria-busy={loading || undefined}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {loading ? (
          <span className="search-field__spinner" aria-hidden="true" />
        ) : showClear ? (
          <button
            className="search-field__clear"
            type="button"
            aria-label="Очистить поиск"
            onClick={handleClear}
          >
            <AppIcon name="x" size={16} />
          </button>
        ) : null}
      </div>
    </div>
  )
}
