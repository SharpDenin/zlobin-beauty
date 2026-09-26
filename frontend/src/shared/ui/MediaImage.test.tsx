import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MediaImage } from '@/shared/ui/MediaImage'
import { ServiceCardMedia } from '@/shared/ui/ServiceCardMedia'
import { MasterPortrait } from '@/shared/ui/MasterPortrait'

describe('MediaImage fallback', () => {
  it('shows system fallback when media id is missing', () => {
    render(<MediaImage mediaId={null} alt="Стрижка" fallback="СТ" />)
    const el = screen.getByRole('img', { name: 'Стрижка' })
    expect(el).toHaveClass('media-fallback')
    expect(el).toHaveTextContent('СТ')
    expect(el.querySelector('img')).toBeNull()
  })
})

describe('ServiceCardMedia', () => {
  it('uses landscape frame and fallback for a service without photo', () => {
    const { container } = render(<ServiceCardMedia name="Окрашивание" mediaId={null} />)
    expect(container.querySelector('.media-frame--landscape')).not.toBeNull()
    expect(screen.getByRole('img', { name: 'Окрашивание' })).toHaveClass('media-fallback')
    expect(screen.getByRole('img', { name: 'Окрашивание' })).toHaveTextContent('ОК')
  })
})

describe('MasterPortrait', () => {
  it('uses initials fallback when portrait is absent', () => {
    render(<MasterPortrait name="Анна Иванова" mediaId={null} />)
    expect(screen.getByRole('img', { name: 'Анна Иванова' })).toHaveTextContent('АИ')
  })
})
