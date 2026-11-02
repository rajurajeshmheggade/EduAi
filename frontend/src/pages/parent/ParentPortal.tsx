import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, FileCheck2, Info, Loader2, ShieldCheck, UserRound } from 'lucide-react'
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Label, Select, Textarea } from '@/components/ui/field'
import { hasChosenLanguage, setLanguage } from '@/i18n'
import type { LangCode } from '@/i18n/locales'
import { errorMessage } from '@/services/apiClient'
import { admissionService, type ConsentText, type DataRequest, type ParentHome, type RequestKind } from '@/services/admissionService'

type Child = ParentHome['children'][number]
const KINDS: RequestKind[] = ['access', 'correction', 'erasure', 'consent_withdrawal', 'grievance']
const fmtDate = (iso: string, lang: string) => new Date(iso).toLocaleDateString(`${lang}-IN`, { day: 'numeric', month: 'long', year: 'numeric' })

/** Parent portal (mobile-first, English / Hindi / Kannada / Tamil): children, consent, privacy requests. */
export default function ParentPortal() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language as LangCode
  const [home, setHome] = useState<ParentHome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState<Child | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    admissionService.parentHome().then((h) => {
      setHome(h)
      // First visit in this browser: use the language saved on the guardian's record.
      if (h.guardian && !hasChosenLanguage() && h.guardian.preferred_language !== i18n.language) void setLanguage(h.guardian.preferred_language)
    }).catch((e) => setError(errorMessage(e)))
  }, [i18n])
  useEffect(() => { load() }, [load])

  return (
    <div lang={lang} className="mx-auto max-w-3xl space-y-5 p-4 md:p-8">
      <header className="space-y-3 animate-fade-up">
        {home && <p className="text-sm text-ink-300">{t('portal.school', { school: home.school })}</p>}
        <h1 className="font-display text-2xl font-bold text-fg md:text-3xl">
          {home?.guardian ? t('portal.greeting', { name: home.guardian.full_name }) : t('portal.title')}
        </h1>
        <LanguageSwitcher onChange={(l) => { void admissionService.setParentLanguage(l).catch(() => {}) }} />
      </header>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{t('common.error')}</p>}
      {notice && <p role="status" className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</p>}

      <section aria-labelledby="kids-h" className="space-y-3">
        <h2 id="kids-h" className="font-display text-lg font-semibold text-fg">{t('portal.children')}</h2>
        {!home ? <div className="skeleton h-28" /> : home.children.length === 0 ? (
          <Card className="p-5 text-sm text-ink-300">{t('portal.empty')}</Card>
        ) : home.children.map((c) => (
          <Card key={c.applicant_id}>
            <CardContent className="flex flex-wrap items-center gap-4 pt-5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-500/10 text-brand-600"><UserRound className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold text-fg">{c.full_name}</div>
                <div className="text-sm text-ink-300">{t('portal.class', { grade: c.grade_applying })}</div>
                <div className="mt-1.5"><ConsentBadge child={c} /></div>
              </div>
              <Button className="w-full sm:w-auto" variant={c.consent?.decision === 'granted' && c.consent.current ? 'secondary' : 'default'}
                disabled={!home.consent_version} onClick={() => { setNotice(null); setReading(c) }}>
                <FileCheck2 className="h-4 w-4" /> {c.consent?.decision === 'granted' && c.consent.current ? t('consent.review') : t('consent.read')}
              </Button>
            </CardContent>
          </Card>
        ))}
        {home && !home.consent_version && home.children.length > 0 && <p className="text-sm text-warn">{t('portal.noNotice')}</p>}
      </section>

      {home && <PrivacyRequests home={home} lang={lang} />}

      {home && <p className="flex items-start gap-2 text-xs text-ink-500"><ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />{t('portal.footer', { school: home.school })}</p>}

      {reading && (
        <ConsentDialog child={reading} lang={lang} onClose={() => setReading(null)}
          onDone={(msg) => { setReading(null); setNotice(msg); load() }} />
      )}
    </div>
  )
}

function ConsentBadge({ child }: { child: Child }) {
  const { t } = useTranslation()
  const c = child.consent
  if (!c) return <Badge tone="warn">{t('consent.pending')}</Badge>
  if (c.decision === 'withdrawn') return <Badge tone="neutral">{t('consent.withdrawn')}</Badge>
  if (!c.current) return <Badge tone="warn">{t('consent.outdated')}</Badge>
  return <Badge tone="ok"><CheckCircle2 className="h-3 w-3" /> {t('consent.granted', { version: c.version })}</Badge>
}

function ConsentDialog({ child, lang, onClose, onDone }: { child: Child; lang: LangCode; onClose: () => void; onDone: (msg: string) => void }) {
  const { t } = useTranslation()
  const [text, setText] = useState<ConsentText | null>(null)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { admissionService.consentText(child.applicant_id, lang).then(setText).catch((e) => setError(errorMessage(e))) }, [child.applicant_id, lang])
  const granted = text?.current?.decision === 'granted' && text.current.version === text.version

  async function decide(decision: 'granted' | 'withdrawn') {
    if (!text) return
    setBusy(true); setError(null)
    try {
      await admissionService.giveConsent({ applicant_id: child.applicant_id, version_id: text.version_id, decision, confirm: decision === 'granted' && agree })
      onDone(decision === 'granted' ? t('consent.saved') : t('consent.withdrawnMsg'))
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title={text?.title ?? t('consent.title')} description={text ? `${child.full_name} · ${t('consent.version', { version: text.version })}` : undefined}
      className="w-[min(40rem,calc(100vw-1rem))]">
      <div lang={text?.language ?? lang} className="space-y-4">
        {!text ? (error ? <p role="alert" className="text-sm text-bad">{error}</p> : <div className="skeleton h-64" />) : (
          <>
            {text.draft_translation && <p className="flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn"><Info className="mt-px h-3.5 w-3.5 shrink-0" />{t('consent.draftNote')}</p>}
            <div className="max-h-[50vh] overflow-y-auto whitespace-pre-line rounded-xl border border-line bg-ink-800/40 p-4 text-sm leading-relaxed text-ink-100" tabIndex={0}>
              {text.body}
            </div>
            {granted ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <Badge tone="ok"><CheckCircle2 className="h-3 w-3" /> {t('consent.granted', { version: text.version })}</Badge>
                <Button variant="secondary" disabled={busy} onClick={() => decide('withdrawn')}>{t('consent.withdraw')}</Button>
              </div>
            ) : (
              <div className="space-y-3 border-t border-line pt-4">
                <label className="flex cursor-pointer items-start gap-3 text-sm text-fg">
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600" />
                  <span>{t('consent.confirm', { child: child.full_name })}</span>
                </label>
                {error && <p role="alert" className="text-sm text-bad">{error}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
                  <Button disabled={!agree || busy} onClick={() => decide('granted')} id="give-consent">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {t('consent.submit')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

function PrivacyRequests({ home, lang }: { home: ParentHome; lang: LangCode }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<DataRequest[] | null>(null)
  const [kind, setKind] = useState<RequestKind>('access')
  const [child, setChild] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const load = useCallback(() => { admissionService.parentRequests().then(setRows).catch(() => setRows([])) }, [])
  useEffect(() => { load() }, [load])

  async function send() {
    setBusy(true); setMsg(null)
    try {
      const r = await admissionService.raiseRequest({ kind, ...(child ? { applicant_id: child } : {}), ...(details.trim() ? { details: details.trim() } : {}) })
      setMsg({ ok: true, text: t('privacy.sent', { date: fmtDate(r.due_at, lang) }) }); setDetails(''); load()
    } catch { setMsg({ ok: false, text: t('common.error') }) } finally { setBusy(false) }
  }

  return (
    <section aria-labelledby="privacy-h" className="space-y-3">
      <h2 id="privacy-h" className="font-display text-lg font-semibold text-fg">{t('privacy.title')}</h2>
      <Card>
        <CardContent className="space-y-3 pt-5">
          <p className="text-sm text-ink-300">{t('privacy.intro')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="pr-kind">{t('privacy.type')}</Label>
              <Select id="pr-kind" value={kind} onChange={(e) => setKind(e.target.value as RequestKind)}>
                {KINDS.map((k) => <option key={k} value={k}>{t(`privacy.kind.${k}`)}</option>)}
              </Select>
            </div>
            <div><Label htmlFor="pr-child">{t('privacy.child')}</Label>
              <Select id="pr-child" value={child} onChange={(e) => setChild(e.target.value)}>
                <option value="">{t('privacy.allChildren')}</option>
                {home.children.map((c) => <option key={c.applicant_id} value={c.applicant_id}>{c.full_name}</option>)}
              </Select>
            </div>
          </div>
          <div><Label htmlFor="pr-details">{t('privacy.details')}</Label>
            <Textarea id="pr-details" rows={2} maxLength={4000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>
          {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm text-ok' : 'text-sm text-bad'}>{msg.text}</p>}
          <div className="flex justify-end"><Button onClick={send} disabled={busy} className="w-full sm:w-auto">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{t('privacy.send')}</Button></div>
          {rows && rows.length > 0 ? (
            <ul className="divide-y divide-line border-t border-line pt-1">
              {rows.map((r) => (
                <li key={r.request_id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 text-fg">{t(`privacy.kind.${r.kind}`)}{r.applicant_name ? ` · ${r.applicant_name}` : ''}</span>
                  <span className="text-xs text-ink-500">{fmtDate(r.created_at, lang)}</span>
                  <Badge tone={r.status === 'completed' ? 'ok' : r.status === 'rejected' ? 'neutral' : 'warn'}>{t(`privacy.status.${r.status}`)}</Badge>
                </li>
              ))}
            </ul>
          ) : rows && <p className="text-sm text-ink-500">{t('privacy.none')}</p>}
        </CardContent>
      </Card>
    </section>
  )
}
