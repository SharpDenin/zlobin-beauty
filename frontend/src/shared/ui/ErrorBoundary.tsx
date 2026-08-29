import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { crashed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false }

  static getDerivedStateFromError(): State {
    return { crashed: true }
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
          <h1>Что-то пошло не так</h1>
          <p>Попробуйте обновить страницу.</p>
          <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
            Обновить страницу
          </button>
        </div>
      </div>
    )
  }
}
