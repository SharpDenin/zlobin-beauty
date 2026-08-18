/** Safe href for article links. Rejects javascript:/data:/vbscript: and unknown schemes. */
export function sanitizeHref(href: string | null | undefined): string | null {
  if (!href) return null
  const trimmed = href.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return null
  }
  if (
    lower.startsWith('https://') ||
    lower.startsWith('http://') ||
    lower.startsWith('mailto:') ||
    trimmed.startsWith('/')
  ) {
    return trimmed
  }
  return null
}

/** Media src must be same-origin media API or https. */
export function sanitizeMediaSrc(src: string | null | undefined): string | null {
  if (!src) return null
  const trimmed = src.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return null
  }
  if (lower.startsWith('https://') || lower.startsWith('http://') || trimmed.startsWith('/')) {
    return trimmed
  }
  return null
}
