import { useId, useState } from 'react'
import type { KnowledgeCategoryNode } from '@/pages/knowledge-helpers'
import { knowledgeSectionToneClass } from '@/pages/knowledge-helpers'
import '@/features/knowledge/knowledge-tones.css'

type Props = {
  nodes: KnowledgeCategoryNode[]
  selected: string
  onSelect: (path: string) => void
  nested?: boolean
}

export function CatalogTree({ nodes, selected, onSelect, nested = false }: Props) {
  if (!nodes.length) return null
  return (
    <ul className="kb-tree" data-testid={nested ? undefined : 'kb-catalog-tree'}>
      {nodes.map((node) => {
        const active = selected === node.path || selected.startsWith(`${node.path} / `)
        const tone = knowledgeSectionToneClass(node.path)
        return (
          <li key={node.path}>
            <button
              type="button"
              className={`kb-tree-btn ${tone} ${active ? 'is-on' : ''}`}
              aria-current={selected === node.path ? 'true' : undefined}
              onClick={() => onSelect(node.path)}
            >
              <span>{node.name}</span>
              <span className="muted">{node.count}</span>
            </button>
            {node.children.length > 0 && (
              <CatalogTree nodes={node.children} selected={selected} onSelect={onSelect} nested />
            )}
          </li>
        )
      })}
    </ul>
  )
}

type AccordionProps = {
  nodes: KnowledgeCategoryNode[]
  selected: string
  onSelect: (path: string) => void
  onClear?: () => void
  title?: string
}

/** Catalog with mobile accordion so the tree does not push content down. */
export function CatalogTreeAccordion({
  nodes,
  selected,
  onSelect,
  onClear,
  title = 'Каталог',
}: AccordionProps) {
  const panelId = useId()
  // A deep link / restored filter starts expanded; after that the user owns the state
  // (picking a section on mobile collapses the tree again, it must not re-open itself).
  const [open, setOpen] = useState(Boolean(selected))
  if (!nodes.length) return null
  const collapseOnMobile = () => {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches) {
      setOpen(false)
    }
  }
  return (
    <section className={`card stack-sm kb-catalog ${open ? 'is-open' : ''}`}>
      <div className="row between wrap">
        <h2 className="kb-catalog-heading-desktop">{title}</h2>
        <button
          type="button"
          className="btn btn-secondary kb-catalog-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          <span>{title}{selected ? ` · ${selected.split(' / ').at(-1)}` : ''}</span>
          <span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
        {selected && onClear && (
          <button className="btn btn-ghost btn-compact" type="button" onClick={onClear}>
            Все разделы
          </button>
        )}
      </div>
      <div className="kb-catalog-panel" id={panelId}>
        <CatalogTree
          nodes={nodes}
          selected={selected}
          onSelect={(path) => {
            onSelect(path)
            collapseOnMobile()
          }}
        />
      </div>
    </section>
  )
}
