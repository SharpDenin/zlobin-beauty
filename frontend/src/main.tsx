import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { applyStoredBackground } from './shared/theme/backgrounds'
import { ThemeProvider } from './shared/theme/ThemeProvider'
import './shared/ui/styles.css'

applyStoredBackground()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
