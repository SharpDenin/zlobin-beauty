/** Reject a baked-in loopback API URL for production SPA builds. */

export function productionApiBaseRejected(url: string | undefined): boolean {
  if (!url) return false
  return /localhost|127\.0\.0\.1/i.test(url)
}

export function assertProductionApiBase(url: string | undefined, mode: string) {
  if (mode !== 'production') return
  if (productionApiBaseRejected(url)) {
    throw new Error(
      'Production build refuses to embed a localhost API URL. Unset VITE_API_BASE_URL for same-origin /v1, or set a public origin.',
    )
  }
}
