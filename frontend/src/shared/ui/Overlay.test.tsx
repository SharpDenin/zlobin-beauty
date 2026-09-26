import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Modal } from '@/shared/ui/Modal'
import { Drawer } from '@/shared/ui/Drawer'
import { isOverlayLocked, resetOverlayLockForTests } from '@/shared/ui/overlayLock'

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  resetOverlayLockForTests()
  vi.restoreAllMocks()
})

describe('Modal', () => {
  it('exposes dialog accessibility when open', () => {
    render(
      <Modal open title="Услуга" onClose={() => undefined}>
        <p>Содержание</p>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby')
    expect(screen.getByRole('heading', { name: 'Услуга' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(
      <Modal open={false} title="Скрыто" onClose={() => undefined}>
        нет
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape and backdrop click, not on content click', () => {
    const onClose = vi.fn()
    render(
      <Modal open title="Заказ" onClose={onClose}>
        <button type="button">Внутри</button>
      </Modal>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Внутри' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    onClose.mockClear()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    onClose.mockClear()
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('can disable Escape close', () => {
    const onClose = vi.fn()
    render(
      <Modal open title="Блок" onClose={onClose} closeOnEscape={false}>
        x
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('locks body scroll while open and returns focus on close', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Открыть</button>
          <Modal open={open} onClose={() => setOpen(false)} title="Фокус">
            <button type="button">Внутри</button>
          </Modal>
        </>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Открыть' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(isOverlayLocked()).toBe(true)
    expect(document.body.classList.contains('is-overlay-locked')).toBe(true)
    const close = screen.getByRole('button', { name: 'Закрыть' })
    const inner = screen.getByRole('button', { name: 'Внутри' })
    expect(close).toHaveFocus()
    inner.focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.click(close)
    expect(isOverlayLocked()).toBe(false)
    expect(trigger).toHaveFocus()
  })
})

describe('nested overlays', () => {
  it('keeps lock until the last overlay closes; Escape closes only the top', () => {
    function Nested() {
      const [outer, setOuter] = useState(true)
      const [inner, setInner] = useState(true)
      return (
        <>
          <Drawer open={outer} title="Меню" onClose={() => setOuter(false)}>меню</Drawer>
          <Modal open={inner} title="Подтверждение" onClose={() => setInner(false)}>ок</Modal>
        </>
      )
    }
    render(<Nested />)
    expect(isOverlayLocked()).toBe(true)
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('heading', { name: 'Подтверждение' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Меню' })).toBeInTheDocument()
    expect(isOverlayLocked()).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(isOverlayLocked()).toBe(false)
  })
})

describe('Drawer', () => {
  it('renders a labelled sheet', () => {
    render(
      <Drawer open title="Ещё" onClose={() => undefined}>
        <a href="/profile">Профиль</a>
      </Drawer>,
    )
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('heading', { name: 'Ещё' })).toBeInTheDocument()
  })
})
