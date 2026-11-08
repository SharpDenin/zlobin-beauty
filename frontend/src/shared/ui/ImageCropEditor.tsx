import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Cropper, { type Area, type MediaSize } from 'react-easy-crop'
import { Overlay } from '@/shared/ui/Overlay'
import {
  CROP_MAX_ZOOM,
  CROP_MIN_ZOOM,
  CROP_ZOOM_STEP,
  getCroppedImageFile,
  type CropPixelArea,
} from '@/shared/lib/imageCrop'

type Props = {
  open: boolean
  file: File | null
  /** Fixed aspect; omit/`null` keeps the source image ratio once media loads. */
  aspect?: number | null
  title?: string
  confirmLabel?: string
  onConfirm: (file: File) => void
  onCancel: () => void
  onPickAnother?: () => void
}

const DEFAULT_CROP = { x: 0, y: 0 }

export function ImageCropEditor({
  open,
  file,
  aspect = null,
  title = 'Обрезка фото',
  confirmLabel = 'Сохранить',
  onConfirm,
  onCancel,
  onPickAnother,
}: Props) {
  const titleId = useId()
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState(DEFAULT_CROP)
  const [zoom, setZoom] = useState(CROP_MIN_ZOOM)
  const [resolvedAspect, setResolvedAspect] = useState(aspect ?? 1)
  const [pixels, setPixels] = useState<CropPixelArea | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const revokeSrc = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!open || !file) {
      revokeSrc()
      setImageSrc(null)
      setPixels(null)
      setError(null)
      setBusy(false)
      setZoom(CROP_MIN_ZOOM)
      setCrop(DEFAULT_CROP)
      return
    }
    revokeSrc()
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setImageSrc(url)
    setZoom(CROP_MIN_ZOOM)
    setCrop(DEFAULT_CROP)
    setPixels(null)
    setError(null)
    setBusy(false)
    if (aspect != null && aspect > 0) setResolvedAspect(aspect)
    else setResolvedAspect(1)
    return () => revokeSrc()
  }, [open, file, aspect, revokeSrc])

  const onMediaLoaded = useCallback(
    (mediaSize: MediaSize) => {
      if (aspect != null && aspect > 0) {
        setResolvedAspect(aspect)
        return
      }
      const w = mediaSize.naturalWidth || mediaSize.width
      const h = mediaSize.naturalHeight || mediaSize.height
      if (w > 0 && h > 0) setResolvedAspect(w / h)
    },
    [aspect],
  )

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setPixels({
      x: areaPixels.x,
      y: areaPixels.y,
      width: areaPixels.width,
      height: areaPixels.height,
    })
  }, [])

  function resetView() {
    setZoom(CROP_MIN_ZOOM)
    setCrop(DEFAULT_CROP)
    setError(null)
  }

  async function confirm() {
    if (!imageSrc || !pixels || busy) return
    setBusy(true)
    setError(null)
    try {
      const cropped = await getCroppedImageFile(imageSrc, pixels, file?.name || 'photo.jpg')
      onConfirm(cropped)
    } catch {
      setError('Не удалось обрезать изображение. Попробуйте другое фото.')
      setBusy(false)
    }
  }

  if (!open || !file) return null

  return (
    <Overlay
      open={open}
      onClose={onCancel}
      closeOnBackdrop={false}
      closeOnEscape={!busy}
      labelledBy={titleId}
      className="modal-backdrop overlay-scrim image-crop-backdrop"
      label={title}
    >
      <div className="image-crop-sheet" data-testid="image-crop-editor" role="document">
        <header className="image-crop-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            onClick={onCancel}
            disabled={busy}
            aria-label="Отменить"
            data-overlay-initial-focus
            data-testid="image-crop-cancel"
          >
            Отмена
          </button>
        </header>

        <div className="image-crop-stage" data-testid="image-crop-stage">
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={resolvedAspect}
              minZoom={CROP_MIN_ZOOM}
              maxZoom={CROP_MAX_ZOOM}
              zoomWithScroll
              showGrid
              restrictPosition
              objectFit="contain"
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              onMediaLoaded={onMediaLoaded}
              classes={{
                containerClassName: 'image-crop-container',
                mediaClassName: 'image-crop-media',
                cropAreaClassName: 'image-crop-area',
              }}
            />
          )}
        </div>

        <footer className="image-crop-footer">
          <label className="image-crop-zoom">
            <span className="muted">Масштаб</span>
            <input
              type="range"
              min={CROP_MIN_ZOOM}
              max={CROP_MAX_ZOOM}
              step={CROP_ZOOM_STEP}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              disabled={busy}
              aria-label="Масштаб изображения"
              data-testid="image-crop-zoom"
            />
          </label>

          {error && (
            <p className="image-crop-error" role="alert">
              {error}
            </p>
          )}

          <div className="image-crop-actions">
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              onClick={resetView}
              disabled={busy}
              data-testid="image-crop-reset"
            >
              Сбросить
            </button>
            {onPickAnother && (
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                onClick={onPickAnother}
                disabled={busy}
                data-testid="image-crop-pick-another"
              >
                Другое фото
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void confirm()}
              disabled={busy || !pixels}
              data-testid="image-crop-confirm"
            >
              {busy ? 'Обработка…' : confirmLabel}
            </button>
          </div>
        </footer>
      </div>
    </Overlay>
  )
}
