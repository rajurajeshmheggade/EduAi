import { Badge } from '@/components/ui/badge'
import { MODULE_LABEL, type ProctorModule, type Severity, type StudentState } from '@/services/proctoringService'
import { SEVERITY_TONE, STATE_META } from './format'

export function StateBadge({ state }: { state: StudentState }) {
  const m = STATE_META[state]
  return <Badge tone={m.tone}>{m.label}</Badge>
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={SEVERITY_TONE[severity]} className={severity === 'Critical' ? 'font-semibold uppercase' : undefined}>{severity}</Badge>
}

export function ModuleBadge({ module }: { module: ProctorModule }) {
  return <Badge tone={module === 'ONLINE_TEST' ? 'brand' : module === 'VIRTUAL_LAB' ? 'aqua' : 'neutral'}>{MODULE_LABEL[module]}</Badge>
}
