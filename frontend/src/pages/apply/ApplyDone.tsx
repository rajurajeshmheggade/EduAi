import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, CheckCircle2, Copy, Printer, Search } from 'lucide-react'
import { copyText } from '@/lib/clipboard'
import { Button, buttonVariants } from '@/components/ui/button'
import { fmtDateTime } from '@/lib/admissionForm'
import { cn } from '@/lib/utils'
import { applyStore } from '@/services/applyService'
import { useApply } from './context'

/** Submission confirmation: the application reference number (kept in this tab only), what happens next. */
export default function ApplyDone() {
  const { slug, base, info } = useApply()
  const done = applyStore.done(slug)
  const [copied, setCopied] = useState(false)
  if (!done) {
    return (
      <div className="mx-auto max-w-lg space-y-3 rounded-2xl border border-line bg-ink-900 p-6 text-center">
        <h1 className="font-display text-2xl font-bold">Application submitted?</h1>
        <p className="text-sm text-ink-300">Use your reference number and the student's date of birth to check the status.</p>
        <Link to={`${base}/track`} className={cn(buttonVariants())}><Search className="h-4 w-4" /> Track application</Link>
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="rounded-2xl border border-ok/30 bg-ink-900 p-6 text-center shadow-sm sm:p-8" role="status">
        <CheckCircle2 className="mx-auto h-14 w-14 text-ok" />
        <h1 className="mt-3 font-display text-3xl font-bold">{done.test ? 'Admission test submitted' : 'Application submitted'}</h1>
        <p className="mt-2 text-ink-300">Thank you. {info.school.name} has received your application{done.test ? ' and your admission test' : ''}.</p>
        <div className="mt-5 rounded-xl border border-line bg-ink-950 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Application reference number</p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-fg" id="reference-no">{done.reference_no}</p>
          <p className="mt-1 text-xs text-ink-500">Submitted {fmtDateTime(done.at)}</p>
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2 print:hidden">
          <Button variant="secondary" onClick={() => void copyText(done.reference_no).then((ok) => setCopied(ok))}>
            {copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy reference'}</Button>
          <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
          <Link to={`${base}/track`} className={cn(buttonVariants())}><Search className="h-4 w-4" /> Track application</Link>
        </div>
      </div>
      <div className="rounded-2xl border border-line bg-ink-900 p-5 text-sm text-ink-300">
        <h2 className="mb-2 font-display text-base font-semibold text-fg">What happens next</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your one-time credentials have been removed and no longer work.</li>
          <li>Keep the reference number. With it and the student's date of birth you can check the status at any time.</li>
          <li>If the school needs corrections, it will contact you with new credentials.</li>
        </ul>
      </div>
    </div>
  )
}
