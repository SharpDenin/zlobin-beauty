import { useEffect, useState } from 'react'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { API_BASE_URL } from '@/shared/api/client'
import { MediaDropzone } from '@/shared/ui/MediaDropzone'
import { Video } from '@/shared/ui/tiptapVideo'
import { Callout } from '@/shared/ui/tiptapCallout'
import { sanitizeHref } from '@/shared/ui/richSanitize'
import { Modal } from '@/shared/ui/Modal'

type Props = {
  value?: JSONContent | null
  onChange: (doc: JSONContent) => void
  token?: string | null
  imagePurpose?: 'article' | 'document' | 'portfolio' | 'product'
  placeholder?: string
  disabled?: boolean
}

type InsertKind = 'image' | 'video' | null

export function RichDocEditor({
  value,
  onChange,
  token,
  imagePurpose = 'article',
  placeholder = 'Напишите текст статьи…',
  disabled,
}: Props) {
  const [insertKind, setInsertKind] = useState<InsertKind>(null)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Image.configure({ allowBase64: false }),
      Video,
      Callout,
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
    const safe = sanitizeHref(trimmed)
    if (!safe) return
    editor.chain().focus().extendMarkRange('link').setLink({ href: safe }).run()
  }

  function insertUploaded(mediaId: string | null, kind: 'image' | 'video') {
    if (!editor || !mediaId) return
    const src = `${API_BASE_URL}/v1/media/${mediaId}/content`
    editor.chain().focus()
    if (kind === 'video') {
      editor.chain().focus().setVideo({ src, title: 'Видео' }).run()
    } else {
      editor.chain().focus().setImage({ src }).run()
    }
    setInsertKind(null)
  }

  if (!editor) return <div className="state-box">Загрузка редактора…</div>

  return (
    <div className={`rich-doc-editor${disabled ? ' is-disabled' : ''}`}>
      <div className="editor-toolbar" role="toolbar" aria-label="Форматирование">
        <button type="button" className={editor.isActive('heading', { level: 1 }) ? 'active' : ''} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</button>
        <button type="button" className={editor.isActive('heading', { level: 2 }) ? 'active' : ''} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
        <button type="button" className={editor.isActive('heading', { level: 3 }) ? 'active' : ''} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button>
        <button type="button" className={editor.isActive('bold') ? 'active' : ''} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}>Ж</button>
        <button type="button" className={editor.isActive('italic') ? 'active' : ''} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}>К</button>
        <button type="button" className={editor.isActive('bulletList') ? 'active' : ''} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}>Список</button>
        <button type="button" className={editor.isActive('blockquote') ? 'active' : ''} disabled={disabled} onClick={() => editor.chain().focus().toggleBlockquote().run()}>Цитата</button>
        <button type="button" disabled={disabled} onClick={() => editor.chain().focus().setCallout('tip').run()}>Совет</button>
        <button type="button" disabled={disabled} onClick={() => editor.chain().focus().setCallout('warning').run()}>Важно</button>
        <button type="button" disabled={disabled} onClick={() => editor.chain().focus().setHorizontalRule().run()}>Разделитель</button>
        <button type="button" className={editor.isActive('link') ? 'active' : ''} disabled={disabled} onClick={setLink}>Ссылка</button>
        <button type="button" disabled={disabled || !token} onClick={() => setInsertKind('image')}>Изображение</button>
        <button type="button" disabled={disabled || !token} onClick={() => setInsertKind('video')}>Видео</button>
      </div>
      <EditorContent editor={editor} className="rich-doc-surface" />
      <Modal
        open={Boolean(insertKind)}
        onClose={() => setInsertKind(null)}
        title={insertKind === 'video' ? 'Вставить видео' : 'Вставить изображение'}
      >
        <p className="muted">Файл загрузится и встанет в текущую позицию текста.</p>
        {insertKind && (
          <MediaDropzone
            purpose={insertKind === 'video' ? 'video' : imagePurpose}
            value={null}
            allowVideo={insertKind === 'video'}
            onChange={(id) => insertUploaded(id, insertKind)}
            label={insertKind === 'video' ? 'Перетащите видео или нажмите для выбора' : 'Перетащите изображение или нажмите для выбора'}
          />
        )}
        <button className="btn btn-secondary" type="button" onClick={() => setInsertKind(null)}>Отмена</button>
      </Modal>
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
