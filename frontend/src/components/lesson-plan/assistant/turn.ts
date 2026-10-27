/* One teacher message → the assistant's answer (the lesson-plan branches of Rapid's ChatBotScreen `send`):
   class validation at entry → download intent → local pipeline advancement → model round trip → [LIST_CHAPTERS] /
   pipeline tokens → plain reply. Nothing is awaited before the download branch, so the PDF popup opens inside the
   teacher's click / Enter gesture and is not blocked. */
import { aiErrorMessage, lessonPlanService } from '@/services/lessonPlanService'
import { isClassLike, validateClassEntry } from './match'
import { chatContext, runAssessmentParse, runLessonPipeline, runListChapters, toWire } from './pipeline'
import { downloadWordDoc, lessonPlanToHtml, planFileTitle, printHtml } from './planHtml'
import { NO_CLASSES, cleanReply, lessonLocalToken } from './text'
import type { AssistantDeps, Turn } from './types'

const DOWNLOAD_RE = /\b(download|pdf|word|doc|docx|export)\b/i
const NOTHING_YET = "There's no lesson plan to download yet — let's finish generating one first."

function runLessonPdf(turn: Turn, d: AssistantDeps) {
  const r = d.lesson.current
  if (!r) { turn.say(NOTHING_YET); return }
  const opened = printHtml(lessonPlanToHtml(r), planFileTitle(r))
  turn.say(opened
    ? '✅ Your unit plan is open in a print window — choose **Save as PDF** as the destination to download it.'
    : 'Your browser blocked the PDF window. Allow pop-ups for this site, then reply **Download PDF** again.')
}

function runLessonWord(turn: Turn, d: AssistantDeps) {
  const r = d.lesson.current
  if (!r) { turn.say(NOTHING_YET); return }
  try {
    downloadWordDoc(lessonPlanToHtml(r), planFileTitle(r))
    turn.say('✅ Your Word document has been downloaded.')
  } catch (e) { turn.say(`Sorry, the Word file could not be generated: ${aiErrorMessage(e, 'error')}`) }
}

export async function handleTurn(t: string, turn: Turn, d: AssistantDeps): Promise<void> {
  // The class must be one the teacher is ASSIGNED to — checked the moment it is given (until one is locked in).
  if (!d.classOk.current && isClassLike(t)) {
    const vc = validateClassEntry(d.rows, t)
    if (!vc.ok) {
      turn.say(d.rows.length
        ? `You are not assigned to **${t}**. You have been assigned to these classes: **${vc.taught.join(', ') || '—'}**.\n\nWhich of these is this lesson plan for?`
        : NO_CLASSES)
      return
    }
    d.classOk.current = t
  }

  // Download the complete plan (before or after saving, once it has been shown). Ask PDF vs Word if not said.
  if (d.lesson.current && DOWNLOAD_RE.test(t)) {
    if (/\b(word|docx?)\b/i.test(t)) { runLessonWord(turn, d); return }
    if (/\bpdf\b/i.test(t)) { runLessonPdf(turn, d); return }
    turn.say('Which format would you like? Reply **PDF** or **Word**.')
    return
  }

  // Once the pipeline runs, advance it locally (no model round trip) so the growing transcript never overflows the
  // model. The item-mix step is interpreted by the AI; any other non-affirmation falls through to the model.
  const p = d.pipe.current
  if (p) {
    if (p.stage === 'awaiting_assessment_input') { await runAssessmentParse(t, turn, d); return }
    const tok = lessonLocalToken(p.stage, t)
    if (tok && (await runLessonPipeline(tok, turn, d))) return
  }

  const reply = String((await lessonPlanService.assistantChat(toWire(turn.visible), chatContext(d.chapters.current))) ?? '')
  if (!turn.live()) return
  if (reply.includes('[LIST_CHAPTERS]')) { await runListChapters(reply, turn, d); return }
  if (await runLessonPipeline(reply, turn, d)) return
  turn.say(cleanReply(reply) || 'Could you rephrase that?')
}
