import type { ReactNode } from 'react'

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string
  text?: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {text ? <p>{text}</p> : null}
      {action}
    </div>
  )
}
