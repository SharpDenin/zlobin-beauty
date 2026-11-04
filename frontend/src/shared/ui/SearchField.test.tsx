import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SearchField } from './SearchField'

describe('SearchField', () => {
  afterEach(() => cleanup())

  it('renders label, placeholder and search icon', () => {
    render(
      <SearchField
        label="Поиск по названию"
        value=""
        onChange={() => {}}
        placeholder="Найти"
        data-testid="sf"
      />,
    )
    expect(screen.getByLabelText('Поиск по названию')).toBeInTheDocument()
    expect(screen.getByTestId('sf')).toHaveAttribute('placeholder', 'Найти')
    expect(document.querySelector('.search-field__icon svg')).toBeTruthy()
  })

  it('calls onChange and clears when clearable', () => {
    const onChange = vi.fn()
    const onClear = vi.fn()
    const { rerender } = render(
      <SearchField value="" onChange={onChange} clearable aria-label="Поиск" />,
    )
    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'май' } })
    expect(onChange).toHaveBeenCalledWith('май')

    rerender(<SearchField value="май" onChange={onChange} onClear={onClear} clearable aria-label="Поиск" />)
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }))
    expect(onClear).toHaveBeenCalled()
  })

  it('shows loading spinner instead of clear', () => {
    render(
      <SearchField value="q" onChange={() => {}} clearable loading aria-label="Поиск" />,
    )
    expect(screen.queryByRole('button', { name: 'Очистить поиск' })).toBeNull()
    expect(document.querySelector('.search-field__spinner')).toBeTruthy()
  })

  it('respects disabled state', () => {
    render(<SearchField value="x" onChange={() => {}} disabled aria-label="Поиск" />)
    expect(screen.getByLabelText('Поиск')).toBeDisabled()
  })
})
