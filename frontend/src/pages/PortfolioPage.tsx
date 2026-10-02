import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { userError } from '@/shared/lib/app-error'
import { useAuth } from '@/features/auth/AuthProvider'
import { useFormDraft } from '@/shared/lib/useFormDraft'
import { MediaDropzone } from '@/shared/ui/MediaDropzone'
import { Drawer } from '@/shared/ui/Drawer'
import { Modal } from '@/shared/ui/Modal'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { useToast } from '@/shared/ui/Toast'
import { moderationError } from '@/shared/lib/moderation'
import { PageHeader } from '@/app/layout'
import {
  PortfolioCategoryChips,
  PortfolioGrid,
  PortfolioViewer,
} from '@/features/portfolio/PortfolioUI'
import {
  collectPortfolioCategories,
  filterPortfolioByCategory,
  movePortfolioItem,
  suggestPortfolioCategories,
  type PortfolioItem,
  type PortfolioListResponse,
} from '@/features/portfolio/types'
import '@/features/portfolio/portfolio.css'

const PORTFOLIO_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'

const formSchema = z.object({
  title: z.string().max(80, 'Не больше 80 символов'),
  description: z.string().max(1000, 'Не больше 1000 символов').optional(),
  category: z.string().max(40, 'Не больше 40 символов'),
  customCategory: z.string().max(40, 'Не больше 40 символов').optional(),
})

type FormValues = z.infer<typeof formSchema>

export function PortfolioPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [categoryFilter, setCategoryFilter] = useState('Все')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<PortfolioItem | null>(null)
  const [mediaId, setMediaId] = useState<string | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerIndex, setViewerIndex] = useState(0)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const portfolio = useQuery({
    queryKey: ['my-portfolio'],
    queryFn: () =>
      apiRequest<PortfolioListResponse>('/v1/me/master/portfolio', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const master = useQuery({
    queryKey: ['my-master'],
    queryFn: () =>
      apiRequest<{
        master: { profession_types?: { name: string }[] }
        services: { category: string }[]
      }>('/v1/me/master', { token: accessToken }),
    enabled: Boolean(accessToken),
    retry: false,
  })

  const items = portfolio.data?.items ?? []
  const categories = useMemo(() => collectPortfolioCategories(items), [items])
  const filtered = useMemo(
    () => filterPortfolioByCategory(items, categoryFilter),
    [items, categoryFilter],
  )
  const suggested = useMemo(
    () =>
      suggestPortfolioCategories(
        (master.data?.services ?? []).map((s) => s.category),
        (master.data?.master.profession_types ?? []).map((p) => p.name),
      ),
    [master.data],
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: '', description: '', category: '', customCategory: '' },
  })
  const draft = useFormDraft(form, 'portfolio-item-form')

  function openCreate() {
    setEditing(null)
    setMediaId(null)
    setFormError(null)
    form.reset({ title: '', description: '', category: suggested[0] ?? '', customCategory: '' })
    setDrawerOpen(true)
  }

  function openEdit(item: PortfolioItem) {
    setEditing(item)
    setMediaId(item.media_id)
    setFormError(null)
    form.reset({
      title: item.title || item.caption || '',
      description: item.description || '',
      category: item.category || '',
      customCategory: '',
    })
    setDrawerOpen(true)
  }

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!accessToken) throw new Error('unauthorized')
      const category = (values.customCategory?.trim() || values.category.trim())
      if (!mediaId) throw new Error('media required')
      const body = {
        media_id: mediaId,
        title: values.title.trim(),
        caption: values.title.trim(),
        description: values.description?.trim() || '',
        category,
      }
      if (editing) {
        return apiRequest<PortfolioItem>(`/v1/me/master/portfolio/${editing.id}`, {
          method: 'PATCH',
          token: accessToken,
          body,
        })
      }
      return apiRequest<PortfolioItem>('/v1/me/master/portfolio', {
        method: 'POST',
        token: accessToken,
        body,
      })
    },
    onSuccess: async () => {
      draft.clear()
      setDrawerOpen(false)
      setEditing(null)
      setMediaId(null)
      toast.success(editing ? 'Работа обновлена' : 'Работа добавлена')
      await qc.invalidateQueries({ queryKey: ['my-portfolio'] })
    },
    onError: (e) => {
      setFormError(userError(e, 'Не удалось сохранить работу'))
    },
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/v1/me/master/portfolio/${id}`, { method: 'DELETE', token: accessToken })
    },
    onSuccess: async () => {
      setDeleteId(null)
      setViewerOpen(false)
      toast.success('Работа удалена')
      await qc.invalidateQueries({ queryKey: ['my-portfolio'] })
    },
    onError: (e) => toast.error(userError(e, 'Не удалось удалить')),
  })

  const reorder = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await apiRequest('/v1/me/master/portfolio/order', {
        method: 'PUT',
        token: accessToken,
        body: { ordered_ids: orderedIds },
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['my-portfolio'] })
    },
    onError: (e) => toast.error(userError(e, 'Не удалось изменить порядок')),
  })

  function onMove(id: string, direction: 'up' | 'down') {
    const ids = items.map((i) => i.id)
    const next = movePortfolioItem(ids, id, direction)
    if (next === ids || next.every((v, i) => v === ids[i])) return
    void reorder.mutateAsync(next)
  }

  const watchedCategory = form.watch('category')

  return (
    <main className="page portfolio-page">
      <PageHeader
        title="Портфолио"
        subtitle={<p className="muted">Работы, которые видят клиенты на вашей странице</p>}
        actions={
          <button className="btn btn-primary" type="button" onClick={openCreate}>
            Добавить работу
          </button>
        }
      />

      {portfolio.isLoading && (
        <div className="portfolio-tight-grid" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="portfolio-cell skeleton" />
          ))}
        </div>
      )}
      {portfolio.isError && (
        <ErrorBanner error={portfolio.error} fallbackTitle="Не удалось загрузить портфолио" />
      )}

      {!portfolio.isLoading && !portfolio.isError && (
        <>
          <PortfolioCategoryChips
            categories={categories}
            value={categoryFilter}
            onChange={setCategoryFilter}
          />
          <PortfolioGrid
            items={filtered}
            token={accessToken}
            onOpen={(index) => {
              setViewerIndex(index)
              setViewerOpen(true)
            }}
            ownerActions={{ onMove }}
            empty={
              <EmptyState
                title="Пока нет работ"
                text="Добавьте фото — клиенты увидят их на вашей странице."
                action={
                  <button className="btn btn-primary" type="button" onClick={openCreate}>
                    Добавить работу
                  </button>
                }
              />
            }
          />
        </>
      )}

      <PortfolioViewer
        open={viewerOpen}
        items={filtered}
        index={viewerIndex}
        token={accessToken}
        onClose={() => setViewerOpen(false)}
        onIndexChange={setViewerIndex}
        footer={
          filtered[viewerIndex] ? (
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                onClick={() => {
                  openEdit(filtered[viewerIndex])
                  setViewerOpen(false)
                }}
              >
                Изменить
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => setDeleteId(filtered[viewerIndex].id)}
              >
                Удалить
              </button>
            </div>
          ) : null
        }
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? 'Изменить работу' : 'Добавить работу'}
      >
        <form
          className="stack"
          onSubmit={form.handleSubmit((values) => {
            if (!mediaId) {
              setFormError('Добавьте фото')
              return
            }
            const banned =
              moderationError(values.title) ||
              moderationError(values.description || '') ||
              moderationError(values.category) ||
              moderationError(values.customCategory || '')
            if (banned) {
              setFormError(banned)
              return
            }
            save.mutate(values)
          })}
        >
          {formError && <ErrorBanner error={formError} />}
          <MediaDropzone
            purpose="portfolio"
            value={mediaId}
            onChange={(id) => setMediaId(id)}
            allowVideo={false}
            accept={PORTFOLIO_ACCEPT}
            label="Фото или GIF"
          />
          <div className="field">
            <label htmlFor="pf-title">Название</label>
            <input id="pf-title" maxLength={80} aria-required="true" {...form.register('title')} />
            {form.formState.errors.title && (
              <span className="error">{form.formState.errors.title.message}</span>
            )}
          </div>
          <div className="field">
            <span className="label-text">Категория</span>
            <div className="portfolio-form-chips">
              {suggested.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`portfolio-chip ${watchedCategory === c ? 'is-active' : ''}`}
                  aria-pressed={watchedCategory === c}
                  onClick={() => {
                    form.setValue('category', c)
                    form.setValue('customCategory', '')
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
            <input
              placeholder="Своя категория"
              maxLength={40}
              aria-label="Своя категория"
              {...form.register('customCategory')}
            />
          </div>
          <div className="field">
            <label htmlFor="pf-desc">Описание</label>
            <textarea id="pf-desc" rows={3} maxLength={1000} {...form.register('description')} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </form>
      </Drawer>

      <Modal
        open={Boolean(deleteId)}
        onClose={() => setDeleteId(null)}
        title="Удалить работу?"
      >
        <p className="muted">Фото исчезнет из портфолио. Это действие нельзя отменить.</p>
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={() => setDeleteId(null)}>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={remove.isPending}
            onClick={() => deleteId && remove.mutate(deleteId)}
          >
            Удалить
          </button>
        </div>
      </Modal>
    </main>
  )
}
