import { tokens } from '@/shared/ui/tokens'

export const CHART = {
  accent: tokens.color.primary,
  accentSoft: tokens.color.primaryMuted,
  gold: tokens.color.primarySoft,
  clay: tokens.color.textSecondary,
  muted: '#6B7385',
  info: tokens.color.info,
  success: tokens.color.success,
  warning: tokens.color.warning,
  danger: tokens.color.danger,
  grid: tokens.color.surface2,
  text: tokens.color.textSecondary,
}

export const CHART_SERIES = [CHART.accent, CHART.gold, CHART.clay, CHART.muted, '#4A5163']
