// Session Launch — opens the session player in its own window. The popup is opened
// synchronously (so it isn't blocked) and written into directly; assets are inline data
// URIs, so nothing is fetched from the preview host (raw paths need an auth token).
//
// Ported verbatim from Rapid's sessionLaunch.js (the window is a standalone document and keeps Rapid's
// styling). Two changes: the types, and the Bookmark button is GONE — EduAI has no bookmarks, so the
// header no longer carries it and the window no longer talks back to the opener.
import type { LaunchContent } from '@/types/lessonPlan'

/** One asset as the window plays it. `source` tells it to wait for pushed content (test / question /
 *  activity) instead of playing `url` as a file. */
export interface LaunchFile {
  name: string
  label: string
  kind: string
  url: string
  meta: string
  resourceType: string
  source: 'resource' | 'test' | 'question' | 'activity'
}
export interface LaunchStage { stage: string; desc: string; setting: string; files: LaunchFile[] }
export interface LaunchPayload {
  name: string
  stages: LaunchStage[]
  totalAssets: number
  totalMins: number
  logoSrc: string
  startIndex?: number
}
/** The popup, with the hook its inline script defines for content the opener reads on its behalf. */
export type LaunchWindow = Window & {
  __pushContent?: (index: number, data: LaunchContent) => void
  __session?: { name: string; stages: LaunchStage[] }
}

const FONT = "Poppins,system-ui,-apple-system,sans-serif";

function esc(s: unknown) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shellCss() {
  return '*{box-sizing:border-box}html,body{margin:0;height:100%}'
    + 'body{font-family:' + FONT + ';background:#F5F7FA;color:#1A1E26;display:flex;flex-direction:column}'
    + '.hd{height:60px;flex:none;display:flex;align-items:center;gap:14px;padding:0 18px;background:#fff;border-bottom:1px solid #E4E9F0;box-shadow:0 1px 3px rgba(16,42,84,.06)}'
    + '.tile{width:34px;height:34px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:10px;background:#EAF3FE;color:#0070E0}'
    + '.ttl{font-size:15px;font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.sub{font-size:11.5px;color:#5A6675;margin-top:1px}'
    + '.pill{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;background:#EAF3FE;color:#0070E0;font-size:12.5px;font-weight:600}'
    + '.btn{height:34px;padding:0 14px;display:inline-flex;align-items:center;gap:7px;border:1px solid #E4E9F0;border-radius:9px;background:#fff;color:#4A5568;font-size:12.5px;font-weight:500;font-family:inherit;cursor:pointer;transition:border-color .14s,color .14s,background .14s}'
    + '.btn:hover{border-color:#0070E0;color:#0070E0}'
    + '.main{flex:1;min-height:0;display:flex}'
    + '.rail{width:208px;flex:none;background:#fff;border-right:1px solid #E4E9F0;padding:14px 12px;display:flex;flex-direction:column;gap:4px}'
    + '.rlbl{font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#8A93A2;padding:2px 8px 8px}'
    + '.ritem{display:flex;align-items:center;gap:10px;height:40px;padding:0 10px;border:none;border-radius:10px;background:transparent;color:#3D4757;font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;text-align:left;width:100%;transition:background .14s,color .14s}'
    + '.ritem:hover{background:#F5F8FC}'
    + '.ritem.on{background:#EAF3FE;color:#0070E0;font-weight:600}'
    + '.ritem .ic{width:26px;height:26px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:8px;background:#F1F4F8;color:#5A6675}'
    + '.ritem.on .ic{background:#fff;color:#0070E0}'
    + '.ritem .cnt{margin-left:auto;font-size:11px;font-weight:600;border-radius:999px;padding:1px 7px;background:#EDF1F6;color:#5A6675}'
    + '.ritem.on .cnt{background:#fff;color:#0070E0}'
    + '.body{flex:1;min-width:0;overflow:auto;padding:20px 22px}'
    + '.ft{height:66px;flex:none;display:flex;align-items:center;gap:12px;padding:0 18px;background:#fff;border-top:1px solid #E4E9F0;box-shadow:0 -2px 10px -6px rgba(16,42,84,.18)}'
    + '.nav{height:44px;min-width:132px;padding:0 20px;display:inline-flex;align-items:center;justify-content:center;gap:10px;border:1px solid #D5DBE4;border-radius:999px;background:#fff;color:#3D4757;font-size:13.5px;font-weight:600;font-family:inherit;cursor:pointer;transition:border-color .16s,color .16s,transform .16s,box-shadow .16s,background .16s}'
    + '.nav:hover:not(:disabled){border-color:#0070E0;color:#0070E0;transform:translateY(-2px);box-shadow:0 8px 18px -10px rgba(0,112,224,.5)}'
    + '.nav:active:not(:disabled){transform:translateY(0)}'
    + '.nav .cir{width:26px;height:26px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#F1F4F8;color:#5A6675;transition:background .16s,color .16s}'
    + '.nav:focus-visible{outline:3px solid rgba(0,112,224,.35);outline-offset:2px}'
    + '.nav:hover:not(:disabled) .cir{background:#EAF3FE;color:#0070E0}'
    + '.nav .lbl{display:flex;flex-direction:column;line-height:1.15;text-align:left}'
    + '.nav .lbl small{font-size:10px;font-weight:500;color:#8A93A2;letter-spacing:.03em}'
    + '.pri:hover:not(:disabled){background:#005BB8;color:#fff;border-color:transparent;box-shadow:0 10px 22px -8px rgba(0,112,224,.6)}'
    + '.pri .cir{background:rgba(255,255,255,.2);color:#fff}'
    + '.pri:hover:not(:disabled) .cir{background:rgba(255,255,255,.28);color:#fff}'
    + '.pri .lbl small{color:rgba(255,255,255,.75)}'
    + '.dots{display:flex;align-items:center;gap:5px}'
    + '.dot{width:8px;height:8px;border-radius:50%;background:#DCE3EC;border:none;padding:0;cursor:pointer;transition:width .2s,background .2s}'
    + '.dot:hover{background:#A9BBD1}'
    + '.dot.cur{width:20px;background:#0070E0}'
    + '.nav{height:38px;padding:0 16px;display:inline-flex;align-items:center;gap:8px;border:1px solid #D5DBE4;border-radius:9px;background:#fff;color:#3D4757;font-size:13px;font-weight:500;font-family:inherit;cursor:pointer}'
    + '.nav:hover:not(:disabled){border-color:#0070E0;color:#0070E0}'
    + '.nav:disabled{opacity:.4;cursor:not-allowed}'
    + '.pri{border:none;background:#0070E0;color:#fff;box-shadow:0 4px 12px -4px rgba(0,112,224,.5)}'
    + '.viewer{background:#fff;border:1px solid #E4E9F0;border-radius:14px;box-shadow:0 4px 16px -8px rgba(16,42,84,.12);overflow:hidden;display:flex;flex-direction:column;min-height:420px}'
    + '.vh{padding:12px 16px;border-bottom:1px solid #F0F2F6;display:flex;align-items:center;gap:11px;background:linear-gradient(180deg,#F4F9FF,#fff)}'
    + '.vstage{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:14px;padding:30px;background:#FBFCFD}'
    + '.vart{width:220px;height:132px;border-radius:14px;border:1px solid #E7EBF1;box-shadow:0 8px 22px -12px rgba(16,42,84,.28);object-fit:cover;background:#fff}'
    + '.vname{font-size:15px;font-weight:600;text-align:center;max-width:520px}'
    + '.vmeta{font-size:12px;color:#5A6675}'
    + '.mini{position:relative;overflow:hidden;background:#EEF1F6;font-family:inherit}'
    + '.mini .sheet{position:absolute;left:18%;right:18%;top:8%;bottom:-6%;background:#fff;border:1px solid #DDE3EC;border-radius:3px;box-shadow:0 6px 14px -6px rgba(16,42,84,.35);padding:6% 6% 0;overflow:hidden;box-sizing:border-box}'
    + '.mini .mt{font-weight:700;color:#1A2740;line-height:1.25;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}'
    + '.mini .mm{color:#8A93A2;margin-top:2%}'
    + '.mini .ln{height:2px;border-radius:1px;background:#E1E7EF;margin-top:4%}'
    + '.mini .slide{position:absolute;left:11%;right:11%;top:14%;bottom:14%;background:#fff;border:1px solid #D6CFEC;border-radius:3px;box-shadow:0 6px 14px -7px rgba(46,26,92,.4);padding:5%;box-sizing:border-box}'
    + '.mini.sl{background:linear-gradient(160deg,#F1EEFA,#E6E2F5)}'
    + '.mini.vd{background:radial-gradient(120% 90% at 72% 18%,rgba(120,160,220,.42),transparent 62%),linear-gradient(160deg,#1B2536,#0C121C)}'
    + '.mini .play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:50%;background:rgba(255,255,255,.92);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px -3px rgba(0,0,0,.55)}'
    + '.mini.ts{background:linear-gradient(160deg,#EFF3F0,#E2EAE4)}.mini.qs{background:linear-gradient(160deg,#F2F0FB,#E7E4F4)}'
    + '.strip{display:flex;gap:9px;overflow-x:auto;padding:12px 16px;border-top:1px solid #F0F2F6;background:#fff}'
    + '.th{flex:none;width:112px;border:1.5px solid #E7EBF1;border-radius:11px;background:#fff;padding:0;cursor:pointer;overflow:hidden;font-family:inherit;text-align:left;transition:border-color .14s,transform .14s}'
    + '.th:hover{transform:translateY(-2px)}.th.cur{border-color:#0070E0;box-shadow:0 6px 16px -8px rgba(0,112,224,.45)}'
    + '.th img{display:block;width:100%;height:58px;object-fit:cover}'
    + '.th span{display:block;padding:6px 8px;font-size:10.5px;line-height:1.3;color:#3D4757;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-top:1px solid #F2F4F8}'
    + '.pos{margin:0 auto;display:flex;align-items:center;gap:10px;font-size:12.5px;font-weight:500;color:#5A6675}'
    + '.card{background:#fff;border:1px solid #E4E9F0;border-radius:14px;box-shadow:0 4px 16px -8px rgba(16,42,84,.12);overflow:hidden;margin-bottom:14px}'
    + '.ch{padding:12px 16px;border-bottom:1px solid #F0F2F6;background:linear-gradient(180deg,#F4F9FF,#fff);display:flex;align-items:center;gap:10px}'
    + '.ct{font-size:13.5px;font-weight:600}'
    + '.chip{font-size:11px;color:#5A6675;border:1px solid #E4E9F0;border-radius:999px;padding:2px 9px}'
    + '.cnp{margin-left:auto;font-size:11px;font-weight:600;color:#fff;background:#0070E0;border-radius:999px;padding:2px 9px}'
    + '.cb{padding:14px 16px;font-size:13px;line-height:1.6;color:#3D4757}'
    + '.rows{display:flex;flex-direction:column}'
    + '.row{display:flex;align-items:center;gap:12px;padding:11px 16px;border-top:1px solid #F2F4F8;cursor:pointer}'
    + '.row:hover{background:#FBFDFF}.row.cur{background:#F4F9FF;box-shadow:inset 3px 0 0 #0070E0}'
    + '.rt{width:34px;height:34px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:9px;background:#EAF3FE;color:#0070E0;font-size:10px;font-weight:600}'
    + '.rn{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.rm{font-size:11.5px;color:#5A6675;margin-top:1px}'
    + '.empty{padding:40px 0;text-align:center;font-size:13px;color:#8A93A2}'
    + '.vimg{max-width:100%;max-height:220px;border-radius:10px;border:1px solid #E4E9F0;background:#F4F6FA;display:block;margin:0 auto}'
    + '.obtn{margin-top:12px;height:36px;padding:0 16px;display:inline-flex;align-items:center;gap:7px;border:none;border-radius:9px;'
    + 'background:#0070E0;color:#fff;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;box-shadow:0 4px 12px -4px rgba(0,112,224,.55)}'
    + '.obtn:hover{background:#005BB8}'
    + '.logo{height:26px;width:auto;display:block}'
    + '.brand{font-size:15px;font-weight:700;letter-spacing:-.01em;color:#1A1E26}'
    + '.sep{width:1px;height:26px;background:#E4E9F0;flex:none}'
    // ── The playing stage ──────────────────────────────────────────────────────────────────────
    // The stage used to hold a 220x132 illustration. Real content needs the width, so the media
    // elements below take the stage and the caption sits under them.
    + '.vwrap{width:100%;max-width:960px;display:flex;flex-direction:column;align-items:center;gap:12px}'
    + '.vvid{width:100%;max-height:60vh;border-radius:12px;background:#000;display:block}'
    + '.vaud{width:100%;display:block}'
    + '.vpic{max-width:100%;max-height:60vh;object-fit:contain;border-radius:12px;display:block}'
    + '.vfr{width:100%;height:62vh;border:1px solid #E7EBF1;border-radius:12px;background:#fff;display:block}'
    + '.vcard{width:100%;display:flex;flex-direction:column;align-items:center;gap:11px;text-align:center;'
    + 'border:1.5px dashed #CBD6E6;border-radius:14px;padding:40px 24px;background:#F7FAFD}'
    + '.vcard .ci{width:56px;height:56px;border-radius:15px;background:#fff;border:1px solid #E4E9F0;color:#0070E0;display:flex;align-items:center;justify-content:center}'
    + '.vcard .ct2{font-size:15px;font-weight:600;color:#1A2740}'
    + '.vcard .cd{font-size:12.5px;color:#6A7280;max-width:380px;line-height:1.55}'
    + '.spin{width:32px;height:32px;border-radius:50%;border:3px solid #E7ECF3;border-top-color:#0070E0;animation:sp .8s linear infinite}'
    + '.mhold{width:100%;display:flex;align-items:center;justify-content:center;min-height:200px}'
    + '@keyframes sp{to{transform:rotate(360deg)}}'
    + '.err{font-size:13px;color:#C13D2B;text-align:center;padding:26px 10px}'
    // ── A test paper, drawn from every question the test really contains ───────────────────────
    + '.paper{width:100%;display:flex;flex-direction:column;gap:12px;text-align:left}'
    + '.ptop{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;width:100%}'
    + '.ptt{font-size:19px;font-weight:700;color:#111827}'
    + '.ptm{font-size:12.5px;color:#5A6675}'
    + '.pq{border:1px solid #EEF1F5;border-radius:12px;padding:13px 15px;background:#fff}'
    + '.pqh{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;margin-bottom:7px}'
    + '.pqn{font-size:12.5px;font-weight:700;color:#0070E0}'
    + '.pqt{font-size:10.5px;font-weight:600;color:#5d6675;background:#EEF1F6;border-radius:999px;padding:2px 9px}'
    + '.pqs{font-size:10.5px;color:#8A93A2}'
    + '.pqm{margin-left:auto;font-size:11px;color:#8A93A2;white-space:nowrap}'
    + '.pqb{font-size:13.5px;line-height:1.65;color:#1A2740}'
    + '.pqb img{max-width:100%;height:auto}'
    + '.pqo{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-top:10px}'
    + '.po{display:flex;gap:8px;font-size:12.5px;line-height:1.5;color:#37424F;border:1px solid #EEF1F5;border-radius:9px;padding:7px 10px;background:#FCFDFE}'
    + '.po b{flex:none;color:#8A93A2;font-weight:600}'
    + '.pqu{margin:9px 0 0;padding-left:18px;font-size:12.5px;line-height:1.6;color:#37424F}'
    + '.qbody{width:100%;text-align:left;font-size:14.5px;line-height:1.7;color:#1A2740}'
    + '.qbody img{max-width:100%;height:auto}'
    // ── The rest of a question: the match table, the assertion pair, the answer key ─────────────────
    // Only MCQ options and a bulleted statement list had styling, because only those two ever reached
    // this window. Every question type draws now, so each shape gets its own rule.
    //
    // .po.ok / .pqa / .pans / .phint are the ANSWER KEY and are only emitted when the window is asked
    // for them (KEY in the payload — see wireQuestion in SessionResources.jsx). QA 463 asks for the
    // options, not the answers, and this window gets projected to a class.
    + '.po.ok{border-color:#BBE7CD;background:#F2FBF5}'
    + '.po i.pqa{margin-left:auto;font-style:normal;font-size:11px;font-weight:600;color:#15803D}'
    + '.pmt{width:100%;border-collapse:collapse;margin-top:10px;font-size:12.5px}'
    + '.pmt th{text-align:left;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#8A93A2;padding:4px 10px;border-bottom:1px solid #EEF1F5}'
    + '.pmt td{padding:7px 10px;border-bottom:1px solid #F4F6FA;vertical-align:top;color:#37424F;line-height:1.5}'
    + '.pmt td b{color:#8A93A2;font-weight:600;margin-right:4px}'
    + '.pmt img,.par img{max-width:100%;height:auto}'
    + '.par{margin-top:10px;display:flex;flex-direction:column;gap:6px;font-size:13px;line-height:1.6;color:#1A2740;border-left:3px solid #E4E9F0;padding-left:11px}'
    + '.pqi{font-size:12px;line-height:1.55;color:#5A6675;background:#F7F9FC;border-radius:8px;padding:8px 10px;margin-bottom:8px}'
    + '.pans{margin-top:9px;font-size:12.5px;font-weight:600;color:#15803D}'
    + '.phint{margin-top:5px;font-size:12px;color:#8A93A2}'
    // An offline activity: its brief (plain text out of a textarea) and its attachment rows. NOT .row —
    // .row is the asset-carousel row and __render wires a click handler onto every one of them.
    + '.adesc{font-size:13px;line-height:1.65;color:#3D4757;white-space:pre-wrap}'
    + '.arow{display:flex;align-items:center;gap:12px;padding:11px 16px;border-top:1px solid #F2F4F8}';
}

export function openSessionWindow({ name, stages, totalAssets, totalMins, logoSrc, startIndex }: LaunchPayload): LaunchWindow | null {
  const w = window.open('', 'session_launch', 'popup=yes,width=1280,height=900,scrollbars=yes,resizable=yes') as LaunchWindow | null;
  if (!w) return null;
  // 'session_launch' is a NAMED window: launching a second time reuses the same one. Clear the previous
  // document's push handler before rewriting, so the opener cannot deliver content into a closure that
  // belongs to the document we are about to replace — it waits for the new one to define its own.
  try { w.__pushContent = undefined; } catch { /* cross-document access can throw while it navigates */ }
  const head = '<!DOCTYPE html><html><head><meta charset="utf-8" /><title>' + esc(name || 'Session')
    + '</title><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet" />'
    + '<style>' + shellCss() + '</style></head><body>';
  const hd = '<div class="hd">'
    + '<img class="logo" src="' + esc(logoSrc || '') + '" alt="" onerror="this.style.display=\'none\'" />'
    + '<span class="brand">EduAI</span>'
    + '<span class="sep"></span>'
    + '<span class="tile"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5"/></svg></span>'
    + '<div style="flex:1;min-width:0"><div class="ttl">' + esc(name || 'Untitled session') + '</div>'
    + '<div class="sub">' + esc(totalMins || 0) + ' min session</div></div>'
    + '<span class="pill">' + esc(totalAssets || 0) + ' resources</span>'
    + '<button class="btn" type="button" onclick="window.close()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>Close</button>'
    + '</div>';
  const railIc = {
    lesson: '<path d="M4 5h7v15H4zM13 5h7v15h-7z"/><path d="M11 5v15M13 5v15"/>',
    assets: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 14l5-4 4 3 3-2 6 4"/>',
    teach: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/>',
  };
  const railItem = (id: keyof typeof railIc, label: string, count: number | null, on: boolean) => '<button class="ritem' + (on ? ' on' : '') + '" type="button" data-tab="' + id + '">'
    + '<span class="ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + railIc[id] + '</svg></span>'
    + label + (count == null ? '' : '<span class="cnt">' + count + '</span>') + '</button>';
  const rail = '<div class="rail"><div class="rlbl">Session</div>'
    + railItem('lesson', 'Lesson plan', null, false)
    + railItem('assets', 'View assets', totalAssets || 0, true)
    + railItem('teach', 'Teaching resources', (stages || []).length, false)
    + '</div>';
  const main = '<div class="main">' + rail + '<div class="body" id="pane"></div></div>';
  const arrow = (d: 'l' | 'r') => '<span class="cir"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="' + (d === 'l' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7') + '"/></svg></span>';
  const ft = '<div class="ft">'
    + '<button class="nav" id="pv" type="button" title="Previous asset (\u2190)" aria-label="Previous asset">' + arrow('l') + 'Previous</button>'
    + '<span class="pos"><span id="pos"></span><span class="dots" id="dots"></span></span>'
    + '<button class="nav pri" id="nx" type="button" title="Next asset (\u2192)" aria-label="Next asset">Next' + arrow('r') + '</button></div>';
  const data = JSON.stringify({ name: name || '', stages: stages || [], startIndex: startIndex || 0 }).replace(/</g, '\\u003c');
  const boot = '<script>(function(){var D=' + data + ';'
    + 'var flat=[];D.stages.forEach(function(s){(s.files||[]).forEach(function(f){flat.push({stage:s.stage,name:f.name,label:f.label,kind:f.kind||"",art:f.art||"",url:f.url||"",meta:f.meta||"",'
    + 'resourceType:f.resourceType||"",source:f.source||"resource",content:null});});});'
    + 'var mObj=null,mTok=0;'
    + 'var tab="assets",cur=Math.max(0,D.startIndex||0),pane=document.getElementById("pane"),pos=document.getElementById("pos"),pv=document.getElementById("pv"),nx=document.getElementById("nx");'
    + 'function E(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}'
    + 'function card(h,b){return "<div class=\'card\'>"+h+b+"</div>";}'
    + 'function mini(f,w,h){var k=f.kind||"reference",fs=Math.max(3,Math.round(w*0.046)),ms=Math.max(2.6,Math.round(w*0.034));'
    + 'var st="width:"+w+"px;height:"+h+"px;";'
    + 'if(k==="video"){return "<div class=\'mini vd\' style=\'"+st+"\'><span class=\'play\' style=\'width:"+(w*0.22)+"px;height:"+(w*0.22)+"px\'><svg width=\'"+(w*0.1)+"\' height=\'"+(w*0.1)+"\' viewBox=\'0 0 24 24\' fill=\'#101828\'><path d=\'M8 5.5l11 6.5-11 6.5z\'/></svg></span><div style=\'position:absolute;left:6%;right:6%;bottom:7%;color:#fff;font-size:"+fs+"px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\'>"+E(f.name)+"</div></div>";}'
    + 'if(k==="slides"){var b="";for(var i=0;i<3;i++)b+="<div class=\'ln\' style=\'background:#E3DEF3;width:"+(88-i*14)+"%\'></div>";'
    + 'return "<div class=\'mini sl\' style=\'"+st+"\'><div class=\'slide\'><div class=\'mt\' style=\'font-size:"+fs+"px;color:#3B2A6B\'>"+E(f.name)+"</div>"+b+"</div></div>";}'
    + 'var accent=k==="test"?"#15803D":k==="question"?"#6D28D9":"#0070E0",cls=k==="test"?"mini ts":k==="question"?"mini qs":"mini";'
    + 'var l="";for(var j=0;j<6;j++)l+="<div class=\'ln\' style=\'width:"+(95-j*8)+"%\'></div>";'
    + 'return "<div class=\'"+cls+"\' style=\'"+st+"\'><div class=\'sheet\'><div class=\'mt\' style=\'font-size:"+fs+"px;color:"+accent+"\'>"+E(f.name)+"</div><div class=\'mm\' style=\'font-size:"+ms+"px\'>"+E(f.label)+"</div>"+l+"</div></div>";}'
    // ── PLAYING a resource ────────────────────────────────────────────────────────────────────────
    // The stage used to draw generated art for everything and only ever showed a real file when it was
    // an image with a matching extension, so no video, PDF, document, test or question ever played.
    // Every type now renders for real, in this window.
    //
    // Only http(s) is honoured. These URLs come out of the resource library and go straight into a src
    // attribute, so a javascript: value must never get through.
    + 'function safe(u){return /^https?:\\/\\//i.test(String(u||""))?String(u):"";}'
    // E() escapes text; an attribute also has to lose its quotes. safe() only proves a URL STARTS
    // http(s) — "https://x\' onerror=\'…" would still pass it — so every src/href goes through A().
    + 'function A(s){return E(s).replace(/"/g,"&quot;").replace(/\'/g,"&#39;");}'
    + 'function ext(u){var c=String(u||"").split(/[?#]/)[0],m=c.match(/\\.([a-z0-9]+)$/i);return m?m[1].toLowerCase():"";}'
    + 'var IMG=["png","jpg","jpeg","gif","webp","bmp","svg","avif"],VID=["mp4","webm","ogv","mov","m4v"],'
    + 'AUD=["mp3","wav","m4a","aac","oga","ogg"],MSV=["doc","docx","xls","xlsx","ppt","pptx","csv"],'
    + 'HARD=["odt","ods","odp","epub","rar","7z","swf","com","in"];'
    + 'function has(a,x){for(var i=0;i<a.length;i++)if(a[i]===x)return true;return false;}'
    // The file's real kind. The URL EXTENSION decides first: the stored ResourceType is often wrong —
    // an .xlsx routinely arrives saved as "Document" or even "PDF" — and framing a binary would make
    // the browser download it behind the teacher's back. ResourceType is the fallback for a link with
    // no extension at all.
    + 'function fkind(f){var e=ext(f.url),t=String(f.resourceType||"").trim().toLowerCase();'
    + 'if(e==="zip")return "package";'
    + 'if(e){if(e==="pdf")return "pdf";if(has(IMG,e))return "image";if(has(VID,e))return "video";'
    + 'if(has(AUD,e))return "audio";if(has(MSV,e))return "office";if(has(HARD,e))return "hard";}'
    + 'if(t==="audio")return "audio";'
    + 'if(t==="video"||t==="story and concept animation")return "video";'
    + 'if(t==="image")return "image";if(t==="pdf")return "pdf";'
    + 'if(t==="presentation"||t==="document"||t==="work book"||t==="workbook")return "office";'
    + 'return "frame";}'
    // NOT `card` — that name is already taken by the Lesson plan / Teaching resources card builder
    // further up. Redeclaring it silently replaced that one and those two tabs began rendering their
    // markup as escaped text.
    + 'function dlcard(icon,title,desc,href,label,dl){return "<div class=\'vcard\'><span class=\'ci\'>"+icon+"</span>"'
    + '+"<div class=\'ct2\'>"+E(title)+"</div><div class=\'cd\'>"+E(desc)+"</div>"'
    + '+(href?"<a class=\'obtn\' style=\'text-decoration:none\' href=\'"+A(href)+"\'"+(dl?" download":" target=\'_blank\' rel=\'noopener noreferrer\'")+">"+E(label)+"</a>":"")+"</div>";}'
    + 'var DOCIC="<svg width=\'26\' height=\'26\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'1.7\' stroke-linecap=\'round\' stroke-linejoin=\'round\'><path d=\'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\'/><path d=\'M14 2v6h6\'/></svg>";'
    // A test paper: every question the test holds, in order, with its options. `paper` is produced by
    // collectPaper() in the opener — the same normalisation the DOCX/PDF exporters use — so this window
    // shows exactly what the test contains and never re-interprets a question type.
    + 'var ROMAN=["i","ii","iii","iv","v","vi","vii","viii","ix","x"];'
    + 'function ROM(i){return ROMAN[i]||String(i+1);}'
    + 'function LTR(a){var m={A:0,B:1,C:2,D:3},v=m[String(a||"A").toUpperCase()];return v==null?0:v;}'
    // ONE question, whatever its type. The opener pushes every field collectPaper() normalises, so MCQ
    // options, True/False statements, Match-the-following pairs, Assertion-Reasoning halves and a short
    // answer all draw here. Used by BOTH the test paper and a single bank question, so the two can never
    // drift apart again (QA 463) — before this, a question arrived carrying only its stem.
    //
    // `key` reveals the ANSWERS (correct option tinted, True/False per statement, the Answer and Hint
    // lines). QA 463 asks for the options, not the key, and this window is projected to a class — so the
    // opener leaves it off. The fields still travel, so turning it on is a one-word change there.
    //
    // q.html and the option/pair/assertion bodies are question HTML already sanitised by richInline() in
    // the opener, so they go in raw; everything the window adds itself goes through E().
    + 'function qOne(q,arOpts,arInstr,key){'
    + 'var s="<div class=\'pq\'><div class=\'pqh\'><span class=\'pqn\'>Q"+q.n+"</span>"'
    + '+"<span class=\'pqt\'>"+E(q.type)+"</span>"+(q.section?"<span class=\'pqs\'>"+E(q.section)+"</span>":"")'
    + '+(q.marks?"<span class=\'pqm\'>"+q.marks+" mark"+(q.marks===1?"":"s")+"</span>":"")+"</div>";'
    + 'if(q.ar&&q.ar.length&&arInstr)s+="<div class=\'pqi\'>"+E(arInstr)+"</div>";'
    + 's+="<div class=\'pqb\'>"+(q.html||"")+"</div>";'
    + 'if(q.options&&q.options.length){s+="<div class=\'pqo\'>"+q.options.map(function(o,i){'
    + 'return "<div class=\'po"+(key&&o.correct?" ok":"")+"\'><b>"+String.fromCharCode(65+i)+".</b><span>"+(o.html||"")+"</span></div>";}).join("")+"</div>";}'
    + 'if(q.statements&&q.statements.length){s+="<div class=\'pqo\'>"+q.statements.map(function(t,i){'
    + 'return "<div class=\'po\'><b>"+String.fromCharCode(97+i)+".</b><span>"+(t.html||"")+"</span>"+(key?"<i class=\'pqa\'>"+(t.answer?"True":"False")+"</i>":"")+"</div>";}).join("")+"</div>";}'
    + 'if(q.pairs&&q.pairs.length){s+="<table class=\'pmt\'><thead><tr><th>Column A</th><th>Column B</th></tr></thead><tbody>"'
    + '+q.pairs.map(function(p,i){return "<tr><td><b>"+(i+1)+".</b>"+(p.left||"")+"</td><td><b>("+ROM(i)+")</b>"+(p.right||"")+"</td></tr>";}).join("")'
    + '+"</tbody></table>";}'
    + 'if(q.ar&&q.ar.length){s+=q.ar.map(function(a){'
    + 'var o=(arOpts||[]).map(function(t,i){return "<div class=\'po"+(key&&LTR(a.answer)===i?" ok":"")+"\'><b>"+String.fromCharCode(65+i)+".</b><span>"+E(t)+"</span></div>";}).join("");'
    + 'return "<div class=\'par\'><div><b>Assertion (A):</b> "+(a.assertion||"")+"</div><div><b>Reason (R):</b> "+(a.reason||"")+"</div></div>"'
    + '+(o?"<div class=\'pqo\'>"+o+"</div>":"");}).join("");}'
    + 'if(key){if(q.blanks&&q.blanks.length)s+="<div class=\'pans\'>Answer: "+E(q.blanks.join(", "))+"</div>";'
    + 'else if(q.answer)s+="<div class=\'pans\'>Answer: "+E(q.answer)+"</div>";'
    + 'if(q.hint)s+="<div class=\'phint\'>Hint: "+E(q.hint)+"</div>";}'
    + 'return s+"</div>";}'
    // A test paper: every question the test holds, in order, each through qOne.
    + 'function paperHtml(c){var h="<div class=\'ptop\'><span class=\'ptt\'>"+E(c.title)+"</span><span class=\'ptm\'>"+E(c.meta||"")+"</span></div>";'
    + 'if(!c.paper||!c.paper.length)return h+"<div class=\'err\' style=\'color:#8A93A2\'>This test has no questions saved against it yet.</div>";'
    + 'h+=c.paper.map(function(q){return qOne(q,c.arOptions,c.arInstruction,c.key);}).join("");'
    + 'return "<div class=\'paper\'>"+h+"</div>";}'
    // An offline activity from the Assignment Repository (QA 470): the brief the teacher wrote and
    // whatever it has attached. Attachment rows are .arow, NOT .row — __render binds a click handler to
    // every .row in the pane and would read a missing data-i as asset 0.
    + 'function actHtml(c){var h="<div class=\'ptop\'><span class=\'ptt\'>"+E(c.title)+"</span><span class=\'ptm\'>"+E(c.meta||"")+"</span></div>";'
    + 'if(c.desc)h+="<div class=\'pq\'><div class=\'adesc\'>"+E(c.desc)+"</div></div>";'
    + 'if(c.files&&c.files.length){h+="<div class=\'pq\' style=\'padding:0\'><div class=\'pqh\' style=\'padding:12px 16px 0;margin:0\'><span class=\'pqn\'>Attachments</span></div>"'
    + '+c.files.map(function(r){var u=safe(r.url);'
    + 'return "<div class=\'arow\'><span class=\'rt\'>"+E(String(r.type||"FILE").slice(0,3).toUpperCase())+"</span>"'
    + '+"<div style=\'flex:1;min-width:0\'><div class=\'rn\'>"+E(r.title)+"</div><div class=\'rm\'>"+E(r.type||"")+"</div></div>"'
    + '+(u?"<a class=\'btn\' style=\'text-decoration:none\' href=\'"+A(u)+"\' target=\'_blank\' rel=\'noopener noreferrer\'>Open</a>":"")+"</div>";}).join("")+"</div>";}'
    + 'else if(!c.desc)h+="<div class=\'err\' style=\'color:#8A93A2\'>This activity has no brief or attachments saved against it yet.</div>";'
    + 'return "<div class=\'paper\'>"+h+"</div>";}'
    // The stage for one asset.
    + 'function preview(f){'
    // A Test / a Question is not a file: the opener reads it from the database and pushes it in.
    + 'if(f.source!=="resource"){var c=f.content;'
    + 'if(!c)return "<span class=\'spin\'></span><div class=\'vmeta\'>Loading "+E(f.source==="test"?"the test":f.source==="activity"?"the activity":"the question")+"\\u2026</div>";'
    + 'if(c.mode==="error")return "<div class=\'err\'>"+E(c.message)+"</div>";'
    + 'if(c.mode==="test")return paperHtml(c);'
    + 'if(c.mode==="activity")return actHtml(c);'
    // A question draws through the SAME builder a test question does. `c.q` is the normalised question;
    // the bare-stem branch below is the fallback for one the studio reader could not parse.
    + 'if(c.mode==="question"&&c.q)return "<div class=\'paper\'>"+qOne(c.q,c.arOptions,c.arInstruction,c.key)+"</div>";'
    + 'return "<div class=\'qbody\'>"+(c.html||E(c.title||f.name))+"</div>";}'
    + 'var u=safe(f.url);'
    + 'if(!u)return mini(f,220,132);'
    + 'var k=fkind(f);'
    // SEEK: these blobs are served without an `Accept-Ranges: bytes` header, so Chrome treats a direct
    // <video src=blobUrl> as NON-seekable — dragging the timeline snaps the playhead back. The file is
    // pulled into an in-memory object URL instead (CORS is open), which is always fully seekable, and
    // falls back to the direct URL if that fetch fails. Same approach as ContentPlayer.
    + 'if(k==="video")return "<div class=\'mhold\'><span class=\'spin\' id=\'msp\'></span><video class=\'vvid\' id=\'mel\' controls preload=\'auto\' playsinline style=\'display:none\' data-u=\'"+A(u)+"\'></video></div>";'
    + 'if(k==="audio")return "<div class=\'mhold\'><span class=\'spin\' id=\'msp\'></span><audio class=\'vaud\' id=\'mel\' controls preload=\'auto\' style=\'display:none\' data-u=\'"+A(u)+"\'></audio></div>";'
    + 'if(k==="image")return "<img class=\'vpic\' src=\'"+A(u)+"\' alt=\'\' />";'
    + 'if(k==="pdf")return "<iframe class=\'vfr\' src=\'"+A(u)+"#toolbar=0&navpanes=0&view=FitH\' title=\'\'></iframe>";'
    // Word / Excel / PowerPoint render through the Microsoft Office web viewer, which fetches the file
    // on its own servers — our documents container is public-read, so a saved resource works.
    + 'if(k==="office")return "<iframe class=\'vfr\' src=\'https://view.officeapps.live.com/op/embed.aspx?src="+encodeURIComponent(u)+"\' title=\'\'></iframe>";'
    + 'if(k==="package")return dlcard(DOCIC,f.name,"This is a content package (.zip). It can\'t be played in the browser \\u2014 download it and open it in a SCORM player.",u,"Download package",true);'
    + 'if(k==="hard")return dlcard(DOCIC,f.name,"This file type can\'t be previewed inline. Download it to view on your device.",u,"Download",true);'
    + 'return "<iframe class=\'vfr\' src=\'"+A(u)+"\' sandbox=\'allow-scripts allow-same-origin allow-forms allow-popups\' title=\'\'></iframe>";}'
    + 'function hdr(a,b,c){return "<div class=\'ch\'><span class=\'ct\'>"+E(a)+"</span>"+(b?"<span class=\'chip\'>"+E(b)+"</span>":"")+(c==null?"":"<span class=\'cnp\'>"+c+"</span>")+"</div>";}'
    + 'function rowsOf(s,off){return "<div class=\'rows\'>"+(s.files||[]).map(function(f,i){var gi=off+i;'
    + 'return "<div class=\'row\'"+(tab==="assets"&&gi===cur?" class=\'row cur\'":"")+" data-i=\'"+gi+"\'><span class=\'rt\'>"+E((f.label||"").slice(0,3).toUpperCase())+"</span>"'
    + '+"<div style=\'flex:1;min-width:0\'><div class=\'rn\'>"+E(f.name)+"</div><div class=\'rm\'>"+E(f.label)+"</div></div></div>";}).join("")+"</div>";}'
    + 'window.__render=function(nt){if(nt)tab=nt;var h="",off=0;'
    + 'if(!D.stages.length){pane.innerHTML="<div class=\'empty\'>Nothing to show yet.</div>";pos.textContent="";return;}'
    + 'if(tab==="lesson"){h=D.stages.map(function(s){return card(hdr(s.stage,s.setting,(s.files||[]).length),"<div class=\'cb\'>"+(s.desc||"<span style=\'color:#8A93A2\'>No description added.</span>")+"</div>");}).join("");pos.textContent=D.stages.length+" stages";}'
    + 'else if(tab==="assets"){if(!flat.length){h="<div class=\'empty\'>No assets added.</div>";}else{var c=flat[cur];'
    + 'h="<div class=\'viewer\'><div class=\'vh\'><span class=\'ct\'>"+E(c.stage)+"</span><span class=\'chip\'>"+E(c.label)+"</span><span class=\'cnp\'>"+(cur+1)+" / "+flat.length+"</span></div>"'
    + '+"<div class=\'vstage\'><div class=\'vwrap\'>"+preview(c)+"</div>"'
    + '+"<div class=\'vname\'>"+E(c.name)+"</div><div class=\'vmeta\'>"+E(c.label)+(c.meta?" \\u00b7 "+E(c.meta):"")+" \\u00b7 "+E(c.stage)+"</div>"'
    // The Open button is a convenience for FILES only, and the "nothing linked" line is now the truth
    // for exactly one case: a library row that really has no file behind it. A Test or a Question is
    // not a file, plays above, and must never claim to be missing one.
    + '+(c.source!=="resource"?"":safe(c.url)?"<button class=\'obtn\' type=\'button\' id=\'op\'><svg width=\'14\' height=\'14\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'><path d=\'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\'/><path d=\'M15 3h6v6\'/><path d=\'M10 14L21 3\'/></svg>Open resource</button>":"<div class=\'vmeta\' style=\'color:#8A93A2\'>No file is linked to this resource yet</div>")'
    + '+"</div>"'
    + '+"<div class=\'strip\'>"+flat.map(function(f,i){return "<button class=\'th"+(i===cur?" cur":"")+"\' type=\'button\' data-i=\'"+i+"\' title=\'"+E(f.name)+"\'>"+mini(f,112,66)+"<span>"+E(f.name)+"</span></button>";}).join("")+"</div></div>";}'
    + 'pos.textContent=flat.length?"Asset "+(cur+1)+" of "+flat.length+" \\u00b7 "+flat[cur].stage:"";}'
    + 'else{h=D.stages.map(function(s){return card(hdr(s.stage,"Teaching resources",(s.files||[]).length),(s.files||[]).length?rowsOf(s,0):"<div class=\'cb\' style=\'color:#8A93A2\'>No resources for this stage.</div>");}).join("");pos.textContent=flat.length+" resources";}'
    + 'pane.innerHTML=h;'
    // Wire up the media element the stage just drew. The token guards against a slow download landing
    // after the teacher has already moved to another asset, and the previous object URL is revoked so
    // stepping through a session of videos does not accumulate whole files in memory.
    + 'var mel=document.getElementById("mel");'
    + 'if(mel){var mu=mel.getAttribute("data-u")||"",tk=++mTok,sp=document.getElementById("msp");'
    + 'var show=function(){if(sp)sp.style.display="none";mel.style.display="block";};'
    + 'if(mObj){try{URL.revokeObjectURL(mObj);}catch(e){}mObj=null;}'
    + 'fetch(mu).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.blob();})'
    + '.then(function(b){if(tk!==mTok)return;mObj=URL.createObjectURL(b);mel.src=mObj;show();})'
    + '.catch(function(){if(tk!==mTok)return;mel.src=mu;show();});}'   // still plays, may not seek
    + 'var ob=document.getElementById("op");if(ob){ob.onclick=function(){var u=safe(flat[cur]&&flat[cur].url);if(u)window.open(u,"_blank","noopener,noreferrer");};}'
    + '[].slice.call(pane.querySelectorAll(".row,.th")).forEach(function(r){r.onclick=function(){cur=parseInt(r.getAttribute("data-i"),10)||0;window.__render("assets");'
    + 'var items=[].slice.call(document.querySelectorAll(".ritem"));items.forEach(function(o){o.className=o.getAttribute("data-tab")==="assets"?"ritem on":"ritem";});};});'
    + 'pv.disabled=(tab!=="assets"||cur<=0);nx.disabled=(tab!=="assets"||cur>=flat.length-1);'
    + 'var dots=document.getElementById("dots");'
    + 'if(tab==="assets"&&flat.length&&flat.length<=14){dots.innerHTML=flat.map(function(f,i){return "<button class=\'dot"+(i===cur?" cur":"")+"\' type=\'button\' data-d=\'"+i+"\' title=\'"+E(f.name)+"\'></button>";}).join("");'
    + '[].slice.call(dots.querySelectorAll(".dot")).forEach(function(d){d.onclick=function(){cur=parseInt(d.getAttribute("data-d"),10)||0;window.__render();};});}else{dots.innerHTML="";}'
    // Previous/Next step through the ASSET carousel and mean nothing anywhere else, but the footer
    // was rendered once and left on screen for every tab. On "Lesson plan" that put a Next button
    // under a list of stages it could not move, and on a session with no resources it offered to
    // advance through an empty deck. Shown only where there is genuinely a next asset to reach:
    // the assets tab, holding more than one. Prev goes with it — a lone Previous under the lesson
    // plan is the same dangling control, just facing the other way.
    + 'var navOn=(tab==="assets"&&flat.length>1);'
    + 'pv.style.display=navOn?"":"none";nx.style.display=navOn?"":"none";'
    + 'var ftEl=document.querySelector(".ft");if(ftEl)ftEl.style.justifyContent=navOn?"":"center";'
    + '};'
    + 'pv.onclick=function(){if(cur>0){cur--;window.__render();}};nx.onclick=function(){if(cur<flat.length-1){cur++;window.__render();}};'
    + 'document.addEventListener("keydown",function(e){if(tab!=="assets")return;if(e.key==="ArrowLeft"&&cur>0){cur--;window.__render();}else if(e.key==="ArrowRight"&&cur<flat.length-1){cur++;window.__render();}});'
    + 'var items=[].slice.call(document.querySelectorAll(".ritem"));'
    + 'items.forEach(function(it){it.onclick=function(){items.forEach(function(o){o.className="ritem"});it.className="ritem on";window.__render(it.getAttribute("data-tab"));};});'
    // The opener reads a Test / a Question out of the database (it holds the bearer token and the
    // payload encryption; this window holds neither) and pushes the result in here. The stage is
    // repainted only when the asset that arrived is the one on screen, so content landing for asset 7
    // never interrupts the teacher watching asset 2.
    + 'window.__pushContent=function(i,data){if(!flat[i]){if(window.console)console.error("[session] content arrived for unknown asset "+i);return;}'
    + 'flat[i].content=data;if(tab==="assets"&&i===cur)window.__render();};'
    + 'window.__render("assets");})();</script>';
  w.document.open();
  w.document.write(head + hd + main + ft + boot + '</body></html>');
  w.document.close();
  w.focus();
  w.__session = { name: name, stages: stages || [] };
  // The WINDOW is returned (it was `true`) so the opener can push in the Test / Question content it
  // has to fetch on the window's behalf. Callers that only cared whether it opened still get a truthy
  // value. document.write + close ran synchronously above, so __pushContent already exists on it.
  return w;
}
