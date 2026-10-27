import { useEffect, useRef } from 'react'

/** Close a floating menu on an outside mousedown or Escape. Returns the ref for the menu's wrapper. */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null)
  const closeRef = useRef(close)
  useEffect(() => { closeRef.current = close })
  useEffect(() => {
    if (!open) return
    const onDoc = (ev: MouseEvent) => { if (ref.current && ev.target instanceof Node && !ref.current.contains(ev.target)) closeRef.current() }
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeRef.current() }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return ref
}
