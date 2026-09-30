import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { useMessengerOptional } from '@/features/messenger/MessengerProvider'
import { addContact, listContacts, searchPeople } from '@/features/contacts/api'
import { ContactAvatar, ContactRoleBadges, ContactSearchRow } from '@/features/contacts/components'
import { filterContactsByQuery } from '@/features/contacts/roleLabels'
import type { Contact, ContactSearchHit } from '@/features/contacts/types'
import { userError } from '@/shared/lib/app-error'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { Modal } from '@/shared/ui/Modal'
import { toast } from '@/shared/ui/Toast'
import '@/features/contacts/contacts.css'

type Props = {
  open: boolean
  onClose: () => void
}

export function ContactPickerModal({ open, onClose }: Props) {
  const { accessToken } = useAuth()
  const messenger = useMessengerOptional()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<'book' | 'find'>('book')
  const [hits, setHits] = useState<ContactSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['contacts'],
    queryFn: () => listContacts(accessToken, { limit: 100 }),
    enabled: Boolean(accessToken && open),
  })

  const filtered = useMemo(() => filterContactsByQuery(list.data?.items ?? [], q), [list.data?.items, q])

  useEffect(() => {
    if (!open || mode !== 'find') return
    const raw = q.trim()
    if (raw.length < 2) {
      setHits([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const t = window.setTimeout(() => {
      void searchPeople(accessToken, raw)
        .then((res) => {
          if (!cancelled) {
            setHits(res.items ?? [])
            setSearchError(null)
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setSearchError(userError(e, 'Не удалось найти людей'))
            setHits([])
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [q, accessToken, open, mode])

  useEffect(() => {
    if (!open) {
      setQ('')
      setMode('book')
      setHits([])
      setSearchError(null)
    }
  }, [open])

  const addMut = useMutation({
    mutationFn: (hit: ContactSearchHit) => addContact(accessToken, { user_id: hit.id }),
    onSuccess: (contact) => {
      toast.success('Контакт добавлен')
      setHits((cur) => cur.map((h) => (h.id === contact.user_id ? { ...h, already_added: true } : h)))
      void qc.invalidateQueries({ queryKey: ['contacts'] })
    },
    onError: (e) => toast.error(userError(e, 'Не удалось добавить контакт')),
  })

  async function openContactChat(contact: Contact) {
    if (!messenger) return
    onClose()
    if (contact.conversation_id) {
      messenger.open(contact.conversation_id)
      return
    }
    const roles = new Set(contact.roles)
    try {
      if (roles.has('master')) {
        await messenger.start({ type: 'client_master', master_user_id: contact.user_id })
        return
      }
      if (roles.has('client')) {
        await messenger.start({ type: 'client_master', client_user_id: contact.user_id })
        return
      }
      toast.error('Пока нельзя начать чат с этим контактом')
    } catch {
      /* handled */
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Новый чат" label="Выбор контакта">
      <div className="contacts-picker">
        <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            className={`btn btn-compact ${mode === 'book' ? 'btn-primary' : 'btn-secondary'}`}
            type="button"
            onClick={() => setMode('book')}
          >
            Контакты
          </button>
          <button
            className={`btn btn-compact ${mode === 'find' ? 'btn-primary' : 'btn-secondary'}`}
            type="button"
            onClick={() => setMode('find')}
          >
            Найти и добавить
          </button>
        </div>
        <label className="field">
          <span className="visually-hidden">Поиск</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={mode === 'book' ? 'Найти в контактах' : 'Имя, email или телефон'}
            aria-label={mode === 'book' ? 'Найти в контактах' : 'Найти человека'}
          />
        </label>
        {mode === 'find' && <p className="muted">Можно искать по имени, email или телефону.</p>}
        {list.isError && mode === 'book' && <ErrorBanner error={list.error} fallbackTitle="Не удалось загрузить контакты" />}
        {searchError && mode === 'find' && <ErrorBanner error={searchError} />}
        <div className="contacts-picker-list">
          {mode === 'book' && (
            <>
              {list.isLoading && <p className="muted">Загрузка…</p>}
              {!list.isLoading && filtered.length === 0 && (
                <EmptyState
                  title="Нет контактов"
                  text="Добавьте человека через поиск."
                  action={
                    <button className="btn btn-secondary" type="button" onClick={() => setMode('find')}>
                      Найти и добавить
                    </button>
                  }
                />
              )}
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="contacts-row"
                  onClick={() => void openContactChat(c)}
                  data-testid={`picker-contact-${c.id}`}
                >
                  <ContactAvatar mediaId={c.avatar_media_id} name={c.display_name} token={accessToken} />
                  <span className="contacts-row-body">
                    <strong>{c.display_name}</strong>
                    <span className="contacts-row-meta">
                      <ContactRoleBadges roles={c.roles} />
                      {c.city ? <span className="muted">{c.city}</span> : null}
                    </span>
                  </span>
                </button>
              ))}
            </>
          )}
          {mode === 'find' && (
            <>
              {searching && <p className="muted">Ищем…</p>}
              {!searching && q.trim().length >= 2 && hits.length === 0 && !searchError && (
                <EmptyState title="Никого не нашли" text="Попробуйте другой запрос." />
              )}
              {hits.map((hit) => (
                <ContactSearchRow
                  key={hit.id}
                  hit={hit}
                  token={accessToken}
                  busy={addMut.isPending}
                  onAdd={(h) => addMut.mutate(h)}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
