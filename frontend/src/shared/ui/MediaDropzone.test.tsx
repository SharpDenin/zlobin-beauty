import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mediaMocks = vi.hoisted(() => ({
  uploadMedia: vi.fn(async () => ({ id: 'media-1', content_type: 'image/jpeg' })),
}))

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => 'blob:dropzone-test'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  })
})

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ accessToken: 'tok' }),
}))

vi.mock('@/shared/lib/mediaUpload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/mediaUpload')>()
  return { ...actual, uploadMedia: mediaMocks.uploadMedia }
})

vi.mock('@/shared/ui/ImageCropEditor', () => ({
  ImageCropEditor: ({
    open,
    file,
    onConfirm,
    onCancel,
  }: {
    open: boolean
    file: File | null
    onConfirm: (f: File) => void
    onCancel: () => void
  }) =>
    open && file ? (
      <div data-testid="image-crop-editor">
        <button type="button" data-testid="image-crop-confirm" onClick={() => onConfirm(file)}>
          Загрузить
        </button>
        <button type="button" data-testid="image-crop-cancel" onClick={onCancel}>
          Отмена
        </button>
      </div>
    ) : null,
}))

vi.mock('@/shared/ui/MediaImage', () => ({ MediaImage: () => <img alt="remote" /> }))
vi.mock('@/shared/ui/MediaVideo', () => ({ MediaVideo: () => <video /> }))

import { MediaDropzone } from '@/shared/ui/MediaDropzone'

afterEach(() => {
  cleanup()
  mediaMocks.uploadMedia.mockClear()
})

describe('MediaDropzone crop gate', () => {
  it('opens the crop editor for still photos and uploads the confirmed file', async () => {
    const onChange = vi.fn()
    render(<MediaDropzone purpose="profile" value={null} onChange={onChange} allowGif={false} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], 'face.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByTestId('image-crop-editor')).toBeTruthy()
    expect(mediaMocks.uploadMedia).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('image-crop-confirm'))
    await waitFor(() => expect(mediaMocks.uploadMedia).toHaveBeenCalled())
    expect(mediaMocks.uploadMedia).toHaveBeenCalledWith(file, 'profile', 'tok', expect.any(Function), expect.any(Object))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('media-1', expect.any(Object)))
  })

  it('cancels crop without uploading', async () => {
    const onChange = vi.fn()
    render(<MediaDropzone purpose="portfolio" value={null} onChange={onChange} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' })] },
    })
    await screen.findByTestId('image-crop-editor')
    fireEvent.click(screen.getByTestId('image-crop-cancel'))
    expect(screen.queryByTestId('image-crop-editor')).toBeNull()
    expect(mediaMocks.uploadMedia).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('skips crop for GIF and videos', async () => {
    const onChange = vi.fn()
    render(<MediaDropzone purpose="portfolio" value={null} onChange={onChange} allowVideo allowGif />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([1])], 'a.gif', { type: 'image/gif' })] },
    })
    await waitFor(() => expect(mediaMocks.uploadMedia).toHaveBeenCalled())
    expect(screen.queryByTestId('image-crop-editor')).toBeNull()
  })
})
