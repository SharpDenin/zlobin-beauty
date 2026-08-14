import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type ToastKind = 'info' | 'success' | 'error'

export type ToastInput = {
  message: string
  kind?: ToastKind
  durationMs?: number
}

type ToastItem = Required<ToastInput> & { id: string }

type ToastContextValue = {
  push: (input: ToastInput | string) => void
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

type Listener = (input: ToastInput) => void
const listeners = new Set<Listener>()

/** Fire-and-forget toast from outside React (light emit pattern). */
export function toast(input: ToastInput | string) {
  const payload: ToastInput = typeof input === 'string' ? { message: input } : input
  listeners.forEach((fn) => fn(payload))
}

toast.success = (message: string) => toast({ message, kind: 'success' })
toast.error = (message: string) => toast({ message, kind: 'error' })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((input: ToastInput | string) => {
    const payload = typeof input === 'string' ? { message: input } : input
    const item: ToastItem = {
      id: crypto.randomUUID(),
      message: payload.message,
      kind: payload.kind ?? 'info',
      durationMs: payload.durationMs ?? 4200,
    }
    setItems((prev) => [...prev.slice(-4), item])
  }, [])

  useEffect(() => {
    const listener: Listener = (input) => push(input)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [push])

  useEffect(() => {
    if (items.length === 0) return
    const timers = items.map((item) =>
      window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== item.id))
      }, item.durationMs),
    )
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [items])

  const value = useMemo<ToastContextValue>(() => ({
    push,
    success: (message) => push({ message, kind: 'success' }),
    error: (message) => push({ message, kind: 'error' }),
  }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-relevant="additions">
        {items.map((item) => (
          <div
            key={item.id}
            className={`toast toast--${item.kind}`}
            role={item.kind === 'error' ? 'alert' : 'status'}
          >
            <span>{item.message}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="Закрыть уведомление"
              onClick={() => setItems((prev) => prev.filter((t) => t.id !== item.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('ToastProvider missing')
  return ctx
}
