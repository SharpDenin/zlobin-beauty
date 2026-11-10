import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpecializationPicker } from '@/shared/ui/SpecializationPicker'

afterEach(() => cleanup())

describe('SpecializationPicker', () => {
  it('lists catalog options for profession slugs and toggles multi-select', () => {
    const onChange = vi.fn()
    render(<SpecializationPicker professionSlugs={['colorist']} value={['Балаяж']} onChange={onChange} />)
    expect(screen.getByTestId('spec-chip-Балаяж')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('specialization-picker-trigger'))
    expect(screen.getByTestId('specialization-picker-menu')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('spec-option-Омбре'))
    expect(onChange).toHaveBeenCalledWith(['Балаяж', 'Омбре'])
    fireEvent.click(screen.getByTestId('spec-chip-Балаяж'))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('disables trigger when no profession type selected', () => {
    render(<SpecializationPicker professionSlugs={[]} value={[]} onChange={vi.fn()} />)
    expect(screen.getByTestId('specialization-picker-trigger')).toBeDisabled()
  })
})
