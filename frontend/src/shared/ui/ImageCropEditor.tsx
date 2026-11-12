import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'
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
  /** Fixed aspect; omit/`null` = free resize on both axes (corners + edges). */
  aspect?: number | null
  title?: string
  confirmLabel?: string
  onConfirm: (file: File) => void
  onCancel: () => void
  onPickAnother?: () => void
}

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
  const imgRef = useRef<HTMLImageElement>(null)
  const cropperRef = useRef<Cropper | null>(null)
  const baseRatioRef = useRef(1)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [zoom, setZoom] = useState(CROP_MIN_ZOOM)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const objectUrlRef = useRef<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)

  const revokeSrc = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setPreviewUrl(null)
  }, [])

  useEffect(() => {
    if (!open || !file) {
      cropperRef.current?.destroy()
      cropperRef.current = null
      revokeSrc()
      revokePreview()
      setImageSrc(null)
      setError(null)
      setBusy(false)
      setReady(false)
      setZoom(CROP_MIN_ZOOM)
      return
    }
    revokeSrc()
    revokePreview()
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setImageSrc(url)
    setZoom(CROP_MIN_ZOOM)
    setError(null)
    setBusy(false)
    setReady(false)
    return () => {
      cropperRef.current?.destroy()
      cropperRef.current = null
      revokeSrc()
      revokePreview()
    }
  }, [open, file, aspect, revokeSrc, revokePreview])

  useEffect(() => {
    if (!open || !imageSrc || !imgRef.current) return
    const img = imgRef.current
    cropperRef.current?.destroy()
    cropperRef.current = null
    setReady(false)

    const freeAspect = aspect == null || !(aspect > 0)
    let disposed = false

    const refreshPreview = (cropper: Cropper) => {
      try {
        const canvas = cropper.getCroppedCanvas({
          maxWidth: 280,
          maxHeight: 280,
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'medium',
        })
        if (!canvas || disposed) return
        canvas.toBlob((blob) => {
          if (!blob || disposed) return
          if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
          const next = URL.createObjectURL(blob)
          previewUrlRef.current = next
          setPreviewUrl(next)
        }, 'image/jpeg', 0.8)
      } catch {
        /* preview is best-effort */
      }
    }

    const cropper = new Cropper(img, {
      viewMode: 1,
      dragMode: 'move',
      aspectRatio: freeAspect ? NaN : aspect,
      autoCropArea: 0.85,
      responsive: true,
      background: false,
      guides: true,
      center: true,
      highlight: false,
      cropBoxMovable: true,
      cropBoxResizable: true,
      toggleDragModeOnDblclick: false,
      zoomable: true,
      zoomOnWheel: true,
      zoomOnTouch: true,
      scalable: false,
      rotatable: false,
      ready() {
        if (disposed) return
        const canvas = cropper.getCanvasData()
        const natural = cropper.getImageData().naturalWidth || 1
        baseRatioRef.current = canvas.width / natural
        setReady(true)
        setZoom(CROP_MIN_ZOOM)
        refreshPreview(cropper)
      },
      crop() {
        if (!disposed) refreshPreview(cropper)
      },
      zoom() {
        if (disposed) return
        const canvas = cropper.getCanvasData()
        const natural = cropper.getImageData().naturalWidth || 1
        const relative = canvas.width / natural / (baseRatioRef.current || 1)
        const clamped = Math.min(CROP_MAX_ZOOM, Math.max(CROP_MIN_ZOOM, relative))
        setZoom(Number(clamped.toFixed(2)))
      },
    })
    cropperRef.current = cropper

    return () => {
      disposed = true
      cropper.destroy()
      if (cropperRef.current === cropper) cropperRef.current = null
    }
  }, [open, imageSrc, aspect])

  function resetView() {
    const cropper = cropperRef.current
    if (!cropper) return
    cropper.reset()
    const canvas = cropper.getCanvasData()
    const natural = cropper.getImageData().naturalWidth || 1
    baseRatioRef.current = canvas.width / natural
    setZoom(CROP_MIN_ZOOM)
    setError(null)
  }

  function onZoomSlider(value: number) {
    const cropper = cropperRef.current
    if (!cropper) return
    const next = Math.min(CROP_MAX_ZOOM, Math.max(CROP_MIN_ZOOM, value))
    cropper.zoomTo((baseRatioRef.current || 1) * next)
    setZoom(next)
  }

  function readPixelCrop(): CropPixelArea | null {
    const cropper = cropperRef.current
    if (!cropper) return null
    const data = cropper.getData(true)
    if (!data.width || !data.height) return null
    return {
      x: data.x,
      y: data.y,
      width: data.width,
      height: data.height,
    }
  }

  async function confirm() {
    if (!imageSrc || busy) return
    const pixels = readPixelCrop()
    if (!pixels) {
      setError('Выделите область обрезки')
      return
    }
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
            <img
              ref={imgRef}
              src={imageSrc}
              alt=""
              className="image-crop-media"
              data-testid="image-crop-source"
            />
          )}
        </div>

        <footer className="image-crop-footer">
          <div className="image-crop-preview-row">
            <label className="image-crop-zoom">
              <span className="muted">Масштаб</span>
              <input
                type="range"
                min={CROP_MIN_ZOOM}
                max={CROP_MAX_ZOOM}
                step={CROP_ZOOM_STEP}
                value={zoom}
                onChange={(e) => onZoomSlider(Number(e.target.value))}
                disabled={busy || !ready}
                aria-label="Масштаб изображения"
                data-testid="image-crop-zoom"
              />
            </label>
            {previewUrl && (
              <div className="image-crop-preview" data-testid="image-crop-preview">
                <span className="muted caption">Результат</span>
                <img src={previewUrl} alt="Предпросмотр обрезки" />
              </div>
            )}
          </div>

          <p className="muted caption image-crop-hint">
            Тяните рамку за углы и стороны. Перетаскивайте фото. Pinch и колёсико — масштаб.
          </p>

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
              disabled={busy || !ready}
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
              disabled={busy || !ready}
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
