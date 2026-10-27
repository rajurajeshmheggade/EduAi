/* ── Lesson Plan Creator — port of Rapid's 7-step MainStepper (teacherconsole/tools/LessonPlanCreator.jsx) ──
   Sticky 7-step stepper + colour-coded sections. Every step generates on EduAI's AI provider through
   lessonPlanService (each call carries the teacher's class + subject so the server can check the assignment).
   The whole wizard state is snapshotted into the saved plan (__creatorState) so "Edit Draft" reopens it here.
   State + actions: creator/useCreator.ts · one file per step under creator/. */
import { ArrowLeft, BookOpen, ChartColumn, CircleCheckBig, FileCheck, Lightbulb, Link, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BusyLoader } from './BusyLoader'
import { RegenerateDialog } from './dialogs'
import { busyLabel } from './creator/model'
import { ItemPreview, StepAssessment } from './creator/StepAssessment'
import { StepElos } from './creator/StepElos'
import { StepLearningExperience } from './creator/StepLearningExperience'
import { StepMapping } from './creator/StepMapping'
import { StepObjectives } from './creator/StepObjectives'
import { StepReview } from './creator/StepReview'
import { StepSetup } from './creator/StepSetup'
import { Stepper } from './creator/Stepper'
import { Section } from './creator/ui'
import { useCreator, type Creator } from './creator/useCreator'
import type { CreatorProps } from './creator/useCreatorStore'

export function LessonPlanCreator(props: CreatorProps) {
  const c = useCreator(props)
  const { bindRoot, bindSentinel } = c       // callback refs (kept off `c` so the refs lint does not taint it)

  return (
    <div ref={bindRoot} className="flex min-h-full flex-col">
      {/* Full-page AI loader — freezes the page (scroll locked) while a step generates or saves */}
      {c.busy && <BusyLoader label={busyLabel(c.busy)} />}
      <Regenerate c={c} />
      <ItemPreview c={c} />

      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line bg-ink-900 px-4 py-3.5 animate-fade-up md:px-6">
        <Button variant="ghost" onClick={props.onBack} className="text-ink-500"><ArrowLeft className="h-4 w-4" />Back to Lesson Plans</Button>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-glow"><BookOpen className="h-5 w-5" /></span>
          <div>
            <h1 className="font-display text-xl font-semibold text-fg md:text-[22px]">Lesson Plan <span className="text-gradient">Creator</span></h1>
            <p className="text-[13px] text-ink-500">Craft your perfect lesson plan step by step</p>
          </div>
        </div>
        {/* Persistent "Save as Draft" — save partial work at ANY step once objectives exist; editing the draft
            later reopens the wizard where the teacher left off. */}
        <Button variant="outline" onClick={() => void c.saveDraft()} disabled={c.busy === 'draft' || !c.gen.co}
          title={c.gen.co ? 'Save your progress as a draft' : 'Generate course outcomes first'}
          className="ml-auto border-amber-400/60 font-semibold text-amber-700 hover:bg-amber-400/10">
          <CircleCheckBig className="h-4 w-4" />{c.busy === 'draft' ? 'Saving…' : props.draftId || c.savedId ? 'Update Draft' : 'Save as Draft'}
        </Button>
      </header>

      {/* Sentinel — when it scrolls out of view the sticky stepper condenses. */}
      <div ref={bindSentinel} className="h-px" aria-hidden />
      <Stepper c={c} />

      <Section step={1} tone="brand" icon={BookOpen} title="Basic Setup & Content" subtitle="Configure your lesson basics and upload materials to get started">
        <StepSetup c={c} />
      </Section>
      <Section step={2} tone="purple" icon={Target} title="Manage Objectives" subtitle="Choose what matters most for your students ✨">
        <StepObjectives c={c} />
      </Section>
      <Section step={3} tone="emerald" icon={FileCheck} title="Expected Learning Outcomes" subtitle="Define specific learning outcomes using Bloom's Taxonomy">
        <StepElos c={c} />
      </Section>
      <Section step={4} tone="indigo" icon={Link} title="Objective Mapping" subtitle="Beautiful grid view for mapping Core Objectives to ELOs, Bloom's Taxonomy and Skills">
        <StepMapping c={c} />
      </Section>
      <Section step={5} tone="pink" icon={ChartColumn} title="Assessment" subtitle="Select the ELOs to assess and choose item types — only the ELOs you pick are generated">
        <StepAssessment c={c} />
      </Section>
      <Section step={6} tone="teal" icon={Lightbulb} title="Learning Experience" subtitle="Design engaging learning activities and experiences">
        <StepLearningExperience c={c} />
      </Section>
      <Section step={7} tone="amber" icon={CircleCheckBig} title="Review & Create Your Lesson Plan" subtitle="Everything looks perfect! You're ready to create your lesson plan.">
        <StepReview c={c} />
      </Section>
    </div>
  )
}

/* Shared "Regenerate with Additional Instructions" popup for objectives, learning outcomes and assessment items.
   onConfirm does NOT close it — each regenerate handler owns regenBusy and closes it when the AI call returns,
   so the button spins while the call is in flight. */
function Regenerate({ c }: { c: Creator }) {
  const m = c.regenModal
  const kind = m?.kind ?? 'obj'
  const title = kind === 'elo' ? 'Regenerate Learning Outcome' : kind === 'assessItem' ? 'Regenerate Assessment Item' : 'Regenerate Core Objective'
  const what = kind === 'elo' ? 'learning outcome' : kind === 'assessItem' ? 'assessment item' : 'core objective'
  return (
    <RegenerateDialog open={!!m} busy={c.regenBusy} title={title}
      subtitle={`Provide any specific requirements or modifications for the regenerated ${what}.`}
      onCancel={() => c.setRegenModal(null)}
      onConfirm={(ins) => {
        if (!m) return
        if (m.kind === 'elo') void c.doRegenElo(m.item, ins)
        else if (m.kind === 'assessItem') void c.regenAssessItem(m.elo, m.idx, m.rawItem, ins)
        else void c.doRegenObj(m.item, ins)
      }} />
  )
}
