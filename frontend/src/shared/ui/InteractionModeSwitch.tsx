import type { InteractionMode } from '@/shared/lib/cabinet'

/** Master ↔ client UI preference; does not change roles, formats, or membership. */
export function InteractionModeSwitch({
  mode,
  onChange,
  canUseMasterMode,
  compact = false,
}: {
  mode: InteractionMode
  onChange: (mode: InteractionMode) => void
  canUseMasterMode: boolean
  compact?: boolean
}) {
  if (!canUseMasterMode) return null

  return (
    <div
      className={`interaction-mode-switch${compact ? ' interaction-mode-switch--compact' : ''}`}
      data-testid="interaction-mode-switch"
    >
      {!compact && (
        <p className="muted interaction-mode-hint">
          Сейчас: {mode === 'master' ? 'режим мастера' : 'режим клиента'}. Права и форматы работы не меняются.
        </p>
      )}
      <div className="segmented segmented--2" role="radiogroup" aria-label="Режим интерфейса">
        <label className={mode === 'master' ? 'is-active' : ''}>
          <input
            type="radio"
            name="interaction-mode"
            value="master"
            checked={mode === 'master'}
            onChange={() => onChange('master')}
          />
          Мастер
        </label>
        <label className={mode === 'client' ? 'is-active' : ''}>
          <input
            type="radio"
            name="interaction-mode"
            value="client"
            checked={mode === 'client'}
            onChange={() => onChange('client')}
          />
          Клиент
        </label>
      </div>
    </div>
  )
}
