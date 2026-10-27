/* The lesson-plan generation pipeline driven by trigger tokens (port of Rapid's runLessonPipeline,
   runAssessmentParse and runListChapters): START → COs → skills + competencies → ELOs → ask the assessment mix →
   assessment items → 5E + assignments → complete plan → save. Generators always get the RESOLVED scope context. */
import { toast } from '@/components/ui/toast'
import { aiErrorMessage, httpStatus, lessonPlanService } from '@/services/lessonPlanService'
import type { GeneratedElo, LpChapter } from '@/types/lessonPlan'
import { ASK_ASSESSMENT, mdAssessment, mdComplete, mdCos, mdElos, mdFiveE, mdSkills } from './markdown'
import { notAssignedText, resolveChapter, validateScope } from './match'
import { buildToolPlan } from './planHtml'
import {
  ASSESS_KEYS, BOARD, ITEM_LABEL, aiText, cleanReply, isObj, jsonAfter, parseAssessmentMix, parseAssignments, parseCos,
  parseElos, parseInputs, parseItems, parseObj, sanitizeReqs, str, uniq,
} from './text'
import type { AssessBlock, AssistantDeps, Assignment, ChaptersCtx, FiveE, Msg, ResolvedCtx, ScopeRow, Turn } from './types'

/** Visible turns in the server's wire shape (progress lines are never sent). */
export const toWire = (msgs: Msg[]) => msgs.filter((m) => !m.busy).map(({ role, content }) => ({ role, content }))

/** What the server needs to build the system prompt: whether [LIST_CHAPTERS] was handled, and the chapters. */
export const chatContext = (cc: ChaptersCtx | null) =>
  cc ? { chaptersLoaded: true, label: cc.label, chapters: cc.list } : { chaptersLoaded: false }

/** A failed generator call in the chat. A 403 (not the teacher's class/subject) shows the server's own words. */
export const failText = (e: unknown, prefix: string) =>
  httpStatus(e) === 403 ? aiErrorMessage(e, 'You are not assigned to this class and subject.') : `${prefix}: ${aiErrorMessage(e, 'error')}`

async function loadChapters(row: ScopeRow): Promise<LpChapter[]> {
  try {
    const list = await lessonPlanService.chapters(row.classCode, row.subjectCode)
    return Array.isArray(list) ? list.filter((c) => c && typeof c.name === 'string' && c.name.trim()) : []
  } catch { return [] }
}

export function buildFiveE(elos: GeneratedElo[]): FiveE {
  return {
    eloSteps: elos.map((elo, ei) => {
      const txt = elo.elo
      return {
        elo: elo.Elo_id || `Elo-${ei + 1}`,
        steps: [
          { name: 'Engage', stepTime: '10', description: `Activate prior knowledge for: ${txt}` },
          { name: 'Explore', stepTime: '15', description: `Students investigate: ${txt}` },
          { name: 'Explain', stepTime: '10', description: `Clarify the core concept: ${txt}` },
          { name: 'Elaborate', stepTime: '10', description: `Apply and extend: ${txt}` },
          { name: 'Evaluate', stepTime: '5', description: `Assess understanding of: ${txt}` },
        ],
      }
    }),
  }
}

/** [LIST_CHAPTERS] {"class","subject"}: resolve the pair to the teacher's own, load its chapters into the chat context
    (so the bot validates the chapter AT ENTRY), then re-ask the model so it poses the chapter question. */
export async function runListChapters(reply: string, turn: Turn, d: AssistantDeps): Promise<void> {
  const o = parseObj(jsonAfter(reply, '[LIST_CHAPTERS]')) ?? {}
  const typedClass = str(o.class) || str(o.grade) || str(o.class_name)
  const typedSubject = str(o.subject) || str(o.subject_name)
  if (!typedClass || !typedSubject) { turn.say('Please tell me the **class** and the **subject** for this lesson plan.'); return }
  const { row, classRows } = validateScope(d.rows, typedClass, typedSubject)
  if (!row) {
    d.chapters.current = null                         // not loaded → the bot emits [LIST_CHAPTERS] for the corrected pair
    if (!classRows.length) d.classOk.current = null   // re-check the next class they give
    turn.say(notAssignedText(d.rows, typedClass, typedSubject, classRows))
    return
  }
  const chapters = await loadChapters(row)
  if (!turn.live()) return
  d.chapters.current = { label: `${row.className} · ${row.subjectName}`, list: chapters.map((c) => c.name), chapters, row }
  try {
    const next = cleanReply(await lessonPlanService.assistantChat(toWire(turn.visible), chatContext(d.chapters.current)))
    if (next) { turn.say(next); return }
  } catch { /* fall through to a direct prompt */ }
  turn.say('Which chapter should it cover?')
}

/** Handle a pipeline trigger token in `reply`. true when it was handled (the caller then stops). */
export async function runLessonPipeline(reply: string, turn: Turn, d: AssistantDeps): Promise<boolean> {
  const has = (tok: string) => reply.includes(tok)

  if (has('[START_LESSON_PIPELINE]')) {
    const inputs = parseInputs(jsonAfter(reply, '[START_LESSON_PIPELINE]'))
    if (!inputs) { turn.say('I could not read the setup. Please restate the inputs.'); return true }
    const { row, classRows } = validateScope(d.rows, inputs.class_name, inputs.subject_name)
    if (!row) { turn.say(notAssignedText(d.rows, inputs.class_name, inputs.subject_name, classRows)); return true }
    // The chapter was validated at entry against the loaded list; resolve its canonical name (or load the list now
    // when the bot moved to another class/subject since).
    const cc = d.chapters.current
    let chapters: LpChapter[]
    if (cc && cc.row.classCode === row.classCode && cc.row.subjectCode === row.subjectCode) chapters = cc.chapters
    else {
      turn.say('Checking the chapter…', true)
      chapters = await loadChapters(row)
      if (!turn.live()) return true
    }
    let chapter: LpChapter | null = null
    let offCurriculum = false   // off-curriculum chapters can be planned (best-effort) but NOT saved
    if (chapters.length) {
      chapter = resolveChapter(inputs.chapter_name, chapters)
      if (chapter) inputs.chapter_name = chapter.name
      else offCurriculum = true
    }
    const named = { ...inputs, class_name: row.className, subject_name: row.subjectName }
    const ctx: ResolvedCtx = { board: BOARD, grade: row.className, subject: row.subjectName, class_code: row.classCode, subject_code: row.subjectCode }
    turn.say('Generating Course Outcomes...', true)
    try {
      const res = await lessonPlanService.courseOutcomes({
        ...ctx, chapter: named.chapter_name, co_count: named.co_count,
        textbook_id: chapter?.textbook_id ?? null, chapter_number: chapter?.chapter_number ?? null,
      })
      if (!turn.live()) return true
      const cos = parseCos(isObj(res) ? res.course_outcomes : null)
      if (!cos.length) { turn.say('Course outcomes failed: no course outcomes came back. Please try again.'); return true }
      d.pipe.current = { stage: 'cos', inputs: named, grade: row.className, cos, elos: [], assessment: [], assignments: [], fiveE: null, offCurriculum, ctx, chapter }
      turn.say(mdCos(named, cos))
    } catch (e) { turn.say(failText(e, 'Course outcomes failed')) }
    return true
  }

  const p = d.pipe.current
  if (!p) {
    if (has('[SAVE_LESSON_PLAN]') && d.saved.current) { turn.say('This lesson plan is already saved to your library.'); return true }
    return false
  }
  const st = p.stage
  const chapter = p.inputs.chapter_name

  if (has('[PROCEED_TO_SKILLS]') && st === 'cos') {
    let cos = p.cos.slice()
    turn.say('Generating Skills & Competencies...', true)
    try {
      const sd = await lessonPlanService.skillsPerCo({ ...p.ctx, chapter, total_outcomes: cos.length, course_outcomes: cos })
      const withSkills = parseCos(isObj(sd) ? sd.course_outcomes : null)
      if (withSkills.length) cos = withSkills
      const cd = await lessonPlanService.competenciesPerCo({ ...p.ctx, chapter, total_outcomes: cos.length, course_outcomes: cos })
      const withComps = parseCos(isObj(cd) ? cd.course_outcomes : null)
      if (withComps.length) cos = withComps
      if (!turn.live()) return true
      d.pipe.current = { ...p, cos, stage: 'elos' }
      turn.say(mdSkills(cos))
    } catch (e) { turn.say(failText(e, 'Skills generation failed')) }
    return true
  }

  if (has('[PROCEED_TO_ASSESSMENT]') && st === 'elos') {
    turn.say('Generating Expected Learning Outcomes...', true)
    try {
      const skills = uniq(p.cos.flatMap((c) => c.skills ?? []))
      const competencies = uniq(p.cos.flatMap((c) => c.competencies ?? []))
      const res = await lessonPlanService.elos({
        ...p.ctx, chapter, course_outcomes: p.cos, blooms_elo_counts: p.inputs.blooms_counts, skills, competencies, attitudes: p.inputs.attitudes,
      })
      if (!turn.live()) return true
      const elos = parseElos(res)
      if (!elos.length) { turn.say('No learning outcomes came back. Reply **Yes** to try again.'); return true }
      d.pipe.current = { ...p, elos, stage: 'assessment_question' }
      turn.say(mdElos(elos))
    } catch (e) { turn.say(failText(e, 'ELO generation failed')) }
    return true
  }

  // Accept either token here — the model sometimes jumps straight to [PROCEED_TO_ASSESSMENT]; either way we ask.
  if ((has('[ASK_ASSESSMENT_DETAILS]') || has('[PROCEED_TO_ASSESSMENT]')) && st === 'assessment_question') {
    d.pipe.current = { ...p, stage: 'awaiting_assessment_input' }
    turn.say(ASK_ASSESSMENT)
    return true
  }

  if (has('[PROCEED_TO_ASSESSMENT]') && st === 'awaiting_assessment_input') {
    const parsed = parseObj(jsonAfter(reply, '[PROCEED_TO_ASSESSMENT]'))
    const reqs = sanitizeReqs(parsed?.assessment_requirements) ?? parseAssessmentMix('')
    const details = ASSESS_KEYS.filter((k) => reqs[k] > 0).map((k) => ({ itemType: ITEM_LABEL[k], noOfItems: reqs[k], includeLOTS: false }))
    const assessment: AssessBlock[] = []
    let failed = 0
    let lastErr: unknown = null
    for (let i = 0; i < p.elos.length; i += 1) {
      const elo = p.elos[i]
      turn.say(`Generating assessment items... (${i + 1} of ${p.elos.length})`, true)
      try {
        const res = await lessonPlanService.assessmentItems({
          ...p.ctx, topic: chapter, elo: elo.elo, Bloom_level: elo.bloom_level || 'Apply', assessment_details: details,
        })
        assessment.push({ id: elo.Elo_id || `Elo-${i + 1}`, items: parseItems(res) })
      } catch (e) {
        if (httpStatus(e) === 403) { turn.say(failText(e, 'Assessment generation failed')); return true }
        failed += 1
        lastErr = e
      }
      if (!turn.live()) return true
    }
    if (p.elos.length && failed === p.elos.length) {
      turn.say(`Assessment generation failed: ${aiErrorMessage(lastErr, 'error')}\n\nTell me the item mix again to retry.`)
      return true   // stays on the item-mix step
    }
    d.pipe.current = { ...p, assessment, assessInput: '', stage: 'fivee' }
    turn.say(mdAssessment(assessment, failed))
    return true
  }

  if (has('[PROCEED_TO_FIVEE]') && st === 'fivee') {
    turn.say('Generating the 5E plan...', true)
    let assignments: Assignment[] = []
    try {
      const res = await lessonPlanService.assignments({ ...p.ctx, chapter, elos: p.elos.map((e) => e.elo), course_outcomes: p.cos })
      assignments = parseAssignments(isObj(res) ? res.assignments : null)
    } catch { /* best-effort, as in Rapid */ }
    if (!turn.live()) return true
    const fiveE = buildFiveE(p.elos)
    d.pipe.current = { ...p, fiveE, assignments, stage: 'complete' }
    turn.say(mdFiveE(fiveE, assignments))
    return true
  }

  if (has('[PROCEED_TO_COMPLETE_PLAN]') && st === 'complete') {
    d.lesson.current = p   // for a later "download PDF / Word"
    d.saved.current = false
    turn.say(mdComplete(p))
    return true
  }

  if (has('[SAVE_LESSON_PLAN]') && st === 'complete') {
    if (p.offCurriculum) {
      turn.say(`“${chapter}” is not in your curriculum, so this lesson plan can't be saved to your library. You can still **Download PDF** or **Download Word** to keep a copy.`)
      return true
    }
    turn.say('Saving the lesson plan...', true)
    try {
      await lessonPlanService.savePlan({
        classCode: p.ctx.class_code, className: p.ctx.grade, subjectCode: p.ctx.subject_code, subjectName: p.ctx.subject,
        chapterName: chapter, ...(p.chapter ? { textbookId: p.chapter.textbook_id, chapterNumber: p.chapter.chapter_number } : {}),
        unitPlanTitle: `${chapter} Unit Plan`, board: BOARD, durationMins: p.inputs.duration_mins,
        plan: buildToolPlan(p), isCompleted: true, source: 'ai_bot',
      })
      d.onSaved()   // the repository reloads
      toast('Lesson plan saved', 'success')
      if (!turn.live()) return true
      d.lesson.current = p   // "download" keeps working after the save
      d.saved.current = true
      d.pipe.current = null
      const items = p.assessment.reduce((n, a) => n + a.items.length, 0)
      turn.say(`Lesson plan saved. ${p.elos.length} ELOs, ${items} assessment items. Go **Back** to the Lesson Plan Repository to view it.`)
    } catch (e) { turn.say(failText(e, 'Could not save')) }
    return true
  }
  return false
}

/** The teacher's FREE-FORM item mix, interpreted by the AI and accumulated across clarification turns; falls back to
    the local parser. Only the accumulated mix text is sent — no transcript replay. */
export async function runAssessmentParse(userText: string, turn: Turn, d: AssistantDeps): Promise<void> {
  const p = d.pipe.current
  if (!p) return
  const combined = (p.assessInput ? `${p.assessInput}\n` : '') + userText
  d.pipe.current = { ...p, assessInput: combined }
  let res: unknown = null
  try { res = await lessonPlanService.assessmentMix(combined) } catch { res = null }
  if (!turn.live()) return
  const clarify = isObj(res) ? aiText(res.clarify, 'assessment_mix') : ''
  if (clarify) { turn.say(clarify); return }   // stay on this step; the next reply is appended to `combined`
  const reqs = (isObj(res) ? sanitizeReqs(res.assessment_requirements) : null) ?? parseAssessmentMix(combined)
  if (d.pipe.current) d.pipe.current = { ...d.pipe.current, assessInput: '' }
  await runLessonPipeline('[PROCEED_TO_ASSESSMENT] ' + JSON.stringify({ assessment_requirements: reqs }), turn, d)
}
