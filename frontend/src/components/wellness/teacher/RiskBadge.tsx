import { AlertTriangle, CheckCircle2, Eye, MoonStar } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { RiskLevel } from '@/types/wellness'
import { RISK } from './labels'

const ICON = { high: AlertTriangle, watch: Eye, ok: CheckCircle2, inactive: MoonStar } as const

/** Risk is never colour-only: every badge carries an icon and a label, and the criteria in its tooltip. */
export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const r = RISK[risk]
  const Icon = ICON[risk]
  return (
    <Badge tone={r.tone} title={r.hint} className="whitespace-nowrap">
      <Icon className="h-3 w-3" aria-hidden />{r.label}
    </Badge>
  )
}
