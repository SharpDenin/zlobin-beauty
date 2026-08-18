import { Node, mergeAttributes } from '@tiptap/core'

export type CalloutKind = 'tip' | 'warning' | 'note'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (kind?: CalloutKind) => ReturnType
    }
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      kind: { default: 'tip' },
    }
  },

  parseHTML() {
    return [{ tag: 'aside[data-callout]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const kind = HTMLAttributes.kind || 'tip'
    return [
      'aside',
      mergeAttributes(HTMLAttributes, {
        'data-callout': kind,
        class: `callout callout-${kind}`,
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setCallout:
        (kind = 'tip') =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { kind },
            content: [{ type: 'paragraph' }],
          }),
    }
  },
})
