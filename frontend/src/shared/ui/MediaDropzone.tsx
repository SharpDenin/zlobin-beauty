import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  MEDIA_ACCEPT_IMAGES,
  MEDIA_MAX_BYTES_DEFAULT,
  uploadMedia,
  validateImageFile,
} from '@/shared/lib/mediaUpload'
import { MediaImage } from '@/shared/ui/MediaImage'

type DropzoneState = 'idle' | 'dragging' | 'uploading' | 'error' | 'preview'

type Props = {
  purpose: string
  value: string | null
  onChange: (mediaId: string | null) => void
  accept?: string
  maxBytes?: number
  label?: string
  disabled?: boolean
  className?: string
}

export function MediaDropzone({
  purpose,
  value,
  onChange,
  accept = MEDIA_ACCEPT_IMAGES,
  maxBytes = MEDIA_MAX_BYTES_DEFAULT,
  label = 'Перетащите фото или нажмите для выбора',
  disabled = false,
  className,
}: Props) {
  const { accessToken } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const inputId = useId()

  const [state, setState] = useState<DropzoneState>(value ? 'preview' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [localPreview, setLocalPreview] = useState<string | null>(null)

  useEffect(() => {
    if (value) {
      setState('preview')
      setError(null)
      clearObjectUrl()
      setLocalPreview(null)
      return
    }
    if (!localPreview) {
      setState((prev) => (prev === 'uploading' || prev === 'dragging' || prev === 'error' ? prev : 'idle'))
    }
    // sync when value changes from outside
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => () => clearObjectUrl(), [])

  function clearObjectUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }

  function setObjectPreview(file: File) {
    clearObjectUrl()
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setLocalPreview(url)
  }

  async function handleFile(file: File) {
    if (disabled) return
    const validation = validateImageFile(file, maxBytes)
    if (validation) {
      setError(validation)
      setState('error')
      return
    }
    if (!accessToken) {
      setError('Войдите, чтобы загрузить фото')
      setState('error')
      return
    }

    setError(null)
    setProgress(0)
    setState('uploading')
    setObjectPreview(file)

    try {
      const res = await uploadMedia(file, purpose, accessToken, setProgress)
      onChange(res.id)
      clearObjectUrl()
      setLocalPreview(null)
      setState('preview')
    } catch (e) {
      clearObjectUrl()
      setLocalPreview(null)
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить фото')
      setState('error')
    }
  }

  function openPicker() {
    if (disabled || state === 'uploading') return
    inputRef.current?.click()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openPicker()
    }
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (disabled || state === 'uploading') return
    setState('dragging')
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (state === 'dragging') setState(value || localPreview ? 'preview' : 'idle')
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (disabled || state === 'uploading') return
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
    else setState(value ? 'preview' : 'idle')
  }

  function remove() {
    if (disabled || state === 'uploading') return
    clearObjectUrl()
    setLocalPreview(null)
    setError(null)
    setProgress(0)
    setState('idle')
    onChange(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const showPreview = Boolean(localPreview || value)
  const classes = [
    'dropzone',
    state === 'dragging' ? 'dropzone-active' : '',
    showPreview ? 'dropzone-preview' : '',
    state === 'error' ? 'dropzone-error' : '',
    disabled ? 'dropzone-disabled' : '',
    className ?? '',
  ].filter(Boolean).join(' ')

  return (
    <div className="dropzone-wrap stack-sm">
      <div
        className={classes}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-disabled={disabled || state === 'uploading'}
        aria-busy={state === 'uploading'}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={accept}
          className="dropzone-input"
          disabled={disabled || state === 'uploading'}
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
            e.target.value = ''
          }}
        />

        {showPreview ? (
          <div className="dropzone-media">
            {localPreview ? (
              <img src={localPreview} alt="Превью загружаемого фото" />
            ) : value ? (
              <MediaImage mediaId={value} token={accessToken} alt="Загруженное фото" />
            ) : null}
          </div>
        ) : (
          <div className="dropzone-placeholder">
            <strong>{label}</strong>
            <span className="muted">JPEG, PNG или WebP · до {Math.round(maxBytes / (1024 * 1024))} МБ</span>
          </div>
        )}

        {state === 'uploading' && (
          <div className="dropzone-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="dropzone-progress-bar" style={{ width: `${progress}%` }} />
            <span>Загрузка… {progress}%</span>
          </div>
        )}
      </div>

      {error && <p className="field error" role="alert">{error}</p>}

      {(value || localPreview) && state !== 'uploading' && (
        <button
          type="button"
          className="btn btn-secondary btn-compact"
          disabled={disabled}
          aria-label="Удалить выбранное фото"
          onClick={(e) => {
            e.stopPropagation()
            remove()
          }}
        >
          Удалить фото
        </button>
      )}
    </div>
  )
}
