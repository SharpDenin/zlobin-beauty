import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'

/** Shared so auth can drop every cached (possibly private) result when the session ends. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // One retry for transient failures only: a 4xx will fail the same way again.
      retry: (failureCount, error) => failureCount < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
})
