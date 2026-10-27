import { useState } from 'react'
import { Accessibility, ArrowLeft, BookA, BookOpen, Box, Check, CirclePlay, Clock, Download, FileText, Globe, House, Image, Layers,
  MessageSquare, Target, TriangleAlert, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import type { AgentItem, AgentKey, AgentStatus, LessonPlanRow, SessionRow } from '@/types/lessonPlan'
import { AgentCard, DocPreview } from './plan/AgentCard'
import { Bullets, PlanCard, Stat, SubBlock, bodyText } from './plan/cards'
import { obj, records, texts, trim, type Rec } from './plan/read'
import { StageFlow } from './plan/StageFlow'
import { buildSessionPlanHtml } from './sessionPlanPrint'

/* Session Plan — the "Plan" action on a session card (port of Rapid's SessionPlanScreen.jsx). Header with the
   Download PDF button and the stat strip, then a stack of content cards rendered from the session row's own
   AI-generated content (overview → homework, real-world examples, discussion questions), followed by the live
   agent blocks fetched when the session was generated. Sections with nothing behind them are not rendered; an
   agent block that ran and came back empty DOES render and says so. */

export function SessionPlanScreen({ plan, session, onBack }: { plan: LessonPlanRow; session: SessionRow; onBack: () => void }) {
  const [previewDoc, setPreviewDoc] = useState<AgentItem | null>(null)
  const s = session
  const c: Rec = obj(s.content) ?? {}
  const agents = (obj(s.agents) ?? {}) as Partial<Record<AgentKey, AgentStatus>>
  const extra = obj(c.additionalSections) ?? {}

  const title = trim(c.title) || trim(s.title) || 'Session Plan'
  const duration = s.durationMins ? `${s.durationMins} mins` : ''
  const chapter = trim(s.chapterName) || trim(plan.chapterName || plan.title)
  const grade = trim(s.className) || trim(plan.className)
  const subject = trim(s.subjectName) || trim(plan.subjectName)

  const outcomes = texts(c.learningOutcomes).length ? texts(c.learningOutcomes) : texts(s.elos)
  const objectives = texts(c.specificObjectives)
  const vocabulary = records(c.keyVocabulary, 'term')
  const materials = records(c.materials, 'name')
  const stages = records(c.stages, 'stage')
  const assessment = obj(c.assessment)
  const differentiation = obj(c.differentiation)
  const realWorld = records(c.realWorldExamples, 'example')
  const discussion = records(c.discussionQuestions, 'question')
  const unparseable = trim(c.error) === 'unparseable'
  const successCriteria = texts(assessment?.successCriteria)

  // Download PDF: the document is BUILT from the session data (sessionPlanPrint) rather than cloned from this
  // screen — grid / aspect-ratio layouts do not survive a print context.
  const downloadPDF = () => {
    const w = window.open('', 'session_plan_pdf', 'popup=yes,width=1000,height=920,scrollbars=yes,resizable=yes')
    if (!w) { toast('Your browser blocked the print window. Allow pop-ups for this site and try again.', 'error'); return }
    w.document.open()
    w.document.write(buildSessionPlanHtml({ session: s, content: s.content, agents, plan }))
    w.document.close()
    // Print only once every thumbnail has settled (a hard cap so a slow remote image cannot hang the dialog).
    let fired = false
    const go = () => {
      if (fired) return
      fired = true
      try { w.focus(); w.print() } catch { /* the user closed the window */ }
    }
    const whenReady = () => {
      const imgs = Array.from(w.document.images || [])
      let pending = imgs.filter((i) => !i.complete).length
      if (pending === 0) { window.setTimeout(go, 120); return }
      const settle = () => { if (--pending <= 0) window.setTimeout(go, 120) }
      imgs.forEach((i) => {
        if (i.complete) return
        i.addEventListener('load', settle, { once: true })
        i.addEventListener('error', settle, { once: true })
      })
      window.setTimeout(go, 6000)
    }
    if (w.document.readyState === 'complete') whenReady()
    else w.addEventListener('load', whenReady, { once: true })
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div className="min-w-0">
          <button type="button" onClick={onBack}
            className="mb-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg text-sm font-medium text-ink-500 transition-colors hover:text-brand-600">
            <ArrowLeft className="h-4 w-4" />Back to Session Manager
          </button>
          <div className="text-[11.5px] font-bold uppercase tracking-[.09em] text-brand-600">
            Session Plan{s.sessionNo ? ` · Session ${s.sessionNo}` : ''}
          </div>
          <h1 className="font-display text-3xl font-bold leading-tight">
            <span className="text-gradient">{title}</span>
          </h1>
        </div>
        <Button onClick={downloadPDF} id="session-plan-pdf"><Download className="h-4 w-4" />Download PDF</Button>
      </header>

      {/* Stat strip */}
      <div className="glass flex flex-wrap items-center gap-y-3 rounded-2xl py-3.5">
        <div className="min-w-[180px] flex-1 px-[18px]">
          <div className="text-[12.5px] text-ink-500">Chapter</div>
          <div className="text-[15px] font-semibold text-fg">{chapter || '—'}</div>
        </div>
        <Stat icon={Layers} label="Class / Subject" value={[grade, subject].filter(Boolean).join(' · ')} />
        <Stat icon={Clock} label="Duration" value={duration} />
        <Stat icon={Workflow} label="Stages" value={stages.length ? String(stages.length) : (s.stageCount ? String(s.stageCount) : '')} />
        <Stat icon={Box} label="Resources" value={s.resourceCount != null ? String(s.resourceCount) : ''} />
      </div>

      <div className="flex flex-col gap-[18px]">
        {unparseable && (
          <PlanCard icon={TriangleAlert} title="The generated content could not be read" tint="orange">
            <div className="text-sm leading-[1.7] text-ink-500">
              The AI provider returned something this screen could not parse, so nothing generated is shown below.
              Everything you entered — the outcomes, the stages and the resources you picked — is safe. Open the
              session and save it again to regenerate.
            </div>
          </PlanCard>
        )}

        {trim(c.overview) && <PlanCard icon={BookOpen} title="Overview"><div className={bodyText}>{trim(c.overview)}</div></PlanCard>}

        {outcomes.length > 0 && (
          <PlanCard icon={Target} title={`Expected Learning Outcome${outcomes.length === 1 ? '' : 's'}`} subtitle="From this lesson plan">
            <Bullets items={outcomes} />
          </PlanCard>
        )}

        {trim(s.instructions) && (
          <PlanCard icon={Accessibility} title="Session Instructions" tint="violet">
            <div className={`${bodyText} whitespace-pre-wrap`}>{trim(s.instructions)}</div>
          </PlanCard>
        )}

        {trim(c.prerequisiteKnowledge) && (
          <PlanCard icon={Layers} title="Prerequisite Knowledge"><div className={bodyText}>{trim(c.prerequisiteKnowledge)}</div></PlanCard>
        )}

        {objectives.length > 0 && (
          <PlanCard icon={Check} title="Specific Objectives" tint="green"><Bullets items={objectives} accent="green" /></PlanCard>
        )}

        {vocabulary.length > 0 && (
          <PlanCard icon={BookA} title="Key Vocabulary">
            <div className="flex flex-col gap-2.5">
              {vocabulary.map((x, i) => (
                <SubBlock key={i}>
                  <div className="text-[14.5px] font-semibold text-fg">{trim(x.term)}</div>
                  {trim(x.definition) && <div className="mt-0.5 text-sm leading-[1.7] text-ink-300">{trim(x.definition)}</div>}
                  {trim(x.example) && <div className="mt-1 text-[13.5px] italic leading-[1.7] text-ink-500">{trim(x.example)}</div>}
                </SubBlock>
              ))}
            </div>
          </PlanCard>
        )}

        {materials.length > 0 && (
          <PlanCard icon={Box} title="Materials">
            <div className="flex flex-col gap-2">
              {materials.map((m, i) => (
                <div key={i} className={`${bodyText} flex flex-wrap items-baseline gap-2.5`}>
                  <span className="font-semibold text-fg">{trim(m.name)}</span>
                  {trim(m.quantity) && <span className="rounded-full bg-brand-500/12 px-2.5 py-0.5 text-xs text-brand-600">{trim(m.quantity)}</span>}
                  {trim(m.notes) && <span className="text-ink-500">{trim(m.notes)}</span>}
                </div>
              ))}
            </div>
          </PlanCard>
        )}

        {stages.length > 0 && <StageFlow stages={stages} />}

        {assessment && (trim(assessment.description) || successCriteria.length > 0) && (
          <PlanCard icon={Check} title="Assessment" tint="green" subtitle={trim(assessment.type)}>
            {trim(assessment.description) && <div className={bodyText}>{trim(assessment.description)}</div>}
            {successCriteria.length > 0 && (
              <div className="mt-3">
                <div className="mb-2 text-[13px] font-semibold text-ink-500">Success criteria</div>
                <Bullets items={successCriteria} accent="green" />
              </div>
            )}
          </PlanCard>
        )}

        {differentiation && (trim(differentiation.extensions) || trim(differentiation.support)) && (
          <PlanCard icon={Accessibility} title="Differentiation">
            {trim(differentiation.support) && (
              <div>
                <div className="mb-1.5 text-[13px] font-semibold text-ink-500">Support</div>
                <div className={bodyText}>{trim(differentiation.support)}</div>
              </div>
            )}
            {trim(differentiation.extensions) && (
              <div className={trim(differentiation.support) ? 'mt-3.5' : ''}>
                <div className="mb-1.5 text-[13px] font-semibold text-ink-500">Extensions</div>
                <div className={bodyText}>{trim(differentiation.extensions)}</div>
              </div>
            )}
          </PlanCard>
        )}

        {trim(c.homework) && <PlanCard icon={House} title="Homework"><div className={bodyText}>{trim(c.homework)}</div></PlanCard>}

        {realWorld.length > 0 && (
          <PlanCard icon={Globe} title="Real-World Examples" tint="cyan">
            <div className="flex flex-col gap-2.5">
              {realWorld.map((x, i) => (
                <SubBlock key={i}>
                  <div className="flex items-start gap-2.5">
                    <span aria-hidden="true" className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-[10.5px] font-bold text-cyan-600">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="text-[14.5px] font-semibold leading-relaxed text-fg">{trim(x.example)}</div>
                      {trim(x.explanation) && <div className="mt-1 text-sm leading-[1.7] text-ink-300">{trim(x.explanation)}</div>}
                    </div>
                  </div>
                </SubBlock>
              ))}
            </div>
          </PlanCard>
        )}

        {discussion.length > 0 && (
          <PlanCard icon={MessageSquare} title="Discussion Questions" tint="amber" subtitle={`${discussion.length} question${discussion.length === 1 ? '' : 's'}`}>
            <div className="flex flex-col gap-2.5">
              {discussion.map((x, i) => (
                <SubBlock key={i} className="border-amber-200 bg-amber-50/40">
                  <div className="flex items-start gap-2.5">
                    <span aria-hidden="true" className="shrink-0 text-xs font-bold leading-[1.7] text-amber-700">Q{i + 1}</span>
                    <div className="min-w-0">
                      <div className="text-[14.5px] font-semibold leading-relaxed text-fg">{trim(x.question)}</div>
                      {trim(x.purpose) && <div className="mt-1 text-[13.5px] leading-[1.7] text-ink-500">{trim(x.purpose)}</div>}
                    </div>
                  </div>
                </SubBlock>
              ))}
            </div>
          </PlanCard>
        )}

        {/* Live agent blocks, fetched when the session was generated. */}
        <AgentCard icon={Globe} title="Current Affairs" tint="brand" items={extra.currentAffairs} status={agents.currentAffairs}
          emptyText="Current affairs are not available for this chapter." />
        <AgentCard icon={CirclePlay} title="Video References" tint="pink" items={extra.educationalVideos} status={agents.educationalVideos}
          view="video" emptyText="No video references are available for this chapter." />
        <AgentCard icon={Image} title="Images" tint="violet" items={extra.images} status={agents.images} view="gallery"
          emptyText="No images are available for this chapter." />
        {/* Study material sits last: it is what the teacher takes away and prints, not what they teach from. */}
        <AgentCard icon={FileText} title="Educational Documents" tint="green" items={extra.educationalDocuments} status={agents.educationalDocuments}
          view="docs" onPreviewDoc={setPreviewDoc} emptyText="No NCERT study material was found for this chapter." />

        {stages.length === 0 && !unparseable && (
          <PlanCard icon={Box} title="Nothing generated for this session yet">
            <div className="text-sm leading-[1.7] text-ink-500">
              This session was saved without generated content. Open it from the Session Manager and save it again to generate the plan.
            </div>
          </PlanCard>
        )}
      </div>

      {previewDoc && <DocPreview doc={previewDoc} onClose={() => setPreviewDoc(null)} />}
    </div>
  )
}
