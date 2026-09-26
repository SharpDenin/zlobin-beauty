type EscapeHandler = () => void

type LockSnapshot = {
  overflow: string
  htmlOverflow: string
  position: string
  top: string
  left: string
  right: string
  width: string
  paddingRight: string
  scrollY: number
}

let lockCount = 0
let saved: LockSnapshot | null = null
const escapeStack: EscapeHandler[] = []
let escapeBound = false
let touchBound = false

function scrollbarGap() {
  return Math.max(0, window.innerWidth - document.documentElement.clientWidth)
}

function applyLock() {
  const body = document.body
  const html = document.documentElement
  saved = {
    overflow: body.style.overflow,
    htmlOverflow: html.style.overflow,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    paddingRight: body.style.paddingRight,
    scrollY: window.scrollY || window.pageYOffset || 0,
  }
  const gap = scrollbarGap()
  body.style.overflow = 'hidden'
  html.style.overflow = 'hidden'
  body.style.position = 'fixed'
  body.style.top = `-${saved.scrollY}px`
  body.style.left = '0'
  body.style.right = '0'
  body.style.width = '100%'
  if (gap > 0) body.style.paddingRight = `${gap}px`
  body.classList.add('is-overlay-locked')
  bindTouchGuard()
}

function restoreLock() {
  const body = document.body
  const html = document.documentElement
  const snap = saved
  saved = null
  body.classList.remove('is-overlay-locked')
  unbindTouchGuard()
  if (!snap) return
  body.style.overflow = snap.overflow
  html.style.overflow = snap.htmlOverflow
  body.style.position = snap.position
  body.style.top = snap.top
  body.style.left = snap.left
  body.style.right = snap.right
  body.style.width = snap.width
  body.style.paddingRight = snap.paddingRight
  try {
    window.scrollTo(0, snap.scrollY)
  } catch {
    /* jsdom throws on scrollTo */
  }
}

function isInsideOverlayScroll(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  const scroller = target.closest('[data-overlay-scroll]')
  if (!scroller) return false
  return scroller.scrollHeight > scroller.clientHeight + 1
}

function onTouchMove(e: TouchEvent) {
  if (lockCount === 0) return
  if (isInsideOverlayScroll(e.target)) return
  e.preventDefault()
}

function onWheel(e: WheelEvent) {
  if (lockCount === 0) return
  if (isInsideOverlayScroll(e.target)) return
  e.preventDefault()
}

function bindTouchGuard() {
  if (touchBound) return
  document.addEventListener('touchmove', onTouchMove, { passive: false })
  document.addEventListener('wheel', onWheel, { passive: false })
  touchBound = true
}

function unbindTouchGuard() {
  if (!touchBound) return
  document.removeEventListener('touchmove', onTouchMove)
  document.removeEventListener('wheel', onWheel)
  touchBound = false
}

function onEscapeKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
  const top = escapeStack[escapeStack.length - 1]
  if (!top) return
  e.preventDefault()
  e.stopPropagation()
  top()
}

function bindEscape() {
  if (escapeBound) return
  document.addEventListener('keydown', onEscapeKey, true)
  escapeBound = true
}

function unbindEscape() {
  if (!escapeBound || escapeStack.length > 0) return
  document.removeEventListener('keydown', onEscapeKey, true)
  escapeBound = false
}

/** Lock document scroll. Call the returned function to release this claim. Nested-safe. */
export function acquireOverlayLock(): () => void {
  lockCount += 1
  if (lockCount === 1) applyLock()
  let released = false
  return () => {
    if (released) return
    released = true
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount === 0) restoreLock()
  }
}

export function registerOverlayEscape(handler: EscapeHandler): () => void {
  escapeStack.push(handler)
  bindEscape()
  return () => {
    const i = escapeStack.lastIndexOf(handler)
    if (i >= 0) escapeStack.splice(i, 1)
    unbindEscape()
  }
}

export function overlayLockCount() {
  return lockCount
}

export function isOverlayLocked() {
  return lockCount > 0
}

export function overlayEscapeDepth() {
  return escapeStack.length
}

/** Test-only: drop all locks and listeners. */
export function resetOverlayLockForTests() {
  lockCount = 0
  escapeStack.length = 0
  restoreLock()
  unbindEscape()
}
