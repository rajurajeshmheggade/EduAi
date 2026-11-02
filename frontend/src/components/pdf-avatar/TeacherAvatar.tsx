import { useEffect, useId, useRef } from 'react'
import { activeLipsync, readerAudio } from '@/lib/readerAudio'
import { blendInto, jawGain, mouthGeometry, REST, shapeFor } from '@/lib/visemes'
import type { AvatarVoice } from '@/services/readAloudService'

const SKIN = { base: '#c98d66', shade: '#ad7150', lip: { male: '#9a4c45', female: '#b4505d' } }
const MOUTH = { cx: 100, cy: 124 }

/**
 * The subject teacher's AI avatar (male or female). While it reads aloud, every animation frame asks wawa-lipsync
 * for the current viseme and loudness and blends the mouth, teeth and tongue towards that shape; it also blinks,
 * breathes and moves its head a little (head motion is off under prefers-reduced-motion).
 */
export function TeacherAvatar({ gender, speaking, label, className }: {
  gender: AvatarVoice
  speaking: boolean
  label: string
  className?: string
}) {
  const id = useId().replace(/:/g, '')
  const headRef = useRef<SVGGElement>(null)
  const bodyRef = useRef<SVGGElement>(null)
  const eyesRef = useRef<SVGGElement>(null)
  const browsRef = useRef<SVGGElement>(null)
  const mouthRef = useRef<SVGPathElement>(null)
  const lipsRef = useRef<SVGPathElement>(null)
  const clipRef = useRef<SVGPathElement>(null)
  const teethRef = useRef<SVGRectElement>(null)
  const tongueRef = useRef<SVGEllipseElement>(null)
  const ringRef = useRef<SVGCircleElement>(null)
  const speakingRef = useRef(speaking)
  useEffect(() => { speakingRef.current = speaking }, [speaking])

  useEffect(() => {
    const el = { head: headRef, body: bodyRef, eyes: eyesRef, brows: browsRef, mouth: mouthRef, lips: lipsRef,
                 clip: clipRef, teeth: teethRef, tongue: tongueRef, ring: ringRef }
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const cur = { ...REST }
    let raf = 0
    let vol = 0
    let nextBlink = performance.now() + 1800
    let blinkUntil = 0

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const lip = speakingRef.current ? activeLipsync() : null
      let target = REST
      let v = 0
      if (lip && !readerAudio().paused) {
        lip.processAudio()
        target = shapeFor(lip.viseme)
        v = lip.features?.volume ?? 0
      }
      blendInto(cur, target, target === REST ? 0.22 : target.open > 0.5 ? 0.38 : 0.5)
      vol += (v - vol) * 0.25

      const g = mouthGeometry(cur, MOUTH.cx, MOUTH.cy, target === REST ? 1 : jawGain(vol))
      el.mouth.current?.setAttribute('d', g.path)
      el.lips.current?.setAttribute('d', g.path)
      el.clip.current?.setAttribute('d', g.path)
      el.teeth.current?.setAttribute('y', (g.top - 0.5).toFixed(2))
      el.teeth.current?.setAttribute('opacity', (cur.teeth * Math.min(1, (g.bottom - g.top) / 3)).toFixed(2))
      el.tongue.current?.setAttribute('cy', (g.bottom - 1.2).toFixed(2))
      el.tongue.current?.setAttribute('opacity', (cur.tongue * Math.min(1, (g.bottom - g.top) / 4)).toFixed(2))
      el.ring.current?.setAttribute('opacity', (lip ? 0.18 + Math.min(0.5, vol * 1.2) : 0).toFixed(2))

      if (now > nextBlink) { blinkUntil = now + 130; nextBlink = now + 2400 + Math.random() * 3600 }
      const lid = now < blinkUntil ? 0.12 : 1
      el.eyes.current?.setAttribute('transform', `translate(0 ${(92 * (1 - lid)).toFixed(2)}) scale(1 ${lid})`)
      el.brows.current?.setAttribute('transform', `translate(0 ${(-Math.min(2.2, vol * 5) * (cur.open > 0.5 ? 1 : 0.4)).toFixed(2)})`)

      if (!still) {
        const t = now / 1000
        const talk = lip ? vol : 0
        const sway = Math.sin(t * 0.7) * 1.4 + Math.sin(t * 2.3) * talk * 2.2
        const nod = Math.sin(t * 3.1) * talk * 2.4
        el.head.current?.setAttribute('transform', `rotate(${sway.toFixed(2)} 100 150) translate(0 ${nod.toFixed(2)})`)
        el.body.current?.setAttribute('transform', `translate(0 ${(Math.sin(t * 1.6) * 0.9).toFixed(2)})`)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const g0 = mouthGeometry(REST, MOUTH.cx, MOUTH.cy)
  const male = gender === 'male'
  return (
    <svg viewBox="0 0 200 220" className={className} role="img" aria-label={label} data-avatar={gender}>
      <defs>
        <radialGradient id={`${id}-bg`} cx="50%" cy="42%" r="60%">
          <stop offset="0" stopColor={male ? '#c7d2fe' : '#fbcfe8'} />
          <stop offset="1" stopColor={male ? '#e0e7ff' : '#fdf2f8'} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-skin`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={SKIN.base} /><stop offset="1" stopColor={SKIN.shade} />
        </linearGradient>
        <clipPath id={`${id}-mouth`}><path ref={clipRef} d={g0.path} /></clipPath>
      </defs>

      <circle cx="100" cy="104" r="98" fill={`url(#${id}-bg)`} />
      <circle ref={ringRef} cx="100" cy="104" r="94" fill="none" stroke={male ? '#4f46e5' : '#db2777'} strokeWidth="3" opacity="0" />

      <g ref={bodyRef}>
        {male ? (
          <>
            <path d="M22 222c3-40 30-60 78-62 48 2 75 22 78 62z" fill="#3730a3" />
            <path d="M84 158 100 200 116 158z" fill="#e0ecff" />
            <path d="M84 158 93 179 100 166z M116 158 107 179 100 166z" fill="#ffffff" />
            <path d="M100 168 96 176 100 204 104 176z" fill="#b91c1c" />
            <path d="M74 166 92 210 84 222 62 222 66 176z M126 166 108 210 116 222 138 222 134 176z" fill="#312e81" />
          </>
        ) : (
          <>
            <path d="M24 222c3-38 28-58 76-60 48 2 73 22 76 60z" fill="#0f766e" />
            <path d="M86 162q14 22 28 0" fill={SKIN.shade} />
            <path d="M58 172c26 14 58 22 96 50h-36c-22-16-44-28-68-38z" fill="#db2777" opacity=".92" />
            <path d="M88 168q12 8 24 0" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
          </>
        )}
        <rect x="89" y="128" width="22" height="38" rx="10" fill={SKIN.shade} />
      </g>

      <g ref={headRef}>
        {!male && <path d="M58 98c-6-46 22-62 42-62s50 14 44 62c2 30 8 56-6 76H64c-14-20-8-46-6-76z" fill="#1f1530" />}
        <ellipse cx="60" cy="100" rx="6" ry="9" fill={SKIN.shade} />
        <ellipse cx="140" cy="100" rx="6" ry="9" fill={SKIN.shade} />
        <ellipse cx="100" cy="96" rx="40" ry="47" fill={`url(#${id}-skin)`} />
        {male ? (
          <path d="M59 92c-4-38 20-52 43-52 26 0 43 16 39 50-4-14-12-24-26-27-14 4-34 4-44 0-6 8-10 18-12 29z" fill="#1c1917" />
        ) : (
          <>
            <path d="M60 94c-2-36 18-48 40-48 24 0 42 12 40 48-8-20-22-32-38-34-2 8-22 22-42 34z" fill="#1f1530" />
            <circle cx="59" cy="112" r="2.8" fill="#f59e0b" />
            <circle cx="141" cy="112" r="2.8" fill="#f59e0b" />
          </>
        )}
        <g ref={browsRef} stroke={male ? '#1c1917' : '#2a1d3a'} strokeWidth={male ? 3.4 : 2.4} strokeLinecap="round" fill="none">
          <path d="M73 80q10-6 20-1" /><path d="M107 79q10-5 20 1" />
        </g>
        <g ref={eyesRef}>
          <ellipse cx="83" cy="92" rx="4.6" ry="5.6" fill="#1b1535" />
          <ellipse cx="117" cy="92" rx="4.6" ry="5.6" fill="#1b1535" />
          <circle cx="84.6" cy="90" r="1.5" fill="#fff" /><circle cx="118.6" cy="90" r="1.5" fill="#fff" />
          {!male && <path d="M77 88q6-5 12 0M111 88q6-5 12 0" stroke="#1b1535" strokeWidth="1.6" fill="none" strokeLinecap="round" />}
        </g>
        {male && (
          <g stroke="#1f2937" strokeWidth="2" fill="none">
            <rect x="71" y="83" width="24" height="17" rx="6" /><rect x="105" y="83" width="24" height="17" rx="6" />
            <path d="M95 90h10M71 89l-10-2M129 89l10-2" />
          </g>
        )}
        <path d="M100 98q-4 9 0 12q3 1 5-1" stroke={SKIN.shade} strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle cx="72" cy="112" r="7" fill="#f472b6" opacity={male ? 0.08 : 0.18} />
        <circle cx="128" cy="112" r="7" fill="#f472b6" opacity={male ? 0.08 : 0.18} />

        <path ref={mouthRef} d={g0.path} fill="#4a1622" />
        <g clipPath={`url(#${id}-mouth)`}>
          <rect ref={teethRef} x="86" y={g0.top} width="28" height="4.2" rx="1.5" fill="#fbfaf7" opacity="0" />
          <ellipse ref={tongueRef} cx="100" cy={g0.bottom} rx="8" ry="4" fill="#e0707f" opacity="0" />
        </g>
        <path ref={lipsRef} d={g0.path} fill="none" stroke={male ? SKIN.lip.male : SKIN.lip.female} strokeWidth="2.4" strokeLinejoin="round" />
      </g>
    </svg>
  )
}
