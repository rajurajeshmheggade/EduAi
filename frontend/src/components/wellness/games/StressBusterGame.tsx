import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StressBusterTab } from '@/components/wellness/stress/StressBusterTab'
import type { GameProps } from './catalog'

/** The original balloon game inside the Game Zone, unchanged, with a way back to the picker. */
export default function StressBusterGame({ onExit }: GameProps) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button variant="ghost" size="sm" onClick={onExit} className="-ml-2">
          <ArrowLeft className="h-4 w-4" aria-hidden />Back to Game Zone
        </Button>
      </div>
      <StressBusterTab />
    </div>
  )
}
