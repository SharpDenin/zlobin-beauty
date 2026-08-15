import { Node, mergeAttributes } from '@tiptap/core'

export type VideoAttrs = {
  src: string | null
  title?: string | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    video: {
      setVideo: (attrs: VideoAttrs) => ReturnType
    }
  }
}

/** Block video node for Salon-X knowledge articles (media content URL). */
export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'video[src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'video',
      mergeAttributes(HTMLAttributes, {
        controls: 'true',
        playsinline: 'true',
        style: 'max-width:100%;border-radius:12px',
      }),
    ]
  },

  addCommands() {
    return {
      setVideo:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },
})
