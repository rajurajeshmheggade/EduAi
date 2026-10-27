import type { CSSProperties } from 'react'

/* Content miniatures for resource cards — ported VERBATIM from Rapid's restypeThumb.jsx. Instead of
   illustrations, each thumbnail renders a scaled-down version of the real medium (a page, a slide, a
   video frame), so the card reads like a preview of the actual asset. This is ART, so the drawing keeps
   Rapid's exact inline declarations and colours; only the types were added. */

/** css('width:100%;height:48px') → { width:'100%', height:'48px' } (Rapid's lib/css.js, typed). */
function css(str: string): CSSProperties {
  const out: Record<string, string> = {}
  for (const decl of str.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const prop = decl.slice(0, i).trim()
    const val = decl.slice(i + 1).trim()
    if (!prop || !val) continue
    if (prop.startsWith('--')) { out[prop] = val; continue }
    out[prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = val
  }
  return out as CSSProperties
}

const FONT = "font-family:'Poppins',system-ui,sans-serif;"

// deterministic pseudo-random from a string, so a title always gets the same line rhythm
function seedOf(s: string) {
  let n = 0
  for (let i = 0; i < (s || '').length; i++) n = (n * 31 + s.charCodeAt(i)) % 100000
  return n
}
function widths(seed: number, count: number, min: number, max: number) {
  const out: number[] = []
  let n = seed || 7
  for (let i = 0; i < count; i++) {
    n = (n * 1103515245 + 12345) % 2147483647
    out.push(min + (n % (max - min)))
  }
  return out
}

interface ArtProps { title: string; meta: string; seed: number }

// paper sheet with a header band and ruled lines — worksheet / reference / notes
function DocPage({ title, meta, kind, seed }: ArtProps & { kind: string }) {
  const lines = widths(seed, 7, 42, 96)
  const numbered = kind === 'worksheet'
  return (
    <div style={css('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#EEF1F6,#E3E8F0);padding:9px 0 0;')}>
      <div style={css('position:relative;width:64%;height:112%;background:#fff;border:1px solid #DDE3EC;border-top-left-radius:3px;border-top-right-radius:3px;box-shadow:0 6px 14px -6px rgba(16,42,84,.35),0 1px 0 rgba(16,42,84,.06);padding:7px 8px 0;overflow:hidden;' + FONT)}>
        <div style={css('font-size:4.4px;font-weight:700;color:#1A2740;line-height:1.25;letter-spacing:.01em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;')}>{title}</div>
        <div style={css('font-size:3.4px;color:#8A93A2;margin-top:1.5px;')}>{meta}</div>
        <div style={css('height:1px;background:#E4E9F0;margin:4px 0 5px;')} />
        <div style={css('display:flex;flex-direction:column;gap:3.2px;')}>
          {lines.map((w, i) => (
            <div key={i} style={css('display:flex;align-items:center;gap:2.5px;')}>
              {numbered && <span style={css('flex:none;font-size:3.2px;font-weight:600;color:#0070E0;width:4px;')}>{i + 1}.</span>}
              <span style={css('height:2px;border-radius:1px;background:' + (i % 3 === 0 ? '#CBD4E1' : '#E1E7EF') + ';width:' + w + '%;')} />
            </div>
          ))}
        </div>
        {numbered && (
          <div style={css('margin-top:4px;border:.6px dashed #D9E1EC;border-radius:2px;height:14px;')} />
        )}
      </div>
    </div>
  )
}

// 16:9 slide with a deck peeking behind — slides
function SlideDeck({ title, meta, seed }: ArtProps) {
  const bullets = widths(seed, 3, 48, 92)
  return (
    <div style={css('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#F1EEFA,#E6E2F5);' + FONT)}>
      <div style={css('position:relative;width:78%;')}>
        <div style={css('position:absolute;left:5px;top:-5px;right:-5px;height:100%;background:#fff;border:1px solid #DCD6EE;border-radius:3px;opacity:.55;')} />
        <div style={css('position:absolute;left:2.5px;top:-2.5px;right:-2.5px;height:100%;background:#fff;border:1px solid #DCD6EE;border-radius:3px;opacity:.8;')} />
        <div style={css('position:relative;aspect-ratio:16/9;background:#fff;border:1px solid #D6CFEC;border-radius:3px;box-shadow:0 6px 14px -7px rgba(46,26,92,.4);padding:7px 9px;display:flex;flex-direction:column;')}>
          <div style={css('font-size:4.6px;font-weight:700;color:#3B2A6B;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;')}>{title}</div>
          <div style={css('width:16px;height:1.6px;border-radius:1px;background:#7C3AED;margin:3px 0 4px;')} />
          <div style={css('display:flex;flex-direction:column;gap:3px;flex:1;')}>
            {bullets.map((w, i) => (
              <div key={i} style={css('display:flex;align-items:center;gap:2.5px;')}>
                <span style={css('flex:none;width:2px;height:2px;border-radius:50%;background:#A78BFA;')} />
                <span style={css('height:1.9px;border-radius:1px;background:#E3DEF3;width:' + w + '%;')} />
              </div>
            ))}
          </div>
          <div style={css('display:flex;align-items:center;justify-content:space-between;font-size:3px;color:#A79BC8;')}>
            <span>{meta}</span><span>1</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// 16:9 letterboxed video frame with play button, duration badge and scrub bar
function VideoFrame({ title, meta, seed }: ArtProps) {
  const pct = 18 + (seed % 46)
  return (
    <div style={css('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#0F1622;' + FONT)}>
      <div style={css('position:absolute;inset:0;background:radial-gradient(120% 90% at 72% 18%,rgba(120,160,220,.42),transparent 62%),radial-gradient(90% 80% at 20% 96%,rgba(52,84,140,.5),transparent 60%),linear-gradient(160deg,#1B2536,#0C121C);')} />
      <div style={css('position:absolute;left:0;right:0;top:22%;height:34%;background:linear-gradient(180deg,rgba(255,255,255,.06),transparent);')} />
      <span style={css('position:relative;width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.92);box-shadow:0 4px 12px -3px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;')}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="#101828"><path d="M8 5.5l11 6.5-11 6.5z" /></svg>
      </span>
      <div style={css('position:absolute;left:8px;right:8px;bottom:9px;')}>
        <div style={css('font-size:4px;font-weight:600;color:rgba(255,255,255,.95);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{title}</div>
        <div style={css('display:flex;align-items:center;gap:4px;margin-top:3px;')}>
          <span style={css('flex:1;height:1.6px;border-radius:1px;background:rgba(255,255,255,.28);overflow:hidden;')}>
            <span style={css('display:block;height:100%;width:' + pct + '%;background:#FF3B30;')} />
          </span>
          <span style={css('font-size:3.2px;font-weight:600;color:#fff;background:rgba(0,0,0,.6);border-radius:2px;padding:1px 3px;')}>{(meta || '').split('·')[0].trim() || 'Video'}</span>
        </div>
      </div>
    </div>
  )
}

// mini question paper: marks column, Q numbers, MCQ bubbles, total-marks chip
function TestPaper({ title, meta, seed }: ArtProps) {
  const rows = widths(seed, 4, 46, 88)
  return (
    <div style={css('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#EFF3F0,#E2EAE4);padding:9px 0 0;' + FONT)}>
      <div style={css('position:relative;width:64%;height:112%;background:#fff;border:1px solid #DCE4DE;border-top-left-radius:3px;border-top-right-radius:3px;box-shadow:0 6px 14px -6px rgba(20,60,40,.32);padding:7px 8px 0;overflow:hidden;')}>
        <div style={css('display:flex;align-items:flex-start;gap:4px;')}>
          <div style={css('flex:1;min-width:0;')}>
            <div style={css('font-size:4.4px;font-weight:700;color:#173A2A;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;')}>{title}</div>
            <div style={css('font-size:3.2px;color:#8A968E;margin-top:1.5px;')}>{meta}</div>
          </div>
          <span style={css('flex:none;font-size:3px;font-weight:700;color:#15803D;background:#EBF8F0;border:.6px solid #CFEBDB;border-radius:2px;padding:1px 3px;')}>20 M</span>
        </div>
        <div style={css('height:1px;background:#E4E9F0;margin:4px 0 5px;')} />
        <div style={css('display:flex;flex-direction:column;gap:4.5px;')}>
          {rows.map((w, i) => (
            <div key={i} style={css('display:flex;gap:3px;')}>
              <span style={css('flex:none;font-size:3.2px;font-weight:600;color:#15803D;width:4px;')}>{i + 1}.</span>
              <div style={css('flex:1;min-width:0;display:flex;flex-direction:column;gap:2.2px;')}>
                <span style={css('height:2px;border-radius:1px;background:#CBD4CF;width:' + w + '%;')} />
                <div style={css('display:flex;gap:3px;')}>
                  {[0, 1, 2, 3].map((b) => (
                    <span key={b} style={css('width:2.4px;height:2.4px;border-radius:50%;border:.6px solid ' + (b === i % 4 ? '#15803D' : '#D5DCD7') + ';background:' + (b === i % 4 ? '#15803D' : '#fff') + ';')} />
                  ))}
                </div>
              </div>
              <span style={css('flex:none;font-size:2.8px;color:#A9B2AC;')}>[5]</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// single question card: stem lines + A/B/C/D option rows, one marked correct
function QuestionCard({ title, meta, seed }: ArtProps) {
  const opts = widths(seed, 4, 40, 82)
  const right = seed % 4
  return (
    <div style={css('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#F2F0FB,#E7E4F4);padding:0 10px;' + FONT)}>
      <div style={css('width:100%;background:#fff;border:1px solid #DCD7EE;border-radius:4px;box-shadow:0 6px 14px -7px rgba(46,26,92,.34);padding:7px 8px;')}>
        <div style={css('display:flex;align-items:center;gap:3px;margin-bottom:3px;')}>
          <span style={css('font-size:2.9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6D28D9;background:#F3EEFE;border-radius:2px;padding:1px 3px;')}>MCQ</span>
          <span style={css('font-size:3px;color:#A79BC8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{meta}</span>
        </div>
        <div style={css('font-size:4.2px;font-weight:600;color:#2E2154;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;')}>{title}</div>
        <div style={css('display:flex;flex-direction:column;gap:2.6px;margin-top:4.5px;')}>
          {opts.map((w, i) => (
            <div key={i} style={css('display:flex;align-items:center;gap:3px;padding:1.8px 3px;border-radius:2px;border:.6px solid ' + (i === right ? '#C7B4F5' : '#EDEAF6') + ';background:' + (i === right ? '#F7F3FF' : '#fff') + ';')}>
              <span style={css('flex:none;width:4.4px;height:4.4px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:2.6px;font-weight:700;color:' + (i === right ? '#fff' : '#8E85AA') + ';background:' + (i === right ? '#7C3AED' : '#F1EFF8') + ';')}>{'ABCD'[i]}</span>
              <span style={css('height:1.8px;border-radius:1px;background:' + (i === right ? '#D6C8F8' : '#E7E3F1') + ';width:' + w + '%;')} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// activity / assignment card: task checklist with ticks and a group-work footer
function ActivityCard({ title, meta, seed }: ArtProps) {
  const tasks = widths(seed, 4, 44, 86)
  const done = 1 + (seed % 3)
  return (
    <div style={css('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#FDF3EC,#F7E7DA);padding:0 10px;' + FONT)}>
      <div style={css('width:100%;background:#fff;border:1px solid #F0DECE;border-radius:4px;box-shadow:0 6px 14px -7px rgba(120,64,20,.3);padding:7px 8px;')}>
        <div style={css('font-size:4.2px;font-weight:700;color:#5A3418;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;')}>{title}</div>
        <div style={css('font-size:3.1px;color:#B08A6A;margin-top:1.5px;')}>{meta}</div>
        <div style={css('display:flex;flex-direction:column;gap:2.8px;margin-top:4.5px;')}>
          {tasks.map((w, i) => (
            <div key={i} style={css('display:flex;align-items:center;gap:3px;')}>
              <span style={css('flex:none;width:4px;height:4px;border-radius:1.2px;display:flex;align-items:center;justify-content:center;border:.6px solid ' + (i < done ? '#EA7A2B' : '#EADBCC') + ';background:' + (i < done ? '#EA7A2B' : '#fff') + ';')}>
                {i < done && <svg width="2.6" height="2.6" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>}
              </span>
              <span style={css('height:1.9px;border-radius:1px;background:' + (i < done ? '#F3D8C2' : '#EFE7DF') + ';width:' + w + '%;')} />
            </div>
          ))}
        </div>
        <div style={css('display:flex;align-items:center;gap:3px;margin-top:5px;padding-top:3.5px;border-top:.6px solid #F4E8DD;')}>
          <svg width="4" height="4" viewBox="0 0 24 24" fill="none" stroke="#C98A55" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.2" /><path d="M2.5 19c.6-3.2 3.3-5 6.5-5s5.9 1.8 6.5 5" /><path d="M17 6.4a3 3 0 0 1 0 5.6M18.5 19c-.3-2-1-3.4-2-4.4" /></svg>
          <span style={css('font-size:3px;font-weight:600;color:#B0774A;')}>Group task</span>
          <span style={css('margin-left:auto;font-size:2.9px;font-weight:700;color:#EA7A2B;')}>{done}/4</span>
        </div>
      </div>
    </div>
  )
}

export function ResThumb({ kind, title, meta, height = 96 }: { kind: string; title: string; meta?: string; height?: number }) {
  const seed = seedOf(title)
  const m = meta ?? ''
  return (
    <div aria-hidden="true" style={css('position:relative;width:100%;height:' + height + 'px;overflow:hidden;background:#EEF1F6;')}>
      {kind === 'slides' ? <SlideDeck title={title} meta={m} seed={seed} />
        : kind === 'video' ? <VideoFrame title={title} meta={m} seed={seed} />
        : kind === 'test' ? <TestPaper title={title} meta={m} seed={seed} />
        : kind === 'question' ? <QuestionCard title={title} meta={m} seed={seed} />
        : (kind === 'activity' || kind === 'assignment') ? <ActivityCard title={title} meta={m} seed={seed} />
        : <DocPage kind={kind} title={title} meta={m} seed={seed} />}
    </div>
  )
}
