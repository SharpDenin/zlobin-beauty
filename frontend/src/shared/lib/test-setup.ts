import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW() {
    return {
      needRefresh: [false, () => {}],
      offlineReady: [false, () => {}],
      updateServiceWorker: async () => {},
    }
  },
}))
