import { useEffect, useRef, useState } from 'react'

/**
 * Runs the steps a heavy screen needs before it is shown (e.g. the AI Classroom: teacher's voice, 3D model, first
 * page), with dependencies, per-step timeouts and weighted progress. Every step settles — done, failed, timed out or
 * skipped (a prerequisite did not finish) — so the caller can always go on, falling back where something is missing.
 */
export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'timeout' | 'skipped'

export interface ReadinessStep {
  id: string
  label: string
  /** Share of the progress bar (default 1). */
  weight?: number
  /** Steps that must be done first; if one of them doesn't finish, this step is skipped. */
  after?: string[]
  timeoutMs?: number
  run: (ctx: { signal: AbortSignal; progress: (fraction: number) => void }) => Promise<unknown>
}

export interface StepStatus { id: string; label: string; state: StepState; progress: number; error?: string }
export interface ReadinessSnapshot { steps: StepStatus[]; progress: number; settled: boolean }

class StepTimeout extends Error {}

const finished = (s: StepState) => s !== 'pending' && s !== 'running'

export function runReadiness(steps: ReadinessStep[], { signal, onChange }: { signal?: AbortSignal; onChange?: (s: ReadinessSnapshot) => void } = {}): Promise<ReadinessSnapshot> {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const status = new Map<string, StepStatus>(steps.map((s) => [s.id, { id: s.id, label: s.label, state: 'pending', progress: 0 }]))
  const started = new Map<string, Promise<StepState>>()

  const snapshot = (): ReadinessSnapshot => {
    const list = steps.map((s) => ({ ...status.get(s.id)! }))
    const total = steps.reduce((n, s) => n + (s.weight ?? 1), 0) || 1
    const done = steps.reduce((n, s) => {
      const st = status.get(s.id)!
      return n + (s.weight ?? 1) * (finished(st.state) ? 1 : st.state === 'running' ? st.progress : 0)
    }, 0)
    return { steps: list, progress: Math.round((100 * done) / total), settled: list.every((s) => finished(s.state)) }
  }
  const emit = () => { if (!signal?.aborted) onChange?.(snapshot()) }

  const start = (step: ReadinessStep): Promise<StepState> => {
    let p = started.get(step.id)
    if (p) return p
    p = (async () => {
      const deps = await Promise.all((step.after ?? []).map((id) => (byId.has(id) ? start(byId.get(id)!) : Promise.resolve<StepState>('done'))))
      const st = status.get(step.id)!
      if (deps.some((d) => d !== 'done') || signal?.aborted) {
        st.state = 'skipped'
        emit()
        return st.state
      }
      st.state = 'running'
      emit()
      const ctl = new AbortController()
      const stop = () => ctl.abort()
      signal?.addEventListener('abort', stop)
      let timer: number | undefined
      try {
        await Promise.race([
          step.run({ signal: ctl.signal, progress: (f) => { if (st.state === 'running') { st.progress = Math.max(0, Math.min(1, f)); emit() } } }),
          new Promise((_, reject) => { if (step.timeoutMs) timer = window.setTimeout(() => reject(new StepTimeout()), step.timeoutMs) }),
        ])
        st.state = 'done'
        st.progress = 1
      } catch (e) {
        st.state = e instanceof StepTimeout ? 'timeout' : 'failed'
        st.error = e instanceof Error ? e.message : String(e)
        ctl.abort()
      } finally {
        window.clearTimeout(timer)
        signal?.removeEventListener('abort', stop)
      }
      emit()
      return st.state
    })()
    started.set(step.id, p)
    return p
  }

  emit()
  return Promise.all(steps.map(start)).then(snapshot)
}

/** `runReadiness` for a component: starts when `build()` returns steps, restarts when `deps` change. */
export function useReadiness(build: () => ReadinessStep[] | null, deps: unknown[]): ReadinessSnapshot | null {
  const [snap, setSnap] = useState<ReadinessSnapshot | null>(null)
  const buildRef = useRef(build)
  useEffect(() => { buildRef.current = build })
  useEffect(() => {
    const steps = buildRef.current()
    if (!steps) return
    const ctl = new AbortController()
    void runReadiness(steps, { signal: ctl.signal, onChange: setSnap })
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps])
  return snap
}
