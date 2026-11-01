import { useEffect, useState } from 'react'
import { Label, Select } from '@/components/ui/field'
import { nlpCatalogService, type NlpClass } from '@/services/nlpCatalogService'

export interface NlpSelection { classLabel: string; subject: string; chapter: string }

/** Class → Subject → Chapter cascading picker over the chapter-library (backend/nlp/) — NOT the Digital
 * Library's board/DIKSHA catalogue. Always defaults to the first available option at every level (#16: the
 * next level is only populated once the one before it is chosen) and resets a level's selection whenever
 * the level above it changes. Calls `onChange` with the full triple once all three are resolved. */
export function NlpChapterPicker({ idPrefix = 'nlp', onChange }: { idPrefix?: string; onChange: (sel: NlpSelection | null) => void }) {
  const [classes, setClasses] = useState<NlpClass[] | null>(null)
  const [classLabel, setClassLabel] = useState('')
  const [subjects, setSubjects] = useState<string[] | null>(null)
  const [subject, setSubject] = useState('')
  const [chapters, setChapters] = useState<string[] | null>(null)
  const [chapter, setChapter] = useState('')

  useEffect(() => { nlpCatalogService.classes().then((c) => { setClasses(c); setClassLabel((v) => v || c[0]?.class_label || '') }).catch(() => setClasses([])) }, [])

  useEffect(() => {
    if (!classLabel) { setSubjects(null); return }
    setSubjects(null); setSubject(''); setChapters(null); setChapter('')
    nlpCatalogService.subjects(classLabel).then((s) => { setSubjects(s); setSubject(s[0] ?? '') }).catch(() => setSubjects([]))
  }, [classLabel])

  useEffect(() => {
    if (!classLabel || !subject) { setChapters(null); return }
    setChapters(null); setChapter('')
    nlpCatalogService.chapters(classLabel, subject).then((c) => { setChapters(c); setChapter(c[0] ?? '') }).catch(() => setChapters([]))
  }, [classLabel, subject])

  useEffect(() => {
    onChange(classLabel && subject && chapter ? { classLabel, subject, chapter } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classLabel, subject, chapter])

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div><Label htmlFor={`${idPrefix}-class`}>Class</Label>
        <Select id={`${idPrefix}-class`} value={classLabel} onChange={(e) => setClassLabel(e.target.value)} disabled={!classes?.length}>
          {!classes?.length && <option value="">{classes === null ? 'Loading…' : 'No chapter library found'}</option>}
          {classes?.map((c) => <option key={c.class_label} value={c.class_label}>{c.grade ? `Class ${c.grade}` : c.class_label}</option>)}
        </Select>
      </div>
      <div><Label htmlFor={`${idPrefix}-subject`}>Subject</Label>
        <Select id={`${idPrefix}-subject`} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!subjects?.length}>
          {!subjects?.length && <option value="">{subjects === null ? 'Select a class first' : 'No subjects'}</option>}
          {subjects?.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
      <div><Label htmlFor={`${idPrefix}-chapter`}>Chapter</Label>
        <Select id={`${idPrefix}-chapter`} value={chapter} onChange={(e) => setChapter(e.target.value)} disabled={!chapters?.length}>
          {!chapters?.length && <option value="">{chapters === null ? 'Select a subject first' : 'No chapters'}</option>}
          {chapters?.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
        </Select>
      </div>
    </div>
  )
}
