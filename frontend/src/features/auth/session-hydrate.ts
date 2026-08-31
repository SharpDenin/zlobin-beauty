import { ApiError } from '@/shared/api/client'
import { isNetworkError } from '@/shared/lib/app-error'

export function isUnauthorizedSessionError(error: unknown): boolean {
  if (isNetworkError(error)) return false
  if (!(error instanceof ApiError)) return false
  return error.status === 401 || error.status === 403 || error.code === 'unauthorized' || error.code === 'session_expired'
}

export function decideHydrateFailure(meError: unknown, refreshError: unknown | null): 'keep' | 'expire' {
  if (refreshError == null) {
    return isNetworkError(meError) || !isUnauthorizedSessionError(meError) ? 'keep' : 'expire'
  }
  if (isNetworkError(refreshError)) return 'keep'
  if (isUnauthorizedSessionError(refreshError) || isUnauthorizedSessionError(meError)) return 'expire'
  return 'keep'
}
