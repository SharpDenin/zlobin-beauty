import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TIME_SELECT_OPTIONS, TimeSelect, timeSelectOptions } from '@/shared/ui/TimeSelect'

describe('TimeSelect', () => {
  it('exposes half-hour options including midnight end', () => {
    expect(TIME_SELECT_OPTIONS[0]).toBe('00:00')
    expect(TIME_SELECT_OPTIONS.at(-1)).toBe('24:00')
    expect(TIME_SELECT_OPTIONS).toHaveLength(49)
  })

  it('keeps an off-grid current value in the list', () => {
    expect(timeSelectOptions('10:15')).toContain('10:15')
  })

  it('fires onChange with HH:MM', () => {
    const onChange = vi.fn()
    render(<TimeSelect id="t" value="10:00" onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '11:30' } })
    expect(onChange).toHaveBeenCalledWith('11:30')
  })
})
