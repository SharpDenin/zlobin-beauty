import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { apiRequest } from '@/shared/api/client'
import { MasterCabinetPage } from '@/pages/MasterCabinetPage'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiRequest: vi.fn() }
})

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    accessToken: 't',
    user: { id: 'u1', display_name: 'Анна', email: 'a@demo.local', city: 'Красноярск', roles: ['master'] },
  }),
}))

vi.mock('@/shared/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

vi.mock('@/shared/ui/MediaDropzone', () => ({
  MediaDropzone: ({ label, onChange }: { label: string; onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onChange('media-1')}>{label}</button>
  ),
}))

vi.mock('@/shared/ui/MediaImage', () => ({ MediaImage: () => null }))
vi.mock('@/shared/ui/ProfessionTypePicker', () => ({
  ProfessionTypePicker: () => <div data-testid="profession-picker" />,
  useProfessionTypes: () => ({
    data: {
      items: [
        { id: '11111111-1111-1111-1111-111111111111', slug: 'colorist', name: 'Колорист', is_active: true },
      ],
    },
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('@/shared/ui/SpecializationPicker', () => ({
  SpecializationPicker: ({ value }: { value: string[] }) => (
    <div data-testid="specialization-picker">
      {value.map((t) => (
        <span key={t}>{t}</span>
      ))}
    </div>
  ),
}))
vi.mock('@/shared/ui/WorkFormatPicker', () => ({
  WorkFormatPicker: () => <div data-testid="work-format-picker" />,
}))
vi.mock('@/shared/ui/Modal', () => ({
  Modal: ({ open, children, footer }: { open: boolean; children: ReactNode; footer?: ReactNode }) =>
    open ? (
      <div data-testid="type-change-modal">
        {children}
        {footer}
      </div>
    ) : null,
}))
vi.mock('@/shared/lib/useFormDraft', () => ({
  useFormDraft: () => ({ clear: vi.fn() }),
}))

vi.mock('@/shared/lib/cabinet', () => ({
  useCabinet: () => ({
    selectedOrg: {
      organization: { id: 'org1', name: 'Салон', type: 'salon', published: true, description: '' },
      branches: [{ id: 'b1', name: 'Центр', city: 'Красноярск', address_line: 'Ленина 1', phone: '+7900', published: false }],
      roles: ['owner'],
    },
    selectedBranch: { id: 'b1', name: 'Центр', city: 'Красноярск', address_line: 'Ленина 1', phone: '+7900', published: false },
    setSelectedOrgId: vi.fn(),
    setSelectedBranchId: vi.fn(),
  }),
}))

const mockedRequest = vi.mocked(apiRequest)

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MasterCabinetPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    if (path === '/v1/organizations/mine') {
      return {
        items: [{
          organization: { id: 'org1', name: 'Салон', type: 'salon', published: true, description: '' },
          branches: [{ id: 'b1', name: 'Филиал', city: 'Красноярск', address_line: 'Ленина 1', phone: '+79001112233', published: true }],
          roles: ['owner'],
        }],
      }
    }
    if (path.includes('/readiness') && path.includes('/organizations/')) {
      return { ready: true, missing: [], checks: [] }
    }
    if (path.includes('/branches/') && path.includes('/readiness')) {
      return { ready: true, missing: [], checks: [] }
    }
    if (path === '/v1/me/master/readiness') {
      return {
        ready: false,
        missing: ['city', 'specializations', 'bio'],
        checks: [
          { key: 'display_name', label: 'Имя для публикации', ok: true },
          { key: 'city', label: 'Город', ok: false, missing: 'Город' },
          { key: 'specializations', label: 'Специализация', ok: false },
          { key: 'profession_types', label: 'Профессиональный тип', ok: true },
          { key: 'bio', label: 'Описание (от 10 символов)', ok: false },
          { key: 'experience', label: 'Опыт (лет)', ok: true },
          { key: 'service', label: 'Хотя бы одна услуга', ok: true },
          { key: 'schedule', label: 'Расписание', ok: true },
        ],
      }
    }
    if (path === '/v1/me/master' && (!init?.method || init.method === 'GET')) {
      return {
        master: {
          id: 'm1',
          organization_id: 'org1',
          branch_id: 'b1',
          published: false,
          photo_media_id: null,
          work_type: 'private_practice',
          work_types: ['private_practice'],
          display_name: 'Анна',
          city: '',
          bio: '',
          specializations: ['колористика'],
          experience_years: 3,
          education: 'Academy',
          profession_types: [{ id: '11111111-1111-1111-1111-111111111111', slug: 'colorist', name: 'Колорист' }],
        },
        services: [{ id: 's1' }],
      }
    }
    if (path === '/v1/me/master' && init?.method === 'PUT') {
      return { id: 'm1' }
    }
    if (path === '/v1/me/working-hours') return { items: [] }
    if (path.includes('/portfolio')) return { items: [] }
    if (path.includes('/photos')) return { items: [] }
    if (path.startsWith('/v1/branches/') && init?.method === 'PATCH') {
      return { id: 'b1', phone: (init.body as { phone?: string })?.phone }
    }
    throw new Error(`unexpected ${path} ${init?.method}`)
  })
})

afterEach(() => {
  cleanup()
  mockedRequest.mockReset()
})

describe('MasterCabinetPage PROF-01..05', () => {
  it('shows all missing readiness items with field anchors', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('master-readiness-missing')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Город' })).toHaveAttribute('href', '#master-city')
    expect(screen.getByRole('link', { name: 'Специализация' })).toHaveAttribute('href', '#master-specializations')
    expect(screen.queryByLabelText('Образование')).not.toBeInTheDocument()
  })

  it('shows publish CTA disabled while readiness is incomplete', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('master-readiness-missing')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('master-publish')).toBeInTheDocument())
    expect(screen.getByTestId('master-publish')).toBeDisabled()
    expect(screen.getByText(/Закройте пункты выше/)).toBeInTheDocument()
    expect(screen.queryByTestId('master-unpublish')).not.toBeInTheDocument()
  })

  it('publishes ready profile into search', async () => {
    mockedRequest.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path === '/v1/organizations/mine') {
        return {
          items: [{
            organization: { id: 'org1', name: 'Салон', type: 'salon', published: true, description: '' },
            branches: [{ id: 'b1', name: 'Филиал', city: 'Красноярск', address_line: 'Ленина 1', phone: '+79001112233', published: true }],
            roles: ['owner'],
          }],
        }
      }
      if (path.includes('/readiness') && path.includes('/organizations/')) {
        return { ready: true, missing: [], checks: [] }
      }
      if (path.includes('/branches/') && path.includes('/readiness')) {
        return { ready: true, missing: [], checks: [] }
      }
      if (path === '/v1/me/master/readiness') {
        return {
          ready: true,
          missing: [],
          checks: [
            { key: 'display_name', label: 'Имя для публикации', ok: true },
            { key: 'city', label: 'Город', ok: true },
            { key: 'specializations', label: 'Специализация', ok: true },
            { key: 'profession_types', label: 'Профессиональный тип', ok: true },
            { key: 'bio', label: 'Описание (от 10 символов)', ok: true },
            { key: 'experience', label: 'Опыт (лет)', ok: true },
            { key: 'service', label: 'Хотя бы одна услуга', ok: true },
            { key: 'schedule', label: 'Расписание', ok: true },
          ],
        }
      }
      if (path === '/v1/me/master' && (!init?.method || init.method === 'GET')) {
        return {
          master: {
            id: 'm1',
            organization_id: 'org1',
            branch_id: 'b1',
            published: false,
            photo_media_id: null,
            work_type: 'private_practice',
            work_types: ['private_practice'],
            display_name: 'Анна',
            city: 'Красноярск',
            bio: 'Опытный мастер колористики',
            specializations: ['колористика'],
            experience_years: 3,
            education: 'Academy',
            profession_types: [{ id: '11111111-1111-1111-1111-111111111111', slug: 'colorist', name: 'Колорист' }],
          },
          services: [{ id: 's1' }],
        }
      }
      if (path === '/v1/me/master' && init?.method === 'PUT') {
        return { id: 'm1', published: (init.body as { published?: boolean })?.published }
      }
      if (path === '/v1/me/working-hours') return { items: [] }
      if (path.includes('/portfolio')) return { items: [] }
      if (path.includes('/photos')) return { items: [] }
      throw new Error(`unexpected ${path} ${init?.method}`)
    })

    renderPage()
    await waitFor(() => expect(screen.getByTestId('master-publish')).toBeEnabled())
    expect(screen.getByText('Профиль готов к публикации')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('master-publish'))
    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/v1/me/master',
        expect.objectContaining({
          method: 'PUT',
          body: expect.objectContaining({ published: true, display_name: 'Анна' }),
        }),
      )
    })
    await waitFor(() => expect(screen.getByText('Профиль опубликован в поиске')).toBeInTheDocument())
  })

  it('saves phone with success feedback and keeps validation path on error', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByLabelText('Телефон филиала')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Телефон филиала'), { target: { value: '+79005556677' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить телефон' }))
    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/v1/branches/b1',
        expect.objectContaining({ method: 'PATCH', body: { phone: '+79005556677' } }),
      )
    })
    await waitFor(() => expect(screen.getByText('Телефон филиала сохранён')).toBeInTheDocument())
  })

  it('loads specializations into picker and preserves them on photo upload', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('master-readiness-missing')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('specialization-picker')).toBeInTheDocument())
    expect(screen.getByText('колористика')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить фото профиля' }))
    await waitFor(() => {
      const put = mockedRequest.mock.calls.find((c) => c[0] === '/v1/me/master' && (c[1] as { method?: string })?.method === 'PUT')
      expect(put).toBeTruthy()
      const body = (put![1] as { body: Record<string, unknown> }).body
      expect(body.photo_media_id).toBe('media-1')
      expect(body.specializations).toEqual(['колористика'])
      expect(body.profession_type_ids).toBeUndefined()
      expect(body.education).toBe('Academy')
    })
  })

})
