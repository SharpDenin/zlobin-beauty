import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isChunkLoadFailure } from '@/features/pwa/pwa'

type Props = { children: ReactNode }
type State = { crashed: boolean; stale: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false, stale: false }

  static getDerivedStateFromError(error: Error): State {
    return { crashed: true, stale: isChunkLoadFailure(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.warn('[error-boundary]', error, info.componentStack)
      return
    }
    console.error('[error-boundary]', error.name)
  }

  render() {
    if (!this.state.crashed) return this.props.children
    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary__card">
          <h1>{this.state.stale ? 'Доступна новая версия' : 'Что-то пошло не так'}</h1>
          <p>
            {this.state.stale
              ? 'Обновите страницу, чтобы загрузить актуальную версию приложения.'
              : 'Попробуйте обновить страницу.'}
          </p>
          <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
            Обновить страницу
          </button>
        </div>
      </div>
    )
  }
}
