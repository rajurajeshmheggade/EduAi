/* Print/PDF document for a Session Plan.

   This used to clone the live screen's innerHTML into a popup. That is why the alignment was wrong:
   the screen is laid out with CSS grid, flex and aspect-ratio, none of which survive a print context
   intact — columns collapsed, thumbnails stretched, cards split across page breaks, and the browser
   dropped every background colour because printing defaults to colour-adjust: economy.

   So the document is BUILT, not cloned. Same visual language as the screen (tinted card headers, icon
   chips, the blue/violet accents) but expressed in print-safe CSS: explicit table/inline-block layout,
   print-color-adjust: exact so the colours actually come out, and page-break rules so a card never
   tears in half.

   Everything here is escaped — the content is model-generated and goes into a document we hand to the
   browser, so no value is ever interpolated raw.

   Ported verbatim from Rapid's sessionPlanPrint.js; only the types (and the footer's product name) changed. */
import type { AgentItem, AgentKey, AgentStatus, LessonPlanRow, SessionContent, SessionRow } from '@/types/lessonPlan'

type Rec = Record<string, unknown>

const esc = (v: unknown) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Model text may carry newlines; keep them without letting any markup through. */
const escLines = (v: unknown) => esc(v).replace(/\r?\n/g, '<br>');

/** Only http(s) URLs reach an href/src. */
const safeUrl = (u: unknown) => {
  const s = String(u || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
};

const arr = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const trim = (v: unknown) => String(v == null ? '' : v).trim();
const texts = (v: unknown) => arr(v)
  .map((x) => (typeof x === 'string' ? x : trim(x && typeof x === 'object' && ((x as Rec).text || (x as Rec).elo || (x as Rec).title))))
  .filter(Boolean);

/** A card: tinted header with a coloured rule, then body. Never splits across a page. */
const card = (accent: string, tint: string, title: string, sub: string, body: string) => !body ? '' : `
  <section class="card" style="--accent:${accent};--tint:${tint}">
    <header><span class="dot"></span><h2>${esc(title)}</h2>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</header>
    <div class="body">${body}</div>
  </section>`;

const olList = (items: string[]) => items.length === 0 ? '' :
  `<ol class="steps">${items.map((t) => `<li>${escLines(t)}</li>`).join('')}</ol>`;

const ulList = (items: string[]) => items.length === 0 ? '' :
  `<ul class="bullets">${items.map((t) => `<li>${escLines(t)}</li>`).join('')}</ul>`;

/** One agent block. Images print as a grid, videos as a thumbnail wall, documents and articles as rows. */
function agentBlock(kind: 'news' | 'video' | 'images' | 'docs', items: unknown, status: AgentStatus | undefined, emptyText: string) {
  const rows = arr<Partial<AgentItem>>(items).filter((x) => x && typeof x === 'object');
  const st: Partial<AgentStatus> = status || {};
  if (rows.length === 0) {
    const broke = st.status === 'unavailable' || st.status === 'not_configured';
    return `<p class="muted">${esc(broke ? (st.message || 'This content could not be fetched.') : emptyText)}</p>`;
  }
  const note = st.message ? `<p class="note">${esc(st.message)}</p>` : '';

  if (kind === 'images') {
    return note + `<div class="imgs">${rows.map((x) => {
      const src = safeUrl(x.thumbnail || x.url);
      if (!src) return '';
      return `<figure><img src="${esc(src)}" alt="" referrerpolicy="no-referrer"><figcaption>${esc(x.title || '')}</figcaption></figure>`;
    }).join('')}</div>`;
  }

  // Study material prints as a document list with its file badge and the full link, because a printed
  // plan is what a teacher carries — the URL has to be readable off the page.
  if (kind === 'docs') {
    return note + `<div class="docs">${rows.map((x) => {
      const href = safeUrl(x.url);
      const badge = String((x.source || '').split('·')[0] || 'DOC').trim().toUpperCase().slice(0, 4);
      return `<div class="doc">
        <span class="docBadge">${esc(badge)}</span>
        <div class="docText">
          <div class="docTitle">${esc(x.title || '')}</div>
          ${x.snippet ? `<div class="docSnip">${esc(x.snippet)}</div>` : ''}
          <div class="docMeta">${esc([x.source, x.date].filter(Boolean).join(' · '))}</div>
          ${href ? `<div class="docUrl">${esc(href)}</div>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  // Video references print as the same thumbnail wall the screen shows — a teacher recognises the
  // frame before they read the title, and a printed list of links loses exactly that. The play badge
  // is drawn in CSS so it survives without an icon font, and the link is printed underneath because
  // paper cannot be clicked.
  if (kind === 'video') {
    return note + `<div class="vids">${rows.map((x) => {
      const thumb = safeUrl(x.thumbnail);
      const href = safeUrl(x.url);
      return `<figure class="vid">
        <span class="vidShot">${thumb ? `<img src="${esc(thumb)}" alt="" referrerpolicy="no-referrer">` : '<span class="vidPh"></span>'}<span class="vidPlay"></span></span>
        <figcaption>
          <span class="vidTitle">${esc(x.title || '')}</span>
          ${x.source ? `<span class="vidSrc">${esc(x.source)}${x.date ? ' · ' + esc(x.date) : ''}</span>` : ''}
          ${href ? `<span class="vidUrl">${esc(href)}</span>` : ''}
        </figcaption>
      </figure>`;
    }).join('')}</div>`;
  }

  return note + `<div class="refs">${rows.map((x) => {
    const href = safeUrl(x.url);
    const thumb = safeUrl(x.thumbnail);
    return `<div class="ref">
      ${thumb ? `<img class="thumb" src="${esc(thumb)}" alt="" referrerpolicy="no-referrer">` : '<span class="thumb ph"></span>'}
      <div class="refText">
        <div class="refTitle">${esc(x.title || '')}</div>
        ${x.snippet ? `<div class="refSnip">${esc(x.snippet)}</div>` : ''}
        <div class="refMeta">${esc([x.source, x.date].filter(Boolean).join(' · '))}</div>
        ${href ? `<div class="refUrl">${esc(href)}</div>` : ''}
      </div>
    </div>`;
  }).join('')}</div>`;
}

/** Everything the document is built from. */
export interface SessionPlanPrintInput {
  session: Partial<SessionRow> | null | undefined
  content: SessionContent | null | undefined
  agents: Partial<Record<AgentKey, AgentStatus>> | null | undefined
  plan: Partial<LessonPlanRow> | null | undefined
}

/** The full printable document. */
export function buildSessionPlanHtml({ session, content, agents, plan }: SessionPlanPrintInput): string {
  const s: Partial<SessionRow> = session || {};
  // Model output: read field by field, never trusted to match its declared shape.
  const c = (content || {}) as Rec;
  const a: Partial<Record<AgentKey, AgentStatus>> = agents || {};
  const extra = ((c.additionalSections && typeof c.additionalSections === 'object') ? c.additionalSections : {}) as Partial<Record<AgentKey, unknown>>;

  const title = trim(c.title) || trim(s.title) || 'Session Plan';
  const chapter = trim(s.chapterName) || trim(plan && (plan.chapterName || plan.title));
  const grade = trim(s.className) || trim(plan && plan.className);
  const subject = trim(s.subjectName) || trim(plan && plan.subjectName);
  const duration = s.durationMins ? s.durationMins + ' mins' : '';

  const outcomes = texts(c.learningOutcomes).length ? texts(c.learningOutcomes) : texts(s.elos);
  const stages = arr<Rec>(c.stages).filter((x) => x && trim(x.stage));
  const vocab = arr<Rec>(c.keyVocabulary).filter((x) => x && trim(x.term));
  const materials = arr<Rec>(c.materials).filter((x) => x && trim(x.name));
  const assessment = (c.assessment && typeof c.assessment === 'object') ? c.assessment as Rec : null;
  const diff = (c.differentiation && typeof c.differentiation === 'object') ? c.differentiation as Rec : null;
  const realWorld = arr<Rec>(c.realWorldExamples).filter((x) => x && trim(x.example));
  const discussion = arr<Rec>(c.discussionQuestions).filter((x) => x && trim(x.question));

  const chip = (k: string, v: string) => !v ? '' : `<span class="chip"><b>${esc(k)}</b>${esc(v)}</span>`;

  const stagesHtml = stages.map((ph, i) => `
    <div class="stage">
      <div class="stageHead">
        <span class="num">${i + 1}</span>
        <span class="stageName">${esc(ph.stage)}</span>
        ${trim(ph.classSetting) ? `<span class="pill setting">${esc(ph.classSetting)}</span>` : ''}
        ${ph.durationMins ? `<span class="pill time">${esc(ph.durationMins)} min</span>` : ''}
      </div>
      ${trim(ph.teacherNotes) ? `<p class="notes">${escLines(ph.teacherNotes)}</p>` : ''}
      ${olList(texts(ph.steps))}
      ${texts(ph.questions).length ? `<div class="qa"><span class="qaTitle">Questions to ask</span>${ulList(texts(ph.questions))}</div>` : ''}
      ${arr(ph.resources).length ? `<div class="res">${arr<Rec>(ph.resources).filter((r) => r && typeof r === 'object').map((r) => `
        <div class="resItem">
          <div class="resName">${esc(trim(r.title) || trim(r.name))}</div>
          ${trim(r.howToUse) ? `<div class="resHow">${escLines(r.howToUse)}</div>` : ''}
        </div>`).join('')}</div>` : ''}
    </div>`).join('');

  const body = [
    trim(c.overview) && card('#0070E0', '#F1F7FF', 'Overview', '', `<p>${escLines(c.overview)}</p>`),
    outcomes.length && card('#16A34A', '#F1FBF5', `Expected Learning Outcome${outcomes.length === 1 ? '' : 's'}`, 'From this lesson plan', olList(outcomes)),
    trim(s.instructions) && card('#7C3AED', '#F7F4FF', 'Session Instructions', '', `<p>${escLines(s.instructions)}</p>`),
    trim(c.prerequisiteKnowledge) && card('#0EA5E9', '#F0F9FF', 'Prerequisite Knowledge', '', `<p>${escLines(c.prerequisiteKnowledge)}</p>`),
    texts(c.specificObjectives).length && card('#16A34A', '#F1FBF5', 'Specific Objectives', '', olList(texts(c.specificObjectives))),
    vocab.length && card('#EA580C', '#FFF6EF', 'Key Vocabulary', '', `<div class="vocab">${vocab.map((v) => `
        <div class="vocabItem">
          <div class="term">${esc(v.term)}</div>
          ${trim(v.definition) ? `<div class="def">${escLines(v.definition)}</div>` : ''}
          ${trim(v.example) ? `<div class="eg">${escLines(v.example)}</div>` : ''}
        </div>`).join('')}</div>`),
    materials.length && card('#0891B2', '#EFFBFD', 'Materials', '', `<ul class="bullets">${materials.map((m) => `
        <li><b>${esc(m.name)}</b>${trim(m.quantity) ? ` <span class="qty">${esc(m.quantity)}</span>` : ''}${trim(m.notes) ? ` — ${escLines(m.notes)}` : ''}</li>`).join('')}</ul>`),
    stages.length && card('#0070E0', '#F1F7FF', 'Session Flow', `${stages.length} stage${stages.length === 1 ? '' : 's'}`, stagesHtml),
    assessment && (trim(assessment.description) || texts(assessment.successCriteria).length) && card('#15803D', '#F1FBF5', 'Assessment', trim(assessment.type),
      `${trim(assessment.description) ? `<p>${escLines(assessment.description)}</p>` : ''}
       ${texts(assessment.successCriteria).length ? `<div class="qa"><span class="qaTitle">Success criteria</span>${olList(texts(assessment.successCriteria))}</div>` : ''}`),
    diff && (trim(diff.support) || trim(diff.extensions)) && card('#DB2777', '#FFF2F8', 'Differentiation', '',
      `${trim(diff.support) ? `<div class="sub2"><span class="qaTitle">Support</span><p>${escLines(diff.support)}</p></div>` : ''}
       ${trim(diff.extensions) ? `<div class="sub2"><span class="qaTitle">Extensions</span><p>${escLines(diff.extensions)}</p></div>` : ''}`),
    realWorld.length && card('#0891B2', '#EFFBFD', 'Real-World Examples', '',
      `<div class="rw">${realWorld.map((x, i) => `
        <div class="rwItem"><span class="rwNum">${i + 1}</span><div>
          <div class="rwEg">${escLines(x.example)}</div>
          ${trim(x.explanation) ? `<div class="rwWhy">${escLines(x.explanation)}</div>` : ''}
        </div></div>`).join('')}</div>`),
    discussion.length && card('#A16207', '#FFFBEB', 'Discussion Questions', `${discussion.length} question${discussion.length === 1 ? '' : 's'}`,
      `<div class="dq">${discussion.map((x, i) => `
        <div class="dqItem"><span class="dqNum">Q${i + 1}</span><div>
          <div class="dqQ">${escLines(x.question)}</div>
          ${trim(x.purpose) ? `<div class="dqP">${escLines(x.purpose)}</div>` : ''}
        </div></div>`).join('')}</div>`),
    trim(c.homework) && card('#A16207', '#FFFBEB', 'Homework', '', `<p>${escLines(c.homework)}</p>`),
    card('#0891B2', '#EFFBFD', 'Current Affairs', '', agentBlock('news', extra.currentAffairs, a.currentAffairs, 'Current affairs are not available for this chapter.')),
    card('#DB2777', '#FFF2F8', 'Video References', '', agentBlock('video', extra.educationalVideos, a.educationalVideos, 'No video references are available for this chapter.')),
    card('#7C3AED', '#F7F4FF', 'Images', '', agentBlock('images', extra.images, a.images, 'No images are available for this chapter.')),
    card('#15803D', '#F1FBF5', 'Educational Documents', '', agentBlock('docs', extra.educationalDocuments, a.educationalDocuments, 'No NCERT study material was found for this chapter.')),
  ].filter(Boolean).join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  /* Colours are part of the document, not decoration — force the browser to print them. */
  *,*::before,*::after{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  /* Extra room at the foot so a last line never sits on the trim edge. */
  @page{size:A4;margin:13mm 13mm 16mm}
  body{margin:0;background:#fff;color:#1A1E26;
       font-family:'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       font-size:11.5pt;line-height:1.6}
  p{margin:0 0 8px}
  p:last-child{margin-bottom:0}

  /* PAGE BREAKS — why it is done this way.
     Marking a whole card "do not break" is what was chopping content off: a card taller than one page
     cannot honour that, and the engine then overflows it past the bottom margin instead of flowing it.
     So cards are allowed to break, and the SMALL units inside them are the ones held together — a
     stage, a vocabulary tile, an image cell, a reference row, a list item. A card header is pinned to
     whatever follows it, so a title never ends up stranded alone at the foot of a page. */
  .card{break-inside:auto;page-break-inside:auto}
  .card>header{break-inside:avoid;page-break-inside:avoid;break-after:avoid;page-break-after:avoid}
  p,li{orphans:3;widows:3}
  h1,h2{break-after:avoid;page-break-after:avoid}

  .banner{background:linear-gradient(120deg,#0070E0 0%,#5B8DEF 55%,#7C3AED 100%);color:#fff;
          border-radius:14px;padding:18px 20px;margin-bottom:14px}
  .eyebrow{font-size:8.5pt;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.85}
  .banner h1{margin:4px 0 0;font-size:19pt;font-weight:600;line-height:1.25;letter-spacing:-.01em}

  .meta{margin:0 0 16px;padding:0;list-style:none}
  .chip{display:inline-block;margin:0 6px 6px 0;padding:5px 11px;border-radius:999px;
        background:#F2F6FC;border:1px solid #DDE7F4;font-size:9.5pt;color:#3D4757}
  .chip b{font-weight:600;color:#6A7280;margin-right:6px}

  .card{border:1px solid #DFE8F3;border-radius:12px;margin:0 0 12px}
  .card>header{display:flex;align-items:center;gap:8px;padding:9px 14px;
        background:var(--tint);border-bottom:2px solid var(--accent)}
  .card .dot{width:9px;height:9px;border-radius:50%;background:var(--accent);flex:none}
  .card h2{margin:0;font-size:12pt;font-weight:600;color:#1A1E26}
  .card .sub{margin-left:auto;font-size:9pt;color:#6A7280}
  .card .body{padding:12px 14px}

  .steps,.bullets{margin:0;padding-left:20px}
  .steps li,.bullets li{margin:0 0 5px;break-inside:avoid;page-break-inside:avoid}
  .steps li::marker{color:#0070E0;font-weight:700}

  .stage{border:1px solid #E4EDF8;border-left:3px solid #0070E0;border-radius:9px;
         padding:10px 12px;margin:0 0 10px;page-break-inside:avoid;break-inside:avoid}
  .stage:last-child{margin-bottom:0}
  .stageHead{display:flex;align-items:center;gap:7px;margin-bottom:6px;flex-wrap:wrap}
  .num{display:inline-block;min-width:18px;height:18px;line-height:18px;text-align:center;
       border-radius:5px;background:#EAF3FE;color:#0070E0;font-size:8.5pt;font-weight:700}
  .stageName{font-size:11.5pt;font-weight:600;flex:1}
  .pill{padding:2px 9px;border-radius:999px;font-size:8.5pt;font-weight:600}
  .pill.setting{background:#F5F3FF;color:#7C3AED}
  .pill.time{background:#EAF3FE;color:#0070E0}
  .notes{color:#3D4757;margin-bottom:6px}

  .qa{margin-top:7px;padding-top:7px;border-top:1px solid #EEF2F7;break-inside:avoid;page-break-inside:avoid}
  .qaTitle{display:block;font-size:9pt;font-weight:600;color:#6A7280;margin-bottom:4px}
  .sub2{margin-bottom:8px}
  .sub2:last-child{margin-bottom:0}

  .res{margin-top:7px;padding-top:7px;border-top:1px solid #EEF2F7}
  .resItem{background:#FBFCFE;border:1px solid #E9EFF7;border-radius:8px;padding:8px 10px;margin-bottom:6px;
           break-inside:avoid;page-break-inside:avoid}
  .resItem:last-child{margin-bottom:0}
  .resName{font-weight:600;font-size:10.5pt}
  .resHow{color:#3D4757;margin-top:2px}

  .vocab,.imgs{display:block}
  .vocabItem{display:inline-block;width:48%;vertical-align:top;margin:0 1% 8px 0;
             background:#FFFBF7;border:1px solid #FBE3CD;border-radius:8px;padding:8px 10px;
             page-break-inside:avoid;break-inside:avoid}
  .term{font-weight:600;color:#B45309}
  .def{color:#3D4757;margin-top:2px}
  .eg{color:#6A7280;font-style:italic;margin-top:2px}
  .qty{background:#EAF3FE;color:#0070E0;border-radius:999px;padding:1px 7px;font-size:8.5pt;font-weight:600}

  /* Fixed cells rather than grid: print engines lay inline-block out predictably. */
  .imgs figure{display:inline-block;width:31.5%;margin:0 1% 9px 0;vertical-align:top;
               page-break-inside:avoid;break-inside:avoid}
  .imgs img{display:block;width:100%;height:74px;object-fit:cover;border-radius:7px;
            border:1px solid #E4EDF8;background:#F2F5FA}
  .imgs figcaption{font-size:8.5pt;color:#6A7280;margin-top:3px;line-height:1.35;
                   display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

  /* Video wall — mirrors the on-screen tiles: 16:9 frame, play badge, title, channel, link. */
  .vids .vid{display:inline-block;width:48%;margin:0 1.5% 10px 0;vertical-align:top;
             page-break-inside:avoid;break-inside:avoid}
  .vidShot{position:relative;display:block;width:100%;height:92px;border-radius:8px;overflow:hidden;
           background:#0F172A;border:1px solid #E4EDF8}
  .vidShot img{display:block;width:100%;height:100%;object-fit:cover}
  .vidPh{display:block;width:100%;height:100%;background:#1E293B}
  /* Play badge: a white disc with a CSS triangle, so no icon font is needed in the print document. */
  .vidPlay{position:absolute;top:50%;left:50%;width:26px;height:26px;margin:-13px 0 0 -13px;
           border-radius:50%;background:rgba(255,255,255,.94);box-shadow:0 2px 6px rgba(0,0,0,.45)}
  .vidPlay::after{content:"";position:absolute;top:50%;left:54%;transform:translate(-50%,-50%);
                  border-style:solid;border-width:5px 0 5px 8px;border-color:transparent transparent transparent #DB2777}
  .vids figcaption{padding-top:4px}
  .vidTitle{display:block;font-size:9.5pt;font-weight:600;color:#0F172A;line-height:1.35}
  .vidSrc{display:block;font-size:8.5pt;color:#6A7280;margin-top:2px}
  .vidUrl{display:block;font-size:8pt;color:#0070E0;margin-top:1px;word-break:break-all}

  .ref{display:flex;gap:9px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #EEF2F7;
       page-break-inside:avoid;break-inside:avoid}
  .ref:last-child{border-bottom:0}
  .thumb{width:74px;height:44px;flex:none;object-fit:cover;border-radius:6px;border:1px solid #E4EDF8;background:#F2F5FA}
  .thumb.ph{display:inline-block}
  .refText{min-width:0}
  .refTitle{font-weight:600;font-size:10.5pt;color:#0F172A}
  .refSnip{color:#3D4757;margin-top:2px}
  .refMeta{color:#6A7280;font-size:9pt;margin-top:2px}
  .refUrl{color:#0070E0;font-size:8.5pt;margin-top:2px;word-break:break-all}

  .rwItem,.dqItem{display:flex;gap:8px;align-items:flex-start;background:#FBFCFE;border:1px solid #E9EFF7;
                  border-radius:8px;padding:8px 10px;margin-bottom:6px;
                  break-inside:avoid;page-break-inside:avoid}
  .rwItem:last-child,.dqItem:last-child{margin-bottom:0}
  .rwNum{flex:none;width:17px;height:17px;line-height:17px;text-align:center;border-radius:50%;
         background:#EFFBFD;color:#0891B2;font-size:8.5pt;font-weight:700;margin-top:2px}
  .rwEg{font-weight:600}
  .rwWhy{color:#3D4757;margin-top:2px}
  .dqItem{background:#FFFDF7;border-color:#F3E4C0}
  .dqNum{flex:none;color:#A16207;font-weight:700;font-size:9pt;margin-top:2px}
  .dqQ{font-weight:600}
  .dqP{color:#6A7280;margin-top:2px}

  .doc{display:flex;gap:9px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #EEF2F7;
       break-inside:avoid;page-break-inside:avoid}
  .doc:last-child{border-bottom:0}
  .docBadge{flex:none;width:34px;height:40px;display:inline-flex;align-items:center;justify-content:center;
            border-radius:6px;background:#F1FBF5;border:1px solid #CDEBD9;color:#15803D;
            font-size:8pt;font-weight:700;letter-spacing:.03em}
  .docText{min-width:0}
  .docTitle{font-weight:600;font-size:10.5pt;color:#0F172A}
  .docSnip{color:#3D4757;margin-top:2px}
  .docMeta{color:#6A7280;font-size:9pt;margin-top:2px}
  .docUrl{color:#0070E0;font-size:8.5pt;margin-top:2px;word-break:break-all}

  .muted{color:#6A7280}
  .note{background:#F1F7FF;border:1px solid #DDE7F4;border-radius:7px;padding:6px 9px;
        color:#3D4757;font-size:9.5pt;margin-bottom:8px}

  .foot{margin-top:14px;padding-top:8px;border-top:1px solid #E4EDF8;
        color:#9AA3B0;font-size:8.5pt;display:flex;justify-content:space-between}
</style></head><body>
  <div class="banner">
    <div class="eyebrow">Session Plan${s.sessionNo ? ' &middot; Session ' + esc(s.sessionNo) : ''}</div>
    <h1>${esc(title)}</h1>
  </div>
  <div class="meta">
    ${chip('Chapter', chapter)}${chip('Class', grade)}${chip('Subject', subject)}
    ${chip('Duration', duration)}${chip('Stages', stages.length ? String(stages.length) : '')}
    ${chip('Resources', s.resourceCount != null ? String(s.resourceCount) : '')}
  </div>
  ${body}
  <div class="foot"><span>EduAI — Session Plan</span><span>${esc(chapter)}</span></div>
</body></html>`;
}
