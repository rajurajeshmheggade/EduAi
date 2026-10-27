/* The chat text for each pipeline stage — same layout and copy as Rapid's runLessonPipeline. Every value is
   already validated by text.ts; `one()` keeps a field on one line so it cannot break the Markdown structure. */
import type { CourseOutcome, GeneratedElo } from '@/types/lessonPlan'
import { fmtDuration, uniq } from './text'
import type { AssessBlock, Assignment, FiveE, LessonInputs, Pipeline } from './types'

const one = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim()
const eloId = (e: GeneratedElo, i: number) => e.Elo_id || `Elo-${i + 1}`
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export function mdCos(inputs: LessonInputs, cos: CourseOutcome[]): string {
  let md = `### Course Outcomes - ${one(inputs.chapter_name)}\n\n`
  cos.forEach((co, i) => { md += `**${one(co.co_id || `CO${i + 1}`)}. ${one(co.co_title || co.factor)}**\n${one(co.co_description)}\n\n` })
  return md + '_Looks good? Reply **Yes** to generate Skills & Competencies._'
}

export function mdSkills(cos: CourseOutcome[]): string {
  const skills = uniq(cos.flatMap((c) => c.skills ?? []).map(one))
  const comps = uniq(cos.flatMap((c) => c.competencies ?? []).map(one))
  return `### Skills & Competencies\n\n**Skills:** ${skills.join(', ') || '-'}\n\n**Competencies:** ${comps.join(', ') || '-'}\n\n`
    + '_Reply **Yes** to generate Expected Learning Outcomes._'
}

export function mdElos(elos: GeneratedElo[]): string {
  let md = '### Expected Learning Outcomes\n\n'
  elos.forEach((e, i) => { md += `**${one(eloId(e, i))}**${e.bloom_level ? ` (${one(e.bloom_level)})` : ''}: ${one(e.elo)}\n\n` })
  return md + '_Reply **Yes** to continue to assessment._'
}

export const ASK_ASSESSMENT = '### Assessment Requirements\n\nWhat items would you like? (MCQ, True/False, Short Answer, Long Answer, Case Study)\n\nExample: **MCQ: 5, Short Answer: 3**'

function mdBlocks(blocks: AssessBlock[], withCount: boolean): string {
  let md = ''
  blocks.forEach((a) => {
    md += `#### ${one(a.id)}${withCount ? ` (${plural(a.items.length, 'item')})` : ''}\n\n`
    if (!a.items.length) { md += '_No items came back for this outcome._\n\n'; return }
    a.items.forEach((it, ii) => {
      if (it.context) md += `**Context:** ${one(it.context)}\n\n`
      md += `**Q${ii + 1}.** ${one(it.question)}\n`
      it.options.forEach((o, oi) => { md += `- **${String.fromCharCode(65 + oi)}.** ${one(o)}\n` })
      md += `\n**✅ Answer:** ${one(it.answer) || '—'}\n\n---\n\n`
    })
  })
  return md
}

export function mdAssessment(blocks: AssessBlock[], failed: number): string {
  let md = '### Assessment Items\n\n' + mdBlocks(blocks, false)
  if (failed) md += `_Items for ${plural(failed, 'learning outcome')} could not be generated._\n\n`
  return md + '_Reply **Yes** to generate the 5E lesson plan._'
}

export function mdFiveE(fiveE: FiveE, assignments: Assignment[]): string {
  let md = '### 5E Learning Experience\n\n'
  fiveE.eloSteps.forEach((es) => {
    md += `**${one(es.elo)}**\n`
    es.steps.forEach((s) => { md += `- **${s.name}** (${s.stepTime} min): ${one(s.description)}\n` })
    md += '\n'
  })
  if (assignments.length) {
    md += '### Assignments\n'
    assignments.forEach((a, i) => { md += `${i + 1}. **${one(a.title)}**${a.purpose ? ` - ${one(a.purpose)}` : ''}\n` })
    md += '\n'
  }
  return md + '_Reply **Yes** to see the complete plan._'
}

export function mdComplete(p: Pipeline): string {
  const { inputs, cos, elos, assessment, assignments } = p
  let md = `## Complete Unit Plan - ${one(inputs.chapter_name)}\n\n`
  md += `**Class:** ${one(inputs.class_name)} | **Subject:** ${one(inputs.subject_name)} | **Duration:** ${fmtDuration(inputs.duration_mins)}\n\n`
  md += '### Course Outcomes\n'
  cos.forEach((c, i) => { md += `**${one(c.co_id || `CO${i + 1}`)}.** ${one(c.co_title || c.factor)} - ${one(c.co_description)}\n` })
  md += '\n### Learning Outcomes\n'
  elos.forEach((e, i) => { md += `**${one(eloId(e, i))}**: ${one(e.elo)}\n` })
  md += '\n### Assessment\n\n' + mdBlocks(assessment, true)
  if (assignments.length) {
    md += '### Assignments\n'
    assignments.forEach((a, i) => { md += `${i + 1}. ${one(a.title)}\n` })
  }
  md += p.offCurriculum
    ? `\n---\n_"${one(inputs.chapter_name)}" is not in your curriculum, so this plan **cannot be saved** — but you can **Download PDF** or **Download Word** to keep a copy._`
    : '\n---\n_Reply **Download PDF** or **Download Word** to get this plan as a file, or **Save Lesson Plan** to add it to your library. (A plain "Yes" will not save.)_'
  return md
}
