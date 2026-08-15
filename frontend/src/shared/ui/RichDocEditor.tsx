import { useEffect } from 'react'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { ApiError, API_BASE_URL } from '@/shared/api/client'
import { uploadMedia } from '@/shared/lib/mediaUpload'
import { Video } from '@/shared/ui/tiptapVideo'

type Props = {
  value?: JSONContent | null
  onChange: (doc: JSONContent) => void
  token?: string | null
  /** Media purpose for inline images. Backend supports `article`; fall back to `document`. */
  imagePurpose?: 'article' | 'document' | 'portfolio' | 'product'
  placeholder?: string
  disabled?: boolean
}

export function RichDocEditor({
  value,
  onChange,
  token,
  imagePurpose = 'article',
  placeholder = 'Напишите текст статьи…',
  disabled,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Image.configure({ allowBase64: false }),
      Video,
      Placeholder.configure({ placeholder }),
    ],
    content: value ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    editable: !disabled,
    onUpdate: ({ editor: ed }) => onChange(ed.getJSON()),
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!disabled)
  }, [editor, disabled])

  useEffect(() => {
    if (!editor || value == null) return
    const current = JSON.stringify(editor.getJSON())
    const next = JSON.stringify(value)
    if (current !== next) {
      editor.commands.setContent(value, { emitUpdate: false })
    }
  }, [editor, value])

  async function uploadImage() {
    if (!editor || !token) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const res = await uploadMedia(file, imagePurpose, token)
        const src = `${API_BASE_URL}/v1/media/${res.id}/content`
        editor.chain().focus().setImage({ src, alt: file.name }).run()
      } catch (e) {
        if (e instanceof ApiError) {
          // parent forms handle toast; keep editor usable
        }
      }
    }
    input.click()
  }

  async function uploadVideo() {
    if (!editor || !token) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'video/mp4,video/webm,video/quicktime'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const res = await uploadMedia(file, 'video', token, undefined, { allowVideo: true })
        const src = `${API_BASE_URL}/v1/media/${res.id}/content`
        editor.chain().focus().setVideo({ src, title: file.name }).run()
      } catch {
        /* keep editor usable */
      }
    }
    input.click()
  }

  function setLink() {
    if (!editor) return
    const prev = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Ссылка', prev ?? 'https://')
    if (url === null) return
    const trimmed = url.trim()
    if (!trimmed) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
  }

  if (!editor) return <div className="state-box">Загрузка редактора…</div>

  return (
    <div className={`rich-doc-editor${disabled ? ' is-disabled' : ''}`}>
      <div className="editor-toolbar" role="toolbar" aria-label="Форматирование">
        <button
          type="button"
          className={editor.isActive('heading', { level: 2 }) ? 'active' : ''}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </button>
        <button
          type="button"
          className={editor.isActive('bold') ? 'active' : ''}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          Ж
        </button>
        <button
          type="button"
          className={editor.isActive('italic') ? 'active' : ''}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          К
        </button>
        <button
          type="button"
          className={editor.isActive('bulletList') ? 'active' : ''}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          Список
        </button>
        <button
          type="button"
          className={editor.isActive('blockquote') ? 'active' : ''}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          Цитата
        </button>
        <button type="button" disabled={disabled} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          Разделитель
        </button>
        <button type="button" className={editor.isActive('link') ? 'active' : ''} disabled={disabled} onClick={setLink}>
          Ссылка
        </button>
        <button type="button" disabled={disabled || !token} onClick={() => void uploadImage()}>
          Изображение
        </button>
        <button type="button" disabled={disabled || !token} onClick={() => void uploadVideo()}>
          Видео
        </button>
      </div>
      <EditorContent editor={editor} className="rich-doc-surface" />
    </div>
  )
}

export function emptyDoc(): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

export function estimateReadingMinutes(doc: JSONContent | string | null | undefined): number {
  const text = typeof doc === 'string' ? doc : collectText(doc)
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (words === 0) return 0
  return Math.max(1, Math.ceil(words / 180))
}

export function docHasText(doc: JSONContent | null | undefined): boolean {
  return collectText(doc).trim().length >= 2
}

function collectText(node: JSONContent | null | undefined): string {
  if (!node) return ''
  const parts: string[] = []
  if (typeof node.text === 'string') parts.push(node.text)
  for (const child of node.content ?? []) {
    parts.push(collectText(child))
  }
  return parts.join(' ')
}
