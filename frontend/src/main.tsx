import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import {
  HOME_BACKGROUNDS,
  applyStoredBackground,
  preloadWallpaperSrc,
  restoreWallpaperScopeFromStorage,
} from './shared/theme/backgrounds'
import { ThemeProvider } from './shared/theme/ThemeProvider'
import { installPinchZoomGuard } from './shared/lib/disablePinchZoom'
import './shared/ui/styles.css'

restoreWallpaperScopeFromStorage()
applyStoredBackground()
// Kick image decode early (auth routes share the same global wallpaper).
for (const bg of HOME_BACKGROUNDS) {
  void preloadWallpaperSrc(bg.src)
}
installPinchZoomGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
