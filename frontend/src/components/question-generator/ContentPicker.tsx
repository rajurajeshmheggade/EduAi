import { useEffect, useState } from 'react'
import { BookOpenText, Eye, EyeOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label, Select } from '@/components/ui/field'
import { ErrorState, Skeleton, Spinner } from '@/components/ui/loading'
import { errorMessage } from '@/services/apiClient'
import { useAsync } from '@/lib/useAsync'
import { questionGenService, type ChapterList } from '@/services/questionGenService'
import type { ContentPreview, SegmentView, TeacherClass, TopicView } from '@/types/questionGen'

/* Class → Subject → Chapter → Topic → NLP learning content. Classes and subjects are the teacher's own (their
   class_subjects), each mapped onto the NLP content repository; chapters, topics and learning content come from
   the repository. Every level is fetched when the level above is chosen and is reset when it changes; a level
   with exactly one option is chosen automatically. */

export interface ContentSelection {
  class_code: string
  class_name: string
  subject_code: string
  subject_name: string
  nlp_class: string
  nlp_subject: string
  chapter: string
  topic: TopicView
  /** Empty = all learning content of the topic. */
  segment_ids: string[]
  segments: SegmentView[]
}

type Load<T> = { data?: T; loading: boolean; error?: string }
const idle = <T,>(): Load<T> => ({ loading: false })

const SOURCE_LABEL: Record<string, string> = {
  headings: 'Topics from the chapter’s headings',
  syllabus: 'Topics from your school syllabus',
  segments: 'Sections of the chapter text',
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function ContentPicker({ locked, onChange, idPrefix = 'qg' }: {
  locked?: { class_code: string; subject_code: string }
  onChange: (sel: ContentSelection | null) => void
  idPrefix?: string
}) {
  const [classes, setClasses] = useState<Load<TeacherClass[]>>({ loading: true })
  const [classCode, setClassCode] = useState(locked?.class_code ?? '')
  const [subjectCode, setSubjectCode] = useState(locked?.subject_code ?? '')
  const [chapters, setChapters] = useState<Load<ChapterList>>(idle)
  const [chapter, setChapter] = useState('')
  const [topics, setTopics] = useState<Load<{ topic_source: string; topics: TopicView[] }>>(idle)
  const [topicId, setTopicId] = useState('')
  const [segments, setSegments] = useState<Load<SegmentView[]>>(idle)
  const [segmentId, setSegmentId] = useState('all')
  const [nonce, setNonce] = useState(0)

  // classes
  useEffect(() => {
    const ctl = new AbortController()
    setClasses({ loading: true })
    questionGenService.classes({ signal: ctl.signal }).then((data) => {
      setClasses({ data, loading: false })
      if (!locked && data.length === 1) setClassCode(data[0].class_code)
    }).catch((e) => { if (!ctl.signal.aborted) setClasses({ loading: false, error: errorMessage(e) }) })
    return () => ctl.abort()
  }, [locked, nonce])

  const klass = classes.data?.find((c) => c.class_code === classCode)
  const subject = klass?.subjects.find((s) => s.subject_code === subjectCode)
  const mapped = !!(subject?.nlp_class && subject.nlp_subject)

  // a class with one linked subject: choose it
  useEffect(() => {
    if (locked || !klass) return
    const linked = klass.subjects.filter((s) => s.nlp_subject)
    if (klass.subjects.length === 1 && linked.length === 1) setSubjectCode(linked[0].subject_code)
  }, [klass, locked])

  // chapters
  useEffect(() => {
    setChapter(''); setChapters(idle())
    if (!classCode || !subjectCode || !mapped) return
    const ctl = new AbortController()
    setChapters({ loading: true })
    questionGenService.chapters(classCode, subjectCode, { signal: ctl.signal }).then((data) => {
      setChapters({ data, loading: false })
      if (data.chapters.length === 1) setChapter(data.chapters[0])
    }).catch((e) => { if (!ctl.signal.aborted) setChapters({ loading: false, error: errorMessage(e) }) })
    return () => ctl.abort()
  }, [classCode, subjectCode, mapped, nonce])

  // topics
  useEffect(() => {
    setTopicId(''); setTopics(idle())
    if (!chapter) return
    const ctl = new AbortController()
    setTopics({ loading: true })
    questionGenService.topics(classCode, subjectCode, chapter, { signal: ctl.signal }).then((data) => {
      setTopics({ data, loading: false })
      if (data.topics.length === 1) setTopicId(data.topics[0].id)
    }).catch((e) => { if (!ctl.signal.aborted) setTopics({ loading: false, error: errorMessage(e) }) })
    return () => ctl.abort()
  }, [classCode, subjectCode, chapter, nonce])

  // learning content
  useEffect(() => {
    setSegmentId('all'); setSegments(idle())
    if (!topicId) return
    const ctl = new AbortController()
    setSegments({ loading: true })
    questionGenService.content(classCode, subjectCode, chapter, topicId, { signal: ctl.signal }).then((data) => {
      setSegments({ data: data.segments, loading: false })
    }).catch((e) => { if (!ctl.signal.aborted) setSegments({ loading: false, error: errorMessage(e) }) })
    return () => ctl.abort()
  }, [classCode, subjectCode, chapter, topicId, nonce])

  const topic = topics.data?.topics.find((t) => t.id === topicId)
  useEffect(() => {
    if (!klass || !subject || !mapped || !chapter || !topic || !segments.data) { onChange(null); return }
    onChange({
      class_code: klass.class_code, class_name: klass.class_name, subject_code: subject.subject_code, subject_name: subject.subject_name,
      nlp_class: subject.nlp_class!, nlp_subject: subject.nlp_subject!, chapter, topic,
      segment_ids: segmentId === 'all' ? [] : [segmentId], segments: segments.data,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klass, subject, mapped, chapter, topic, segments.data, segmentId])

  const retry = () => setNonce((n) => n + 1)
  const err = classes.error || chapters.error || topics.error || segments.error

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <Level id={`${idPrefix}-class`} label="Class" loading={classes.loading}>
          <Select id={`${idPrefix}-class`} value={classCode} disabled={!!locked || !classes.data?.length}
            onChange={(e) => { setClassCode(e.target.value); setSubjectCode('') }}>
            <option value="">{classes.loading ? 'Loading…' : classes.data?.length ? 'Select class' : 'No classes assigned'}</option>
            {classes.data?.map((c) => <option key={c.class_code} value={c.class_code}>{c.class_name}{c.nlp_class ? ` · Class ${c.nlp_class}` : ''}</option>)}
          </Select>
        </Level>
        <Level id={`${idPrefix}-subject`} label="Subject">
          <Select id={`${idPrefix}-subject`} value={subjectCode} disabled={!!locked || !klass}
            onChange={(e) => setSubjectCode(e.target.value)}>
            <option value="">{klass ? 'Select subject' : 'Select a class first'}</option>
            {klass?.subjects.map((s) => (
              <option key={s.subject_code} value={s.subject_code} disabled={!s.nlp_subject}>
                {s.subject_name}{s.nlp_subject ? (s.nlp_subject !== s.subject_name ? ` → ${s.nlp_subject}` : '') : ' (not linked to content)'}
              </option>
            ))}
          </Select>
        </Level>
        <Level id={`${idPrefix}-chapter`} label="Chapter" loading={chapters.loading}>
          <Select id={`${idPrefix}-chapter`} value={chapter} disabled={!chapters.data?.chapters.length} onChange={(e) => setChapter(e.target.value)}>
            <option value="">{chapters.loading ? 'Loading…' : !subjectCode ? 'Select a subject first' : chapters.data && !chapters.data.chapters.length ? 'No chapters' : 'Select chapter'}</option>
            {chapters.data && chapters.data.discipline && chapters.data.primary.length < chapters.data.chapters.length ? (
              <>
                <optgroup label={`${titleCase(chapters.data.discipline)} chapters`}>
                  {chapters.data.primary.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
                </optgroup>
                <optgroup label={`Other ${chapters.data.nlp_subject} chapters`}>
                  {chapters.data.chapters.filter((c) => !chapters.data!.primary.includes(c)).map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
                </optgroup>
              </>
            ) : chapters.data?.chapters.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
          </Select>
        </Level>
        <Level id={`${idPrefix}-topic`} label="Topic" loading={topics.loading}>
          <Select id={`${idPrefix}-topic`} value={topicId} disabled={!topics.data?.topics.length} onChange={(e) => setTopicId(e.target.value)}>
            <option value="">{topics.loading ? 'Loading…' : !chapter ? 'Select a chapter first' : 'Select topic'}</option>
            {topics.data?.topics.map((t) => <option key={t.id} value={t.id}>{t.number ? `${t.number} ` : ''}{t.title}</option>)}
          </Select>
        </Level>
        <Level id={`${idPrefix}-content`} label="NLP learning content" loading={segments.loading}>
          <Select id={`${idPrefix}-content`} value={segmentId} disabled={!segments.data?.length} onChange={(e) => setSegmentId(e.target.value)}>
            {!segments.data?.length && <option value="all">{segments.loading ? 'Loading…' : 'Select a topic first'}</option>}
            {!!segments.data?.length && <option value="all">All content of this topic ({segments.data.length} part{segments.data.length === 1 ? '' : 's'}, {topic?.word_count ?? 0} words)</option>}
            {segments.data?.map((s) => <option key={s.id} value={s.id}>{s.title} ({s.word_count} words)</option>)}
          </Select>
        </Level>
      </div>
      {subject && !subject.nlp_subject && (
        <p role="status" className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">{subject.note ?? 'This subject is not linked to the content repository yet — ask your admin to link it.'}</p>
      )}
      {err && <ErrorState title="Could not load the learning content" message={err} onRetry={retry} />}
      {topics.data && <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400"><BookOpenText className="h-3.5 w-3.5" /> {SOURCE_LABEL[topics.data.topic_source] ?? ''}</div>}
      {topic && segments.data && (
        <ContentPreviewPanel key={`${topicId}:${segmentId}`} classCode={classCode} subjectCode={subjectCode} chapter={chapter} topicId={topicId}
          segmentIds={segmentId === 'all' ? [] : [segmentId]} />
      )}
    </div>
  )
}

function Level({ id, label, loading, children }: { id: string; label: string; loading?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5"><Label htmlFor={id}>{label}</Label>{loading && <Spinner className="mb-1.5 h-3 w-3" label={`Loading ${label}`} />}</div>
      {children}
    </div>
  )
}

/** Preview of the exact learning content the questions will be generated from. */
export function ContentPreviewPanel({ classCode, subjectCode, chapter, topicId, segmentIds }: {
  classCode: string; subjectCode: string; chapter: string; topicId: string; segmentIds: string[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-line bg-ink-900/50">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="text-sm font-medium text-fg">Learning content preview</span>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <><EyeOff className="h-3.5 w-3.5" /> Hide</> : <><Eye className="h-3.5 w-3.5" /> Preview content</>}
        </Button>
      </div>
      {open && <PreviewBody classCode={classCode} subjectCode={subjectCode} chapter={chapter} topicId={topicId} segmentIds={segmentIds} />}
    </div>
  )
}

function PreviewBody({ classCode, subjectCode, chapter, topicId, segmentIds }: {
  classCode: string; subjectCode: string; chapter: string; topicId: string; segmentIds: string[]
}) {
  const ids = segmentIds.join(',')
  const state = useAsync((signal) => questionGenService.preview(classCode, subjectCode, chapter, topicId, ids ? ids.split(',') : [], { signal }),
    [classCode, subjectCode, chapter, topicId, ids])
  return (
    <div className="border-t border-line px-3 py-3">
      {state.loading && !state.data && <div className="space-y-2" aria-label="Loading preview"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24" /></div>}
      {state.error && <ErrorState message={state.error} onRetry={state.retry} />}
      {state.data && <PreviewText data={state.data} />}
    </div>
  )
}

function PreviewText({ data }: { data: ContentPreview }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs text-ink-400">
        <Badge tone="brand">Class {data.source.class} · {data.source.subject}</Badge>
        <Badge>{titleCase(data.source.chapter)}</Badge>
        <Badge>{data.word_count} words</Badge>
        <span className="font-mono">{data.source.file}</span>
      </div>
      <div className="max-h-80 space-y-3 overflow-y-auto pr-1 text-sm leading-relaxed text-ink-200">
        {data.segments.map((s) => (
          <section key={s.id}>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">{s.title}</h4>
            <p className="whitespace-pre-wrap">{s.text}</p>
          </section>
        ))}
        {data.truncated && <p className="text-xs text-ink-500">Preview shortened — generation uses the full selected content.</p>}
      </div>
      <p className="text-xs text-ink-500">This is the cleaned text the questions are generated from; it was extracted from the textbook with common words removed.</p>
    </div>
  )
}
