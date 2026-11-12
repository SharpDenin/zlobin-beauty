import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const zoomTo = vi.fn()
const reset = vi.fn()
const destroy = vi.fn()
const getData = vi.fn(() => ({ x: 10, y: 20, width: 400, height: 300, rotate: 0, scaleX: 1, scaleY: 1 }))
const getCanvasData = vi.fn(() => ({ left: 0, top: 0, width: 400, height: 300, naturalWidth: 800, naturalHeight: 600 }))
const getImageData = vi.fn(() => ({
  left: 0,
  top: 0,
  width: 400,
  height: 300,
  rotate: 0,
  scaleX: 1,
  scaleY: 1,
  naturalWidth: 800,
  naturalHeight: 600,
  aspectRatio: 4 / 3,
}))
const getCroppedCanvas = vi.fn(() => {
  const canvas = document.createElement('canvas')
  canvas.width = 80
  canvas.height = 80
  canvas.toBlob = (cb: BlobCallback) => cb(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }))
  return canvas
})
const cropperOptions: Array<Record<string, unknown>> = []

vi.mock('cropperjs', () => {
  function MockCropper(
    _img: HTMLImageElement,
    options: {
      ready?: () => void
      crop?: () => void
      aspectRatio?: number
      cropBoxResizable?: boolean
      dragMode?: string
      viewMode?: number
      zoomOnTouch?: boolean
      zoomOnWheel?: boolean
    },
  ) {
    cropperOptions.push(options as Record<string, unknown>)
    queueMicrotask(() => {
      options.ready?.()
      options.crop?.()
    })
    return {
      destroy,
      reset,
      zoomTo,
      getData,
      getCanvasData,
      getImageData,
      getCroppedCanvas,
    }
  }
  return { default: MockCropper }
})

vi.mock('cropperjs/dist/cropper.css', () => ({}))

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
  cropperOptions.length = 0
})

describe('ImageCropEditor', () => {
  it('configures free vs fixed aspect for CropperJS', async () => {
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })
    const { unmount } = render(
      <ImageCropEditor open file={file} aspect={null} onCancel={() => {}} onConfirm={() => {}} />,
    )
    await waitFor(() => expect(cropperOptions.length).toBeGreaterThan(0))
    expect(Number.isNaN(cropperOptions[0].aspectRatio as number)).toBe(true)
    expect(cropperOptions[0]).toMatchObject({
      viewMode: 1,
      dragMode: 'move',
      cropBoxResizable: true,
      zoomOnTouch: true,
      zoomOnWheel: true,
    })
    unmount()
    cropperOptions.length = 0
    render(<ImageCropEditor open file={file} aspect={1} onCancel={() => {}} onConfirm={() => {}} />)
    await waitFor(() => expect(cropperOptions.length).toBeGreaterThan(0))
    expect(cropperOptions[0].aspectRatio).toBe(1)
  })

  it('cancels without producing a file', async () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })
    render(
      <ImageCropEditor open file={file} aspect={1} onCancel={onCancel} onConfirm={onConfirm} />,
    )
    await waitFor(() => expect(screen.getByTestId('image-crop-confirm')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('image-crop-cancel'))
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms with a cropped File after cropper is ready', async () => {
    const onConfirm = vi.fn()
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })
    render(
      <ImageCropEditor open file={file} aspect={1} onCancel={() => {}} onConfirm={onConfirm} />,
    )
    await waitFor(() => expect(screen.getByTestId('image-crop-confirm')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('image-crop-confirm'))
    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    const out = onConfirm.mock.calls[0][0] as File
    expect(out.name).toBe('cropped.jpg')
    expect(getCroppedImageFile).toHaveBeenCalledWith(
      'blob:crop-test',
      { x: 10, y: 20, width: 400, height: 300 },
      'a.jpg',
    )
    expect(getData).toHaveBeenCalledWith(true)
  })

  it('updates zoom via the slider', async () => {
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })
    render(
      <ImageCropEditor open file={file} aspect={null} onCancel={() => {}} onConfirm={() => {}} />,
    )
    await waitFor(() => expect(screen.getByTestId('image-crop-zoom')).not.toBeDisabled())
    const slider = screen.getByTestId('image-crop-zoom') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '2.5' } })
    expect(zoomTo).toHaveBeenCalled()
    expect(Number(slider.value)).toBeCloseTo(2.5)
  })

  it('shows a live preview once ready', async () => {
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })
    render(
      <ImageCropEditor open file={file} aspect={null} onCancel={() => {}} onConfirm={() => {}} />,
    )
    await waitFor(() => expect(screen.getByTestId('image-crop-preview')).toBeInTheDocument())
  })
})
