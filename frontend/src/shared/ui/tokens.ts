/** MIDNIGHT / SIGNAL — JS tokens. Keep in sync with styles.css :root and docs/DESIGN_SYSTEM.md */
export const tokens = {
  color: {
    background: '#0B0D12',
    backgroundElevated: '#10131A',
    surface: '#141821',
    surfaceElevated: '#10131A',
    surface2: '#1D2230',
    surfaceSecondary: '#1D2230',
    surface3: '#252B3B',
    textPrimary: '#F5F7FA',
    textSecondary: '#B8BFC9',
    textTertiary: '#8B93A3',
    primary: '#7C82FF',
    primaryHover: '#A8ACFF',
    primarySoft: '#A8ACFF',
    primaryMuted: 'rgba(124, 130, 255, 0.16)',
    primaryInk: '#0B0D12',
    accent: '#7C82FF',
    accentHover: '#A8ACFF',
    accentSoft: 'rgba(124, 130, 255, 0.16)',
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
    xs: 8,
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
  /** Global wallpaper CSS vars — keep in sync with styles.css `:root`. */
  appBackground: {
    image: "url('/backgrounds/forest-water.jpg')",
    overlay:
      'linear-gradient(180deg, color-mix(in srgb, #0B0D12 22%, transparent) 0%, color-mix(in srgb, #0B0D12 34%, transparent) 48%, color-mix(in srgb, #0B0D12 42%, transparent) 100%)',
    position: 'center',
    size: 'cover',
  },
  /**
   * Glass Design System (dark defaults).
   * Primary blur lives on `body::after` (`lensBlur`); panels/chrome use fills only.
   * CSS is source of truth for theme switching via `html[data-theme]`.
   */
  glass: {
    lensFill: 'color-mix(in srgb, #0B0D12 46%, transparent)',
    lensFillFallback: 'color-mix(in srgb, #0B0D12 78%, transparent)',
    lensBlur: '22px',
    fillSubtle: 'color-mix(in srgb, #0C1A18 28%, transparent)',
    fill: 'color-mix(in srgb, #0B1614 70%, transparent)',
    fillStrong: 'color-mix(in srgb, #0A1211 84%, transparent)',
    chromeFill: 'color-mix(in srgb, #0B1614 76%, transparent)',
    controlFill: 'color-mix(in srgb, #0B1614 86%, transparent)',
    workFill: 'color-mix(in srgb, #0B1614 82%, transparent)',
    fillSubtleFallback: 'color-mix(in srgb, #0C1A18 90%, transparent)',
    fillFallback: 'color-mix(in srgb, #0B1614 94%, transparent)',
    fillStrongFallback: 'color-mix(in srgb, #0A1211 97%, transparent)',
    chromeFillFallback: 'color-mix(in srgb, #0B1614 95%, transparent)',
    controlFillFallback: 'color-mix(in srgb, #0B1614 97%, transparent)',
    workFillFallback: 'color-mix(in srgb, #0B1614 96%, transparent)',
    blurSubtle: '0px',
    blur: '0px',
    blurStrong: '18px',
    border: 'color-mix(in srgb, #7C82FF 26%, rgba(245, 247, 250, 0.08))',
    borderStrong: 'color-mix(in srgb, #7C82FF 40%, rgba(245, 247, 250, 0.12))',
    shadow: '0 1px 2px rgba(0, 0, 0, 0.28), 0 8px 24px rgba(0, 0, 0, 0.18)',
    shadowStrong: '0 4px 12px rgba(0, 0, 0, 0.32), 0 16px 40px rgba(0, 0, 0, 0.28)',
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
