import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Fades content up once it scrolls into view (no-op with reduced motion — the CSS rule shortens it to instant). */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setShown(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect() } }, { rootMargin: '0px 0px -10% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} style={{ transitionDelay: `${delay}ms` }}
      className={cn('transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]', shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0', className)}>
      {children}
    </div>
  )
}
