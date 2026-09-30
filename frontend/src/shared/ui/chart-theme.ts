/** Chart colors follow the active theme through CSS variables. */
export const CHART = {
  accent: 'var(--color-primary)',
  accentSoft: 'var(--color-primary-muted)',
  gold: 'var(--color-primary-soft)',
  clay: 'var(--color-text-secondary)',
  muted: 'var(--color-text-secondary)',
  info: 'var(--color-info)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  grid: 'var(--color-border)',
  text: 'var(--color-text-secondary)',
  surface: 'var(--color-surface)',
  surface2: 'var(--color-surface-2)',
  tooltipText: 'var(--color-text-primary)',
}

export const CHART_SERIES = [CHART.accent, CHART.gold, CHART.clay, CHART.info, CHART.muted]
