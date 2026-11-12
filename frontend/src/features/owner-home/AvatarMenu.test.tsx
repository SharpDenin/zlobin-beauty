import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvatarMenu } from '@/features/owner-home/AvatarMenu'

afterEach(() => cleanup())

describe('AvatarMenu', () => {
  it('opens actions and closes after choosing upload', () => {
    const onView = vi.fn()
    const onUpload = vi.fn()
    render(
      <AvatarMenu photo canUpload onView={onView} onUpload={onUpload}>
        <span>A</span>
      </AvatarMenu>,
    )
    expect(screen.queryByText('Изменить фото')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('home-avatar-button'))
    expect(screen.getByTestId('home-avatar-actions')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('home-avatar-upload'))
    expect(onUpload).toHaveBeenCalled()
    expect(screen.queryByTestId('home-avatar-actions')).not.toBeInTheDocument()
  })

  it('offers view when photo exists', () => {
    const onView = vi.fn()
    render(
      <AvatarMenu photo canUpload onView={onView} onUpload={() => undefined}>
        <span>A</span>
      </AvatarMenu>,
    )
    fireEvent.click(screen.getByTestId('home-avatar-button'))
    fireEvent.click(screen.getByTestId('home-avatar-view'))
    expect(onView).toHaveBeenCalled()
  })

  it('closes on Escape and outside pointerdown', () => {
    render(
      <div>
        <button type="button" data-testid="outside">out</button>
        <AvatarMenu photo canUpload onView={() => undefined} onUpload={() => undefined}>
          <span>A</span>
        </AvatarMenu>
      </div>,
    )
    fireEvent.click(screen.getByTestId('home-avatar-button'))
    expect(screen.getByTestId('home-avatar-actions')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('home-avatar-actions')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('home-avatar-button'))
    expect(screen.getByTestId('home-avatar-actions')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByTestId('outside'))
    expect(screen.queryByTestId('home-avatar-actions')).not.toBeInTheDocument()
  })
})
