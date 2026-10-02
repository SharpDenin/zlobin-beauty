import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import type { ProfessionType } from '@/shared/lib/profession-types'

export function useProfessionTypes() {
  return useQuery({
    queryKey: ['profession-types'],
    queryFn: () => apiRequest<{ items: ProfessionType[] }>('/v1/profession-types'),
    staleTime: 5 * 60_000,
  })
}

type Props = {
  value: string[]
  lockedIds?: string[]
  onChange: (ids: string[]) => void
  error?: string
}

export function ProfessionTypePicker({ value, lockedIds = [], onChange, error }: Props) {
  const types = useProfessionTypes()
  const selected = new Set(value)
  const locked = new Set(lockedIds)

  return (
    <div className="field">
      <span className="required-mark">Тип мастера</span>
      <p className="muted">Можно выбрать несколько. Это не формат занятости и не режим записи.</p>
      {types.isLoading && <p className="muted">Загрузка типов…</p>}
      {types.isError && <p className="error">Не удалось загрузить справочник типов</p>}
      <div className="check-grid" role="group" aria-required="true">
        {(types.data?.items ?? []).map((t) => {
          const checked = selected.has(t.id)
          const isLocked = locked.has(t.id) && checked
          return (
            <label key={t.id} className="field-check">
              <input
                type="checkbox"
                checked={checked}
                disabled={isLocked}
                onChange={(e) => {
                  if (e.target.checked) onChange([...value, t.id])
                  else onChange(value.filter((id) => id !== t.id))
                }}
              />
              <span>{t.name}</span>
            </label>
          )
        })}
      </div>
      {error && <span className="error">{error}</span>}
    </div>
  )
}
