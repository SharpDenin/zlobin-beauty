/** MIDNIGHT / SIGNAL — JS tokens. Keep in sync with styles.css :root and docs/DESIGN_SYSTEM.md */
export const tokens = {
  color: {
    background: '#0B0D12',
    surface: '#141821',
    surface2: '#1D2230',
    textPrimary: '#F5F7FA',
    textSecondary: '#9EA6B5',
    primary: '#7C82FF',
    primarySoft: '#A8ACFF',
    primaryMuted: 'rgba(124, 130, 255, 0.16)',
    success: '#5DC08B',
    warning: '#FFB020',
    danger: '#EF7777',
  },
  radius: {
    sm: 10,
    md: 14,
    lg: 18,
    pill: 9999,
  },
} as const

export type DesignTokens = typeof tokens
