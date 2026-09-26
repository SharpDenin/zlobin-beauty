import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { KnowledgeCard, KnowledgeCardSkeleton } from '@/features/knowledge/KnowledgeCard'
import type { KnowledgeArticle } from '@/features/knowledge/types'

const base: KnowledgeArticle = {
  id: 'a1',
  title: 'Домашний уход после салона',
  category: 'Уход',
  excerpt: 'No.3 два раза в неделю',
  author_name: 'Loreal Pro',
  created_at: '2026-01-01T00:00:00Z',
  home_care: true,
  professional: false,
  audience_kind: 'home',
}

describe('KnowledgeCard', () => {
  it('renders cover fallback, excerpt and skips audience badges for clients', () => {
    render(
      <MemoryRouter>
        <KnowledgeCard article={base} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Домашний уход после салона')).toBeTruthy()
    expect(screen.getByText('No.3 два раза в неделю')).toBeTruthy()
    expect(screen.queryByText('Профессиональный материал')).toBeNull()
    expect(screen.getByText('Уход')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Нет изображения' })).toBeTruthy()
  })

  it('shows home and professional badges for masters', () => {
    render(
      <MemoryRouter>
        <KnowledgeCard
          showAudience
          article={{
            ...base,
            title: 'Протокол окрашивания',
            home_care: true,
            professional: true,
            audience_kind: 'mixed',
          }}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Для домашнего ухода')).toBeTruthy()
    expect(screen.getByText('Профессиональный материал')).toBeTruthy()
  })

  it('renders loading skeleton without an empty screen', () => {
    const { container } = render(<KnowledgeCardSkeleton />)
    expect(container.querySelector('.kb-skel-cover')).toBeTruthy()
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(1)
  })
})
