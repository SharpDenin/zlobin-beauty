import type { ReactNode } from 'react'
import type { JSONContent } from '@tiptap/react'
import { MediaImage } from '@/shared/ui/MediaImage'
import { API_BASE_URL } from '@/shared/api/client'

type Props = {
  content: string
  contentFormat?: string | null
  token?: string | null
  className?: string
}

export function RichDocRenderer({ content, contentFormat, token, className }: Props) {
  const format = (contentFormat || 'plain').toLowerCase()

  if (format === 'plain' || !content.trim()) {
    return (
      <div className={`prose-article ${className ?? ''}`.trim()} style={{ whiteSpace: 'pre-wrap' }}>
        {content || 'Нет текста'}
      </div>
    )
  }

  let doc: JSONContent | null = null
  try {
    const parsed = JSON.parse(content) as JSONContent
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
      doc = parsed
    }
  } catch {
    doc = null
  }

  if (!doc) {
    return (
      <div className={`prose-article ${className ?? ''}`.trim()} style={{ whiteSpace: 'pre-wrap' }}>
        {content}
      </div>
    )
  }

  return (
    <div className={`prose-article ${className ?? ''}`.trim()}>
      {(doc.content ?? []).map((node, idx) => (
        <DocNode key={idx} node={node} token={token} />
      ))}
    </div>
  )
}

function DocNode({ node, token }: { node: JSONContent; token?: string | null }) {
  switch (node.type) {
    case 'heading':
      return <h2>{inlineChildren(node)}</h2>
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
    case 'image': {
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
      const mediaId = mediaIdFromSrc(src)
      if (mediaId) {
        return (
          <figure>
            <MediaImage mediaId={mediaId} token={token} alt={alt} />
          </figure>
        )
      }
      return src ? (
        <figure>
          <img src={src} alt={alt} />
        </figure>
      ) : null
    }
    case 'video': {
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
      const title = typeof node.attrs?.title === 'string' ? node.attrs.title : 'Видео'
      if (!src) return null
      return (
        <figure className="article-video">
          <video src={src} controls playsInline preload="metadata" title={title} style={{ width: '100%', borderRadius: 12 }} />
          {title ? <figcaption className="muted">{title}</figcaption> : null}
        </figure>
      )
    }
    case 'callout': {
      const kind = typeof node.attrs?.kind === 'string' ? node.attrs.kind : 'tip'
      return (
        <aside className={`callout callout-${kind}`}>
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
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '#'
        el = (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {el}
          </a>
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
