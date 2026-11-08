import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => 'blob:crop-test'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  })
  window.scrollTo = vi.fn() as typeof window.scrollTo
})

vi.mock('react-easy-crop', () => ({
  default: function MockCropper({
    onCropComplete,
    onZoomChange,
    onMediaLoaded,
    zoom,
  }: {
    onCropComplete: (a: unknown, b: { x: number; y: number; width: number; height: number }) => void
    onZoomChange: (z: number) => void
    onMediaLoaded: (size: { width: number; height: number; naturalWidth: number; naturalHeight: number }) => void
    zoom: number
  }) {
    return (
      <div data-testid="mock-cropper">
        <button
          type="button"
          data-testid="mock-crop-ready"
          onClick={() => {
            onMediaLoaded({ width: 320, height: 240, naturalWidth: 800, naturalHeight: 600 })
            onCropComplete({}, { x: 0, y: 0, width: 400, height: 300 })
          }}
        >
          ready
        </button>
        <button type="button" data-testid="mock-zoom-up" onClick={() => onZoomChange(Math.min(4, zoom + 0.5))}>
          zoom
        </button>
        <span data-testid="mock-zoom-value">{zoom}</span>
      </div>
    )
  },
}))

vi.mock('@/shared/lib/imageCrop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/imageCrop')>()
  return {
    ...actual,
    getCroppedImageFile: vi.fn(async () => new File([new Uint8Array([9])], 'cropped.jpg', { type: 'image/jpeg' })),
  }
})

import { ImageCropEditor } from '@/shared/ui/ImageCropEditor'
import { getCroppedImageFile } from '@/shared/lib/imageCrop'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ImageCropEditor', () => {
  it('cancels without producing a file', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })
    render(
      <ImageCropEditor open file={file} aspect={1} onCancel={onCancel} onConfirm={onConfirm} />,
    )
    fireEvent.click(screen.getByTestId('image-crop-cancel'))
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms with a cropped File after crop area is ready', async () => {
    const onConfirm = vi.fn()
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })
    render(
      <ImageCropEditor open file={file} aspect={1} onCancel={() => {}} onConfirm={onConfirm} />,
    )
    fireEvent.click(screen.getByTestId('mock-crop-ready'))
    fireEvent.click(screen.getByTestId('image-crop-confirm'))
    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    const out = onConfirm.mock.calls[0][0] as File
    expect(out.name).toBe('cropped.jpg')
    expect(getCroppedImageFile).toHaveBeenCalled()
  })

  it('updates zoom via the slider', () => {
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })
    render(
      <ImageCropEditor open file={file} aspect={null} onCancel={() => {}} onConfirm={() => {}} />,
    )
    const slider = screen.getByTestId('image-crop-zoom') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '2.5' } })
    expect(slider.value).toBe('2.5')
    expect(screen.getByTestId('mock-zoom-value').textContent).toBe('2.5')
  })

  it('resets zoom and calls pick-another', () => {
    const onPick = vi.fn()
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })
    render(
      <ImageCropEditor
        open
        file={file}
        aspect={1}
        onCancel={() => {}}
        onConfirm={() => {}}
        onPickAnother={onPick}
      />,
    )
    const slider = screen.getByTestId('image-crop-zoom') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('image-crop-reset'))
    expect(slider.value).toBe('1')
    fireEvent.click(screen.getByTestId('image-crop-pick-another'))
    expect(onPick).toHaveBeenCalled()
  })
})
