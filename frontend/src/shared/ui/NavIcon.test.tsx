import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { NavIcon, navIconNameFor } from './NavIcon'

describe('NavIcon', () => {
  it('maps critical routes to distinct icons', () => {
    expect(navIconNameFor('/')).toBe('home')
    expect(navIconNameFor('/search')).toBe('search')
    expect(navIconNameFor('/shop')).toBe('bag')
    expect(navIconNameFor('/knowledge')).toBe('book')
    expect(navIconNameFor('/contacts')).toBe('contacts')
    expect(navIconNameFor('/clients')).toBe('contacts')
    expect(navIconNameFor('/calendar')).toBe('calendar')
    expect(navIconNameFor('/messages')).toBe('chat')
    expect(navIconNameFor('/settings')).toBe('settings')
    expect(navIconNameFor('/more')).toBe('more')
    expect(navIconNameFor('/admin/knowledge')).toBe('book')
  })

  it('renders an accessible decorative svg', () => {
    const { container } = render(<NavIcon to="/search" />)
    const svg = container.querySelector('svg.nav-icon')
    expect(svg).toBeTruthy()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg?.querySelectorAll('path, circle, rect').length).toBeGreaterThan(0)
  })
})
