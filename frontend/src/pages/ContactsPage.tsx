import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { useMessengerOptional } from '@/features/messenger/MessengerProvider'
import {
  addContact,
  deleteContact,
  listContacts,
  searchPeople,
  updateContactNote,
} from '@/features/contacts/api'
import {
  ContactAvatar,
  ContactRoleBadges,
  ContactRow,
  ContactSearchRow,
  ContactsListSkeleton,
} from '@/features/contacts/components'
import { filterContactsByQuery } from '@/features/contacts/roleLabels'
import type { Contact, ContactSearchHit } from '@/features/contacts/types'
import { userError } from '@/shared/lib/app-error'
import { useFormDraft } from '@/shared/lib/useFormDraft'
import { Drawer } from '@/shared/ui/Drawer'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { Modal } from '@/shared/ui/Modal'
import { toast } from '@/shared/ui/Toast'
import '@/features/contacts/contacts.css'

type NoteForm = { note: string }
type AddForm = { query: string; note: string }

function looksLikeEmail(q: string) {
  return q.includes('@')
}

function looksLikePhone(q: string) {
  const digits = q.replace(/\D/g, '')
  return digits.length >= 10 && !q.includes('@')
}

export function ContactsPage() {
  const { accessToken } = useAuth()
  const messenger = useMessengerOptional()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Contact | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [searchHits, setSearchHits] = useState<ContactSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['contacts'],
    queryFn: () => listContacts(accessToken, { limit: 100 }),
    enabled: Boolean(accessToken),
  })

  const noteForm = useForm<NoteForm>({ defaultValues: { note: '' } })
  const addForm = useForm<AddForm>({ defaultValues: { query: '', note: '' } })
  const noteDraft = useFormDraft(noteForm, 'contacts:note')
  const addDraft = useFormDraft(addForm, 'contacts:add')

  useEffect(() => {
    if (selected) noteForm.reset({ note: selected.note || '' })
  }, [selected, noteForm])

  const filtered = useMemo(
    () => filterContactsByQuery(list.data?.items ?? [], q),
    [list.data?.items, q],
  )

  const addQuery = addForm.watch('query')
  useEffect(() => {
    const raw = addQuery?.trim() ?? ''
    if (raw.length < 2) {
      setSearchHits([])
      setSearchError(null)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const t = window.setTimeout(() => {
      void searchPeople(accessToken, raw)
        .then((res) => {
          if (!cancelled) {
            setSearchHits(res.items ?? [])
            setSearchError(null)
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setSearchHits([])
            setSearchError(userError(e, 'Не удалось найти людей'))
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
  }, [addQuery, accessToken])

  const addMut = useMutation({
    mutationFn: (body: Parameters<typeof addContact>[1]) => addContact(accessToken, body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ['contacts'] })
      const prev = qc.getQueryData<{ items: Contact[]; total: number; limit: number; offset: number }>(['contacts'])
      if (body.user_id && prev) {
        const optimistic: Contact = {
          id: `tmp-${body.user_id}`,
          user_id: body.user_id,
          display_name: searchHits.find((h) => h.id === body.user_id)?.display_name || 'Контакт',
          roles: searchHits.find((h) => h.id === body.user_id)?.roles || [],
          city: searchHits.find((h) => h.id === body.user_id)?.city || '',
          avatar_media_id: null,
          note: body.note || '',
          conversation_id: null,
          created_at: new Date().toISOString(),
        }
        qc.setQueryData(['contacts'], {
          ...prev,
          items: [optimistic, ...prev.items.filter((c) => c.user_id !== body.user_id)],
          total: prev.total + 1,
        })
      }
      return { prev }
    },
    onError: (e, _b, ctx) => {
      if (ctx?.prev) qc.setQueryData(['contacts'], ctx.prev)
      toast.error(userError(e, 'Не удалось добавить контакт'))
    },
    onSuccess: (contact) => {
      toast.success('Контакт добавлен')
      setSearchHits((cur) => cur.map((h) => (h.id === contact.user_id ? { ...h, already_added: true } : h)))
      addDraft.clear()
      addForm.reset({ query: '', note: '' })
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteContact(accessToken, id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['contacts'] })
      const prev = qc.getQueryData<{ items: Contact[]; total: number; limit: number; offset: number }>(['contacts'])
      if (prev) {
        qc.setQueryData(['contacts'], {
          ...prev,
          items: prev.items.filter((c) => c.id !== id),
          total: Math.max(0, prev.total - 1),
        })
      }
      return { prev }
    },
    onError: (e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['contacts'], ctx.prev)
      toast.error(userError(e, 'Не удалось удалить контакт'))
    },
    onSuccess: () => {
      toast.success('Контакт удалён')
      setConfirmDelete(false)
      setSelected(null)
      noteDraft.clear()
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })

  const noteMut = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => updateContactNote(accessToken, id, note),
    onSuccess: (contact) => {
      setSelected(contact)
      noteDraft.clear()
      void qc.invalidateQueries({ queryKey: ['contacts'] })
      toast.success('Заметка сохранена')
    },
    onError: (e) => toast.error(userError(e, 'Не удалось сохранить заметку')),
  })

  async function startChat(contact: Contact) {
    if (!messenger) {
      toast.error('Мессенджер недоступен')
      return
    }
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
      toast.error('Пока нельзя начать чат с этим контактом из адресной книги')
    } catch {
      /* toast already in messenger.start */
    }
  }

  function onAddHit(hit: ContactSearchHit) {
    const note = addForm.getValues('note') || ''
    addMut.mutate({ user_id: hit.id, note })
  }

  function onAddByQuery() {
    const query = addForm.getValues('query').trim()
    const note = addForm.getValues('note') || ''
    if (looksLikeEmail(query)) {
      addMut.mutate({ email: query, note })
      return
    }
    if (looksLikePhone(query)) {
      addMut.mutate({ phone: query, note })
    }
  }

  return (
    <main className="page contacts-page">
      <header className="stack-sm">
        <h1>Контакты</h1>
        <p className="muted">Адресная книга для быстрого старта переписки.</p>
      </header>

      <div className="contacts-toolbar">
        <div className="contacts-toolbar-row">
          <label className="field">
            <span className="visually-hidden">Найти в контактах</span>
            <input
              type="search"
              placeholder="Найти в контактах"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Найти в контактах"
            />
          </label>
          <button className="btn btn-primary" type="button" onClick={() => setAddOpen(true)}>
            Добавить контакт
          </button>
        </div>
      </div>

      {list.isLoading && <ContactsListSkeleton />}
      {list.isError && <ErrorBanner error={list.error} fallbackTitle="Не удалось загрузить контакты" />}

      {!list.isLoading && !list.isError && filtered.length === 0 && (
        <EmptyState
          title={q.trim() ? 'Никого не нашли' : 'Пока нет контактов'}
          text={
            q.trim()
              ? 'Попробуйте другой запрос или добавьте человека по email или телефону.'
              : 'Добавьте мастера, клиента или коллегу, чтобы быстро написать им.'
          }
          action={
            !q.trim() ? (
              <button className="btn btn-primary" type="button" onClick={() => setAddOpen(true)}>
                Добавить контакт
              </button>
            ) : undefined
          }
        />
      )}

      <div className="contacts-list" data-testid="contacts-list">
        {filtered.map((c) => (
          <ContactRow key={c.id} contact={c} token={accessToken} onOpen={setSelected} />
        ))}
      </div>

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.display_name || 'Контакт'}>
        {selected && (
          <div className="contacts-detail">
            <div className="contacts-detail-hero">
              <ContactAvatar mediaId={selected.avatar_media_id} name={selected.display_name} token={accessToken} />
              <div>
                <strong>{selected.display_name}</strong>
                <div className="contacts-row-meta" style={{ marginTop: 6 }}>
                  <ContactRoleBadges roles={selected.roles} />
                </div>
                {selected.city ? <p className="muted">{selected.city}</p> : null}
              </div>
            </div>
            <form
              className="stack-sm"
              onSubmit={noteForm.handleSubmit((values) => noteMut.mutate({ id: selected.id, note: values.note }))}
            >
              <label className="field">
                <span>Заметка</span>
                <textarea {...noteForm.register('note')} rows={3} maxLength={200} aria-label="Заметка" />
              </label>
              <button className="btn btn-secondary" type="submit" disabled={noteMut.isPending}>
                Сохранить заметку
              </button>
            </form>
            <div className="contacts-detail-actions">
              <button className="btn btn-primary" type="button" onClick={() => void startChat(selected)}>
                Написать
              </button>
              <button className="btn btn-danger" type="button" onClick={() => setConfirmDelete(true)}>
                Удалить из контактов
              </button>
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Добавить контакт"
        footer={
          looksLikeEmail(addQuery || '') || looksLikePhone(addQuery || '') ? (
            <button className="btn btn-primary" type="button" disabled={addMut.isPending} onClick={onAddByQuery}>
              Добавить по {looksLikeEmail(addQuery || '') ? 'email' : 'телефону'}
            </button>
          ) : null
        }
      >
        <form className="stack-sm" onSubmit={(e) => e.preventDefault()}>
          <label className="field">
            <span>Поиск</span>
            <input
              {...addForm.register('query')}
              placeholder="Имя, email или телефон"
              aria-required="true"
              required
              autoComplete="off"
            />
          </label>
          <p className="muted">Можно искать по имени, email или телефону.</p>
          <label className="field">
            <span>Заметка</span>
            <textarea {...addForm.register('note')} rows={2} maxLength={200} />
          </label>
          {searchError && <ErrorBanner error={searchError} />}
          {searching && <p className="muted">Ищем…</p>}
          {!searching && (addQuery?.trim().length ?? 0) >= 2 && searchHits.length === 0 && !searchError && (
            <EmptyState title="Никого не нашли" text="Проверьте написание или попробуйте email/телефон." />
          )}
          <div className="contacts-search-results">
            {searchHits.map((hit) => (
              <ContactSearchRow
                key={hit.id}
                hit={hit}
                token={accessToken}
                busy={addMut.isPending}
                onAdd={onAddHit}
              />
            ))}
          </div>
        </form>
      </Modal>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Удалить контакт?"
        footer={
          <>
            <button className="btn btn-secondary" type="button" onClick={() => setConfirmDelete(false)}>
              Отмена
            </button>
            <button
              className="btn btn-danger"
              type="button"
              disabled={deleteMut.isPending || !selected}
              onClick={() => selected && deleteMut.mutate(selected.id)}
            >
              Удалить
            </button>
          </>
        }
      >
        <p>Контакт исчезнет из адресной книги. Переписка сохранится.</p>
      </Modal>
    </main>
  )
}
