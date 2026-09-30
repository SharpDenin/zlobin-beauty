import type { KnowledgeCategoryNode } from '@/pages/knowledge-helpers'

type Props = {
  nodes: KnowledgeCategoryNode[]
  selected: string
  onSelect: (path: string) => void
}

export function CatalogTree({ nodes, selected, onSelect }: Props) {
  if (!nodes.length) return null
  return (
    <ul className="kb-tree">
      {nodes.map((node) => {
        const active = selected === node.path || selected.startsWith(`${node.path} / `)
        return (
          <li key={node.path}>
            <button
              type="button"
              className={`kb-tree-btn ${active ? 'is-on' : ''}`}
              aria-current={selected === node.path ? 'true' : undefined}
              onClick={() => onSelect(node.path)}
            >
              <span>{node.name}</span>
              <span className="muted">{node.count}</span>
            </button>
            {node.children.length > 0 && (
              <CatalogTree nodes={node.children} selected={selected} onSelect={onSelect} />
            )}
          </li>
        )
      })}
    </ul>
  )
}
