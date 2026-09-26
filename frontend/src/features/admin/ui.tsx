import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Drawer } from '@/shared/ui/Drawer'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Modal } from '@/shared/ui/Modal'

export function AdminSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="stack admin-skeleton" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton skeleton-card" />
      ))}
    </div>
  )
}

export function AdminPagination({ total, limit }: { total: number; limit: number }) {
  const [params, setParams] = useSearchParams()
  const offset = Number(params.get('offset') || 0)
  const page = Math.floor(offset / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))
  if (total <= limit) return null
  const go = (next: number) => {
    const nextParams = new URLSearchParams(params)
    nextParams.set('offset', String(Math.max(0, (next - 1) * limit)))
    setParams(nextParams)
  }
  return (
    <div className="row gap admin-pagination">
      <button type="button" className="btn btn-ghost" disabled={page <= 1} onClick={() => go(page - 1)}>
        Назад
      </button>
      <span className="muted">
        {page} / {pages}
      </span>
      <button type="button" className="btn btn-ghost" disabled={page >= pages} onClick={() => go(page + 1)}>
        Вперёд
      </button>
    </div>
  )
}

export function AdminFilterBar({
  children,
  onReset,
}: {
  children: ReactNode
  onReset: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="admin-filters-desktop">{children}</div>
      <div className="admin-filters-mobile">
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Фильтры
        </button>
        <button type="button" className="btn btn-ghost" onClick={onReset}>
          Сбросить
        </button>
      </div>
      <Drawer open={open} onClose={() => setOpen(false)} title="Фильтры">
        <div className="stack">{children}</div>
        <button type="button" className="btn btn-ghost" onClick={onReset}>
          Сбросить фильтры
        </button>
      </Drawer>
    </>
  )
}

export function SearchField({ placeholder }: { placeholder: string }) {
  const [params, setParams] = useSearchParams()
  const [value, setValue] = useState(params.get('q') ?? '')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next = new URLSearchParams(params)
    if (value.trim()) next.set('q', value.trim())
    else next.delete('q')
    next.delete('offset')
    setParams(next)
  }
  return (
    <form className="admin-search" onSubmit={submit}>
      <label className="sr-only" htmlFor="admin-search">
        Поиск
      </label>
      <input id="admin-search" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} />
      <button type="submit" className="btn">
        Найти
      </button>
    </form>
  )
}

export function SelectFilter({ name, label, options }: { name: string; label: string; options: { value: string; label: string }[] }) {
  const [params, setParams] = useSearchParams()
  return (
    <label className="stack-xs">
      <span>{label}</span>
      <select
        value={params.get(name) ?? ''}
        onChange={(e) => {
          const next = new URLSearchParams(params)
          if (e.target.value) next.set(name, e.target.value)
          else next.delete(name)
          next.delete('offset')
          setParams(next)
        }}
      >
        <option value="">Все</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function DateFilter({ name, label }: { name: string; label: string }) {
  const [params, setParams] = useSearchParams()
  const raw = params.get(name) ?? ''
  const value = raw.includes('T') ? raw.slice(0, 10) : raw
  return (
    <label className="stack-xs">
      <span>{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params)
          if (e.target.value) {
            const suffix = name === 'to' ? 'T23:59:59Z' : 'T00:00:00Z'
            next.set(name, `${e.target.value}${suffix}`)
          } else next.delete(name)
          next.delete('offset')
          setParams(next)
        }}
      />
    </label>
  )
}

export function TextFilter({ name, label, placeholder }: { name: string; label: string; placeholder?: string }) {
  const [params, setParams] = useSearchParams()
  return (
    <label className="stack-xs">
      <span>{label}</span>
      <input
        value={params.get(name) ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          const next = new URLSearchParams(params)
          if (e.target.value) next.set(name, e.target.value)
          else next.delete(name)
          next.delete('offset')
          setParams(next)
        }}
      />
    </label>
  )
}

export function ConfirmAction({
  open,
  title,
  text,
  reason,
  onReason,
  confirmLabel,
  danger,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean
  title: string
  text: string
  reason?: string
  onReason?: (v: string) => void
  confirmLabel: string
  danger?: boolean
  pending?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className={danger ? 'btn btn-danger' : 'btn'} disabled={pending || (onReason && !reason?.trim())} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{text}</p>
      {onReason ? (
        <label className="stack-xs">
          <span>Причина</span>
          <textarea value={reason} onChange={(e) => onReason(e.target.value)} rows={3} required />
        </label>
      ) : null}
    </Modal>
  )
}

export function AdminTable({
  columns,
  rows,
  emptyTitle,
  emptyAction,
}: {
  columns: { key: string; label: string; hideOnMobile?: boolean }[]
  rows: { id: string; href?: string; cells: Record<string, ReactNode> }[]
  emptyTitle: string
  emptyAction?: ReactNode
}) {
  const mobile = useMemo(() => columns.filter((c) => !c.hideOnMobile), [columns])
  if (!rows.length) {
    return <EmptyState title={emptyTitle} action={emptyAction} />
  }
  return (
    <>
      <div className="table-wrap admin-table-desktop">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((c, i) => (
                  <td key={c.key}>
                    {i === 0 && row.href ? <Link to={row.href}>{row.cells[c.key]}</Link> : row.cells[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="admin-card-list">
        {rows.map((row) => {
          const body = (
            <article className="card admin-card">
              {mobile.map((c) => (
                <div key={c.key} className="admin-card-row">
                  <span className="muted">{c.label}</span>
                  <strong>{row.cells[c.key]}</strong>
                </div>
              ))}
            </article>
          )
          return row.href ? (
            <Link key={row.id} to={row.href} className="admin-card-link">
              {body}
            </Link>
          ) : (
            <div key={row.id}>{body}</div>
          )
        })}
      </div>
    </>
  )
}
