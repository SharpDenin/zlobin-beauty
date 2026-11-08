// @ts-nocheck — Vitest Node builtins; keep out of app tsc graph noise.
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'styles.css')
const css = readFileSync(cssPath, 'utf8')

describe('global user-select policy', () => {
  it('disables selection on body for UI chrome', () => {
    expect(css).toMatch(/body\s*\{[^}]*-webkit-user-select:\s*none/s)
    expect(css).toMatch(/body\s*\{[^}]*user-select:\s*none/s)
    expect(css).toMatch(/body\s*\{[^}]*-webkit-touch-callout:\s*none/s)
  })

  it('re-enables selection for editable controls and TipTap', () => {
    expect(css).toContain('input,')
    expect(css).toContain('textarea,')
    expect(css).toContain('select,')
    expect(css).toContain('[contenteditable]:not([contenteditable="false"])')
    expect(css).toContain('.ProseMirror')
    expect(css).toContain('.tiptap')
    expect(css).toMatch(/user-select:\s*text/)
    expect(css).toMatch(/-webkit-touch-callout:\s*default/)
  })
})
