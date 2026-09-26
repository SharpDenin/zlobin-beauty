import { useState, type ReactNode } from 'react'
import type { JSONContent } from '@tiptap/react'
import { MediaImage } from '@/shared/ui/MediaImage'
import { API_BASE_URL } from '@/shared/api/client'
import { sanitizeHref, sanitizeMediaSrc } from '@/shared/ui/richSanitize'
import { Overlay } from '@/shared/ui/Overlay'
import { parseKnowledgeDoc } from '@/pages/knowledge-helpers'

type Props = {
  content: string | JSONContent | null | undefined
  contentFormat?: string | null
  token?: string | null
  className?: string
}

export function RichDocRenderer({ content, contentFormat, token, className }: Props) {
  const format = (contentFormat || 'plain').toLowerCase()
  const classNames = `prose-article ${className ?? ''}`.trim()

  if (format === 'plain' && typeof content === 'string') {
    return (
      <div className={classNames} style={{ whiteSpace: 'pre-wrap' }}>
        {content.trim() ? content : 'Нет текста'}
      </div>
    )
  }

  const doc = parseKnowledgeDoc(content, format)
  const nodes = doc.content ?? []
  if (nodes.length === 0) {
    return (
      <div className={classNames} style={{ whiteSpace: 'pre-wrap' }}>
        Нет текста
      </div>
    )
  }

  return (
    <div className={classNames}>
      {nodes.map((node, idx) => (
        <DocNode key={idx} node={node} token={token} />
      ))}
    </div>
  )
}

function headingTag(level: unknown) {
  if (level === 1) return 'h1'
  if (level === 3) return 'h3'
  return 'h2'
}

function DocNode({ node, token }: { node: JSONContent; token?: string | null }) {
  switch (node.type) {
    case 'heading': {
      const Tag = headingTag(node.attrs?.level) as 'h1' | 'h2' | 'h3'
      return <Tag>{inlineChildren(node)}</Tag>
    }
    case 'paragraph':
      return <p>{inlineChildren(node)}</p>
    case 'bulletList':
      return (
        <ul>
          {(node.content ?? []).map((item, i) => (
            <li key={i}>{(item.content ?? []).map((child, j) => <DocNode key={j} node={child} token={token} />)}</li>
          ))}
        </ul>
      )
    case 'orderedList':
      return (
        <ol>
          {(node.content ?? []).map((item, i) => (
            <li key={i}>{(item.content ?? []).map((child, j) => <DocNode key={j} node={child} token={token} />)}</li>
          ))}
        </ol>
      )
    case 'blockquote':
      return <blockquote>{(node.content ?? []).map((child, i) => <DocNode key={i} node={child} token={token} />)}</blockquote>
    case 'horizontalRule':
      return <hr />
    case 'image':
      return <ArticleImage node={node} token={token} />
    case 'video':
      return <ArticleVideo node={node} />
    case 'callout': {
      const kind = typeof node.attrs?.kind === 'string' ? node.attrs.kind : 'tip'
      const label = kind === 'warning' ? 'Важно' : kind === 'note' ? 'Заметка' : 'Совет'
      return (
        <aside className={`callout callout-${kind}`}>
          <strong className="callout-label">{label}</strong>
          {(node.content ?? []).map((child, i) => <DocNode key={i} node={child} token={token} />)}
        </aside>
      )
    }
    case 'hardBreak':
      return <br />
    default:
      if (node.content?.length) {
        return <>{(node.content ?? []).map((child, i) => <DocNode key={i} node={child} token={token} />)}</>
      }
      return null
  }
}

function ArticleImage({ node, token }: { node: JSONContent; token?: string | null }) {
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const raw = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
  const src = sanitizeMediaSrc(raw)
  const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
  const caption = typeof node.attrs?.title === 'string' ? node.attrs.title : alt
  if (!src || failed) {
    return <p className="muted">Изображение недоступно</p>
  }
  const mediaId = mediaIdFromSrc(src)
  const img = mediaId ? (
    <MediaImage mediaId={mediaId} token={token} alt={alt} />
  ) : (
    <img src={src} alt={alt} onError={() => setFailed(true)} />
  )
  return (
    <figure className="article-figure">
      <button type="button" className="article-figure-btn" onClick={() => setOpen(true)} aria-label="Увеличить изображение">
        {img}
      </button>
      {caption ? <figcaption className="muted">{caption}</figcaption> : null}
      <Overlay
        open={open}
        onClose={() => setOpen(false)}
        className="kb-lightbox overlay-scrim"
        closeOnAnyClick
        label="Просмотр изображения"
      >
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} data-overlay-initial-focus>
          Закрыть
        </button>
        {mediaId ? <MediaImage mediaId={mediaId} token={token} alt={alt} /> : <img src={src} alt={alt} />}
      </Overlay>
    </figure>
  )
}

function ArticleVideo({ node }: { node: JSONContent }) {
  const [failed, setFailed] = useState(false)
  const raw = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
  const src = sanitizeMediaSrc(raw)
  const title = typeof node.attrs?.title === 'string' ? node.attrs.title : 'Видео'
  const poster = typeof node.attrs?.poster === 'string' ? sanitizeMediaSrc(node.attrs.poster) : null
  if (!src || failed) {
    return <p className="muted">Видео недоступно</p>
  }
  return (
    <figure className="article-video">
      <div className="article-video-wrap">
        <video
          src={src}
          poster={poster ?? undefined}
          controls
          playsInline
          preload="metadata"
          title={title}
          onError={() => setFailed(true)}
        />
      </div>
      {title ? <figcaption className="muted">{title}</figcaption> : null}
    </figure>
  )
}

function inlineChildren(node: JSONContent): ReactNode {
  return (node.content ?? []).map((child, i) => <InlineNode key={i} node={child} />)
}

function InlineNode({ node }: { node: JSONContent }) {
  if (node.type === 'hardBreak') return <br />
  if (node.type === 'text') {
    let el: ReactNode = node.text ?? ''
    const marks = node.marks ?? []
    for (const mark of marks) {
      if (mark.type === 'bold') el = <strong>{el}</strong>
      if (mark.type === 'italic') el = <em>{el}</em>
      if (mark.type === 'link') {
        const href = sanitizeHref(typeof mark.attrs?.href === 'string' ? mark.attrs.href : '')
        el = href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {el}
          </a>
        ) : (
          <span>{el}</span>
        )
      }
    }
    return <>{el}</>
  }
  return null
}

function mediaIdFromSrc(src: string): string | null {
  if (!src) return null
  try {
    const base = API_BASE_URL.replace(/\/$/, '')
    const prefix = `${base}/v1/media/`
    if (src.startsWith(prefix) && src.includes('/content')) {
      const rest = src.slice(prefix.length)
      return rest.split('/')[0] || null
    }
  } catch {
    /* ignore */
  }
  const m = src.match(/\/v1\/media\/([^/]+)\/content/)
  return m?.[1] ?? null
}
