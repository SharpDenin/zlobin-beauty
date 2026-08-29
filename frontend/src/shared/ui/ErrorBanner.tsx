import { formatNormalized, normalizeError } from '@/shared/lib/app-error'

type Props = {
  error: unknown
  fallbackTitle?: string
}

export function ErrorBanner({ error, fallbackTitle }: Props) {
  if (error == null || error === false) return null
  if (typeof error === 'string') {
    if (!error.trim()) return null
    return (
      <div className="state-box error error-banner" role="alert">
        <p className="error-banner__text">{error}</p>
      </div>
    )
  }
  const n = normalizeError(error)
  const title = n.kind === 'unknown' && fallbackTitle ? fallbackTitle : n.title
  const hint = n.kind === 'unknown' && fallbackTitle ? 'Попробуйте ещё раз. Если проблема повторяется, обратитесь в поддержку.' : n.hint
  return (
    <div className="state-box error error-banner" role="alert">
      <strong className="error-banner__title">{title}</strong>
      {hint ? <p className="error-banner__hint">{hint}</p> : null}
    </div>
  )
}

export function formatBannerText(error: unknown, fallbackTitle?: string): string {
  if (typeof error === 'string') return error
  const n = normalizeError(error)
  const title = n.kind === 'unknown' && fallbackTitle ? fallbackTitle : n.title
  return formatNormalized({ ...n, title })
}
