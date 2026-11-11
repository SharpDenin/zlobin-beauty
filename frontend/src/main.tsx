import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { applyStoredBackground, restoreWallpaperScopeFromStorage } from './shared/theme/backgrounds'
import { ThemeProvider } from './shared/theme/ThemeProvider'
import { installPinchZoomGuard } from './shared/lib/disablePinchZoom'
import './shared/ui/styles.css'

restoreWallpaperScopeFromStorage()
applyStoredBackground()
installPinchZoomGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
