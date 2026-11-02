import { useState } from 'react'
import { RotateCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/field'
import { ErrorState, SkeletonPage } from '@/components/ui/loading'
import { Tabs } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { useAsync } from '@/lib/useAsync'
import { errorMessage } from '@/services/apiClient'
import { MODULE_LABEL, type ModuleSettings, type ProctorModule, type ProctorSettings, proctoringService, type Severity } from '@/services/proctoringService'

type BoolKey = { [K in keyof ProctorSettings]: ProctorSettings[K] extends boolean ? K : never }[keyof ProctorSettings]
type NumKey = { [K in keyof ProctorSettings]: ProctorSettings[K] extends number ? K : never }[keyof ProctorSettings]

const SWITCHES: { key: BoolKey; label: string; hint: string }[] = [
  { key: 'enabled', label: 'Proctor this module', hint: 'Off: students start without the preparation window and nothing is recorded.' },
  { key: 'camera_required', label: 'Camera required', hint: 'Camera permission, a visible face and good lighting must pass before starting.' },
  { key: 'mic_required', label: 'Microphone required', hint: 'Microphone permission must be granted; its status is monitored.' },
  { key: 'fullscreen_required', label: 'Full screen required', hint: 'The exam opens in full screen; leaving it is a flag.' },
  { key: 'detect_multiple_faces', label: 'Detect more than one person', hint: '' },
  { key: 'detect_objects', label: 'Detect phones and other screens', hint: 'On-device object detection.' },
  { key: 'detect_looking_away', label: 'Detect looking away', hint: 'Off by default: prone to false positives.' },
  { key: 'detect_voice', label: 'Detect sustained talking / noise', hint: 'Loudness only, needs the microphone; nothing is recorded.' },
  { key: 'teacher_can_end', label: 'Teachers may end a session', hint: 'Ending hands in what the student saved so far.' },
]
const NUMBERS: { key: NumKey; label: string; unit: string; step?: number }[] = [
  { key: 'no_face_seconds', label: 'Face not visible for', unit: 's' },
  { key: 'multiple_faces_seconds', label: 'More than one person for', unit: 's' },
  { key: 'camera_blocked_seconds', label: 'Camera covered / dark for', unit: 's' },
  { key: 'looking_away_seconds', label: 'Looking away for', unit: 's' },
  { key: 'window_blur_seconds', label: 'Another app in focus for', unit: 's' },
  { key: 'voice_seconds', label: 'Talking / noise for', unit: 's' },
  { key: 'voice_db', label: 'Noise above the room level by', unit: 'dB' },
  { key: 'object_min_confidence', label: 'Object detection confidence', unit: '0–1', step: 0.05 },
  { key: 'escalate_after_seconds', label: 'Escalate an episode longer than', unit: 's' },
  { key: 'repeat_escalation_count', label: 'Escalate from occurrence no.', unit: '' },
  { key: 'heartbeat_missing_seconds', label: 'Interrupted after silence of', unit: 's' },
  { key: 'notify_cooldown_seconds', label: 'Same alert notified at most every', unit: 's' },
  { key: 'retention_days', label: 'Delete flags after', unit: 'days' },
]

/**
 * Per-module proctoring thresholds for the institution (Admin console -> Proctoring). Org admins edit; teachers see the
 * same panel read-only. Conditions must hold for the given time before they become a flag, which keeps false positives low.
 */
export function ProctoringSettingsPanel({ org }: { org: string | null }) {
  const scope = org ?? undefined
  const s = useAsync(() => proctoringService.settings(scope), [scope])
  const [module, setModule] = useState<ProctorModule>('ONLINE_TEST')

  if (s.error && !s.data) return <ErrorState title="Could not load the proctoring settings" message={s.error} onRetry={s.retry} />
  if (!s.data) return <SkeletonPage variant="detail" />
  const current = s.data.modules[module]
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-ink-300">Unified AI proctoring for students: flags only — detection runs on the student’s device and no video, photo or audio is
        stored. {s.data.editable ? 'Changes apply to sessions that start after saving.' : 'Set by your institution’s admin.'}</p>
      <Tabs value={module} onChange={setModule} items={(Object.keys(MODULE_LABEL) as ProctorModule[]).map((m) => ({ id: m, label: MODULE_LABEL[m] }))} />
      <ModuleEditor key={`${module}-${current.updated_at ?? ''}`} module={module} current={current} editable={s.data.editable} limits={s.data.limits}
        scope={scope} onSaved={s.retry} />
    </div>
  )
}

function ModuleEditor({ module, current, editable, limits, scope, onSaved }: {
  module: ProctorModule; current: ModuleSettings; editable: boolean; limits: Record<string, [number, number]>; scope?: string; onSaved: () => void
}) {
  const [draft, setDraft] = useState<ProctorSettings>(() => ({ ...current.effective }))
  const [busy, setBusy] = useState(false)
  const changed = (Object.keys(draft) as (keyof ProctorSettings)[]).filter((k) => draft[k] !== current.effective[k])

  async function save() {
    setBusy(true)
    try {
      await proctoringService.saveSettings(module, Object.fromEntries(changed.map((k) => [k, draft[k]])), scope)
      toast(`${MODULE_LABEL[module]} proctoring settings saved`, 'success')
      onSaved()
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <h3 className="font-display text-base font-semibold text-fg">Checks and detectors</h3>
          {SWITCHES.map((x) => (
            <label key={x.key} className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" disabled={!editable} checked={draft[x.key]}
                onChange={(e) => setDraft({ ...draft, [x.key]: e.target.checked })} />
              <span><span className="font-medium text-fg">{x.label}</span>{x.hint && <span className="block text-xs text-ink-500">{x.hint}</span>}</span>
            </label>
          ))}
          <div>
            <Label htmlFor="notify-min">Notify teachers (bell) from severity</Label>
            <Select id="notify-min" disabled={!editable} value={draft.notify_min_severity} onChange={(e) => setDraft({ ...draft, notify_min_severity: e.target.value as Severity })}>
              {(['Low', 'Medium', 'High', 'Critical'] as Severity[]).map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
            <p className="mt-1 text-xs text-ink-500">Every flag still appears on the live dashboard; this only controls notifications.</p>
          </div>
        </Card>
        <Card className="space-y-3 p-5">
          <h3 className="font-display text-base font-semibold text-fg">Thresholds</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {NUMBERS.map((x) => {
              const [lo, hi] = limits[x.key] ?? [0, 9999]
              return (
                <div key={x.key}>
                  <Label htmlFor={`pt-${x.key}`}>{x.label}{x.unit ? ` (${x.unit})` : ''}</Label>
                  <Input id={`pt-${x.key}`} type="number" min={lo} max={hi} step={x.step ?? 1} disabled={!editable} value={draft[x.key]}
                    onChange={(e) => setDraft({ ...draft, [x.key]: Number(e.target.value) })} />
                </div>
              )
            })}
          </div>
        </Card>
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={busy || changed.length === 0}><Save className="h-4 w-4" /> Save {changed.length ? `(${changed.length})` : ''}</Button>
          <Button variant="ghost" disabled={busy || changed.length === 0} onClick={() => setDraft({ ...current.effective })}><RotateCcw className="h-4 w-4" /> Undo changes</Button>
          <Button variant="ghost" disabled={busy} onClick={() => setDraft({ ...current.defaults })}>Use the recommended defaults</Button>
          {current.updated_at && <span className="text-xs text-ink-500">Last saved {new Date(current.updated_at).toLocaleString()}</span>}
        </div>
      )}
    </div>
  )
}
