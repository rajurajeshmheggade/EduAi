import { useCallback, useState, useSyncExternalStore } from 'react'

/** At this width and up Copilot docks beside the page (the page shrinks); below it opens over the content. */
export const DOCK_MEDIA = '(min-width: 1024px)'
export const COPILOT_MIN_WIDTH = 320
export const COPILOT_MAX_WIDTH = 560
export const COPILOT_DEFAULT_WIDTH = 384
/** Ctrl/⌘ + J toggles Copilot anywhere (Ctrl/⌘ + K stays the command palette). */
export const COPILOT_SHORTCUT = { key: 'j', label: 'Ctrl J', aria: 'Control+J Meta+J' } as const

export const isCopilotShortcut = (e: KeyboardEvent) =>
  (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === COPILOT_SHORTCUT.key

export function clampCopilotWidth(w: number): number {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0
  // Never take more than ~40% of a wide screen, so the page keeps the larger share.
  const max = vw ? Math.max(COPILOT_MIN_WIDTH, Math.min(COPILOT_MAX_WIDTH, Math.round(vw * 0.4))) : COPILOT_MAX_WIDTH
  return Math.round(Math.min(max, Math.max(COPILOT_MIN_WIDTH, w)))
}

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    try {
      const m = window.matchMedia(query)
      m.addEventListener('change', onChange)
      return () => m.removeEventListener('change', onChange)
    } catch { return () => {} }
  }, [query])
  // No matchMedia (very old browsers, some test environments): assume a desktop-width window.
  const get = () => { try { return window.matchMedia(query).matches } catch { return true } }
  return useSyncExternalStore(subscribe, get, () => true)
}

interface Saved { open: boolean; width: number }

const storageKey = (userCode: string) => `eduai.copilot.${userCode}`

function read(userCode: string): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey(userCode)) ?? '{}') as Partial<Saved>
    return { open: v.open === true, width: typeof v.width === 'number' ? clampCopilotWidth(v.width) : COPILOT_DEFAULT_WIDTH }
  } catch {
    return { open: false, width: COPILOT_DEFAULT_WIDTH }
  }
}

function write(userCode: string, s: Saved) {
  try { localStorage.setItem(storageKey(userCode), JSON.stringify(s)) } catch { /* storage unavailable: just this visit */ }
}

/**
 * Copilot panel state for the signed-in user: open/closed and width are remembered per user. A remembered "open"
 * is restored only where the panel docks beside the page — on a narrow screen it would cover the content, so it
 * starts closed there.
 */
export function useCopilotDock(userCode: string) {
  const docked = useMediaQuery(DOCK_MEDIA)
  const [s, setS] = useState(() => {
    const saved = read(userCode)
    return { user: userCode, open: saved.open && docked, width: saved.width }
  })
  // Another account signed in without a reload: load that user's own preference.
  if (s.user !== userCode) {
    const saved = read(userCode)
    setS({ user: userCode, open: saved.open && docked, width: saved.width })
  }

  const setOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setS((cur) => {
      const open = typeof next === 'function' ? next(cur.open) : next
      write(cur.user, { open, width: cur.width })
      return { ...cur, open }
    })
  }, [])
  /** Live resize; `commit` stores the width (on pointer-up / key press, not on every pointer move). */
  const setWidth = useCallback((w: number, commit = true) => {
    setS((cur) => {
      const width = clampCopilotWidth(w)
      if (commit) write(cur.user, { open: cur.open, width })
      return { ...cur, width }
    })
  }, [])

  return { open: s.open, width: s.width, docked, setOpen, setWidth }
}
