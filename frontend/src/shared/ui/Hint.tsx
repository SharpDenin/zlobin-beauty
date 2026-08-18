import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useState } from 'react'

type Props = {
  id: string
  title: string
  children: string
}

export function Hint({ id, title, children }: Props) {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const prefs = useQuery({
    queryKey: ['me-hints'],
    queryFn: () =>
      apiRequest<{ hints_enabled: boolean; dismissed: string[] }>('/v1/me/hints', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const dismiss = useMutation({
    mutationFn: () =>
      apiRequest('/v1/me/hints', { method: 'PATCH', token: accessToken, body: { dismiss: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me-hints'] }),
  })

  if (prefs.data?.hints_enabled === false) return null
  if ((prefs.data?.dismissed ?? []).includes(id)) return null

  return (
    <span className="hint-wrap" data-testid={`hint-${id}`}>
      <button className="hint-btn" type="button" aria-label={title} onClick={() => setOpen((v) => !v)}>
        ?
      </button>
      {open && (
        <div className="hint-pop" role="tooltip">
          <strong>{title}</strong>
          <p>{children}</p>
          <button className="btn btn-ghost btn-compact" type="button" onClick={() => dismiss.mutate()}>
            Больше не показывать
          </button>
        </div>
      )}
    </span>
  )
}
