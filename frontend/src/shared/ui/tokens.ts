/** MIDNIGHT / SIGNAL — JS tokens. Keep in sync with styles.css :root and docs/DESIGN_SYSTEM.md */
export const tokens = {
  color: {
    background: '#0B0D12',
    backgroundElevated: '#10131A',
    surface: '#141821',
    surface2: '#1D2230',
    surface3: '#252B3B',
    textPrimary: '#F5F7FA',
    textSecondary: '#9EA6B5',
    primary: '#7C82FF',
    primarySoft: '#A8ACFF',
    primaryMuted: 'rgba(124, 130, 255, 0.16)',
    primaryInk: '#0B0D12',
    success: '#5DC08B',
    warning: '#FFB020',
    danger: '#EF7777',
    info: '#8B9BC7',
    overlay: 'rgba(11, 13, 18, 0.72)',
    glow: 'rgba(124, 130, 255, 0.22)',
  },
  gradient: {
    canvas:
      'radial-gradient(1200px 640px at 12% -10%, rgba(124, 130, 255, 0.14), transparent 58%), radial-gradient(900px 520px at 92% 8%, rgba(168, 172, 255, 0.08), transparent 52%), #0B0D12',
    hero:
      'radial-gradient(80% 120% at 100% 0%, rgba(124, 130, 255, 0.18), transparent 62%), linear-gradient(180deg, #1D2230 0%, #141821 100%)',
    primaryButton: 'linear-gradient(180deg, #A8ACFF 0%, #7C82FF 100%)',
    imageFallback:
      'linear-gradient(145deg, rgba(124, 130, 255, 0.18) 0%, #1D2230 48%, #141821 100%)',
    ownerStart:
      'radial-gradient(920px 560px at 12% -8%, rgba(46, 140, 128, 0.42), transparent 58%), radial-gradient(720px 480px at 96% 6%, rgba(93, 192, 139, 0.18), transparent 52%), linear-gradient(180deg, #0c1a1c 0%, #0B0D12 78%)',
  },
  radius: {
    sm: 10,
    md: 14,
    lg: 18,
    pill: 9999,
  },
  shadow: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.35)',
    md: '0 10px 28px rgba(0, 0, 0, 0.42)',
    lg: '0 20px 48px rgba(0, 0, 0, 0.52)',
    glow: '0 0 0 1px rgba(124, 130, 255, 0.18), 0 12px 32px rgba(124, 130, 255, 0.12)',
  },
  motion: {
    fast: '120ms',
    normal: '200ms',
    emphasized: '280ms',
    ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  },
  z: {
    sticky: 20,
    dropdown: 30,
    drawer: 40,
    modal: 50,
    toast: 80,
  },
  breakpoint: {
    phone: 390,
    tablet: 768,
    laptop: 1024,
    desktop: 1440,
  },
} as const

export type DesignTokens = typeof tokens
