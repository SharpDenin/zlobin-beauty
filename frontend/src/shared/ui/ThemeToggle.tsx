import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeChoice } from '@/shared/theme/theme'

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 3.5v1.8M12 18.7v1.8M4.9 4.9l1.3 1.3M17.8 17.8l1.3 1.3M3.5 12h1.8M18.7 12h1.8M4.9 19.1l1.3-1.3M17.8 6.2l1.3-1.3" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.5 4.5a7.2 7.2 0 1 0 4 12.2A7.8 7.8 0 0 1 15.5 4.5Z" />
    </svg>
  )
}

const options: Array<{ id: ThemeChoice; label: string; icon: typeof SunIcon }> = [
  { id: 'light', label: 'Светлая', icon: SunIcon },
  { id: 'dark', label: 'Тёмная', icon: MoonIcon },
]

export function ThemeToggle({ labelled = false }: { labelled?: boolean }) {
  const { theme, setTheme } = useTheme()
  return (
    <div className={`theme-toggle ${labelled ? 'theme-toggle--labelled' : ''}`} role="radiogroup" aria-label="Тема оформления">
      {options.map((option) => {
        const Icon = option.icon
        const selected = theme === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.id === 'light' ? 'Светлая тема' : 'Тёмная тема'}
            className={selected ? 'is-on' : ''}
            onClick={() => setTheme(option.id)}
          >
            <Icon />
            <span className={labelled ? 'theme-toggle-text' : 'sr-only'}>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
