import { useSyncExternalStore } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { useEffect } from 'react'
import { AppIcon } from '@/shared/ui/AppIcon'
import {
  canGoBackInApp,
  isMainNavPath,
  subscribeNavHistory,
  trackNavHistory,
  getNavHistoryDepth,
} from '@/shared/lib/nav-history'

/** Mount once under the router to count in-app PUSH/POP depth. */
export function NavHistoryTracker() {
  const location = useLocation()
  const navType = useNavigationType()

  useEffect(() => {
    trackNavHistory(navType, location.key)
  }, [location.key, navType])

  return null
}

function useCanGoBack() {
  return useSyncExternalStore(subscribeNavHistory, canGoBackInApp, () => false)
}

type BackButtonProps = {
  /** Force show/hide; default hides on main destinations and when there is no in-app history. */
  force?: boolean
  className?: string
  label?: string
}

export function BackButton({ force, className, label = 'Назад' }: BackButtonProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const canGo = useCanGoBack()

  if (force === false) return null
  if (!canGo) return null
  if (force !== true && isMainNavPath(location.pathname)) return null

  return (
    <button
      type="button"
      className={`btn btn-ghost btn-compact btn-back${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      data-testid="back-button"
      onClick={() => {
        if (getNavHistoryDepth() > 0) navigate(-1)
      }}
    >
      <AppIcon name="chevronLeft" size={18} className="btn-back-icon" />
      <span className="btn-back-label">{label}</span>
    </button>
  )
}
