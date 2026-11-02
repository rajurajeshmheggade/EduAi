import { useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { Spinner } from '@/components/ui/loading'
import { toast } from '@/components/ui/toast'
import { errorMessage } from '@/services/apiClient'
import { questionGenService } from '@/services/questionGenService'
import { moveItem, newId } from '@/lib/questionGen/paper'
import type { Lang, MediaInfo, Paper, PaperHeader, QgenMeta, Section } from '@/types/questionGen'
import { Section as Card } from './shared'

/* Exam header (institution name / logo override, exam title, academic year, date, duration, general instructions,
   marks + roll-number toggles), language and sections. The institution name defaults to the school's own name. */

export function PaperSettings({ paper, meta, readOnly, onChange, onMedia }: {
  paper: Paper
  meta: QgenMeta
  readOnly: boolean
  onChange: (patch: Partial<Pick<Paper, 'header' | 'sections' | 'language' | 'title' | 'items'>>) => void
  onMedia: (id: string, info: MediaInfo) => void
}) {
  const h = paper.header
  const setH = (patch: Partial<PaperHeader>) => onChange({ header: { ...h, ...patch } })
  const logoInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [gi, setGi] = useState(h.general_instructions.join('\n'))

  const uploadLogo = async (file?: File) => {
    if (!file) return
    setUploading(true)
    try {
      const r = await questionGenService.upload(file)
      onMedia(r.media_id, { url: r.url, width: r.width, height: r.height })
      setH({ logo_media_id: r.media_id })
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setUploading(false)
      if (logoInput.current) logoInput.current.value = ''
    }
  }

  const setSections = (sections: Section[]) => {
    const ids = new Set(sections.map((s) => s.id))
    // questions of a removed section move to the first section
    const items = paper.items.map((it) => (ids.has(it.section_id) ? it : { ...it, section_id: sections[0].id }))
    onChange({ sections, items })
  }

  return (
    <fieldset disabled={readOnly} className="space-y-5">
      <Card title="Exam header" description="Printed at the top of the paper, the answer key and the Word / PDF files.">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="ph-title">Paper name (for your list)</Label>
            <Input id="ph-title" maxLength={300} value={paper.title} onChange={(e) => onChange({ title: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ph-inst">Institution name</Label>
            <Input id="ph-inst" maxLength={200} value={h.institution_name} placeholder={paper.institution_name} onChange={(e) => setH({ institution_name: e.target.value })} />
            <p className="mt-1 text-xs text-ink-500">Leave empty to use “{paper.institution_name}”.</p>
          </div>
          <div>
            <Label htmlFor="ph-exam">Exam title</Label>
            <Input id="ph-exam" maxLength={200} value={h.exam_title} placeholder="e.g. Half-Yearly Examination 2026-27" onChange={(e) => setH({ exam_title: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ph-year">Academic year</Label>
            <Input id="ph-year" maxLength={20} value={h.academic_year} onChange={(e) => setH({ academic_year: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ph-date">Exam date (optional)</Label>
            <Input id="ph-date" maxLength={40} value={h.exam_date} placeholder="e.g. 12 November 2026" onChange={(e) => setH({ exam_date: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ph-dur">Time allowed (minutes)</Label>
            <Input id="ph-dur" type="number" min={5} max={600} value={h.duration_minutes ?? ''} onChange={(e) => setH({ duration_minutes: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
          <div>
            <Label htmlFor="ph-lang">Paper language</Label>
            <Select id="ph-lang" value={paper.language} onChange={(e) => onChange({ language: e.target.value as Lang })}>
              {meta.languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>School logo (optional)</Label>
            <div className="flex flex-wrap items-center gap-3">
              {h.logo_media_id && paper.media[h.logo_media_id] && <img src={paper.media[h.logo_media_id].url} alt="Logo" className="h-14 max-w-32 rounded bg-white object-contain p-1" />}
              <Button size="sm" variant="secondary" onClick={() => logoInput.current?.click()} disabled={uploading}>
                {uploading ? <Spinner className="h-3.5 w-3.5" label="Uploading logo" /> : <ImagePlus className="h-3.5 w-3.5" />} {h.logo_media_id ? 'Replace logo' : 'Upload logo'}
              </Button>
              {h.logo_media_id && <Button size="sm" variant="ghost" onClick={() => setH({ logo_media_id: null })}><Trash2 className="h-3.5 w-3.5" /> Remove</Button>}
              <input ref={logoInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => void uploadLogo(e.target.files?.[0])} />
            </div>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="ph-gi">General instructions (one per line)</Label>
            <Textarea id="ph-gi" rows={4} value={gi} onChange={(e) => setGi(e.target.value)}
              onBlur={() => setH({ general_instructions: gi.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 15).map((x) => x.slice(0, 300)) })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-200"><input type="checkbox" checked={h.show_marks} onChange={(e) => setH({ show_marks: e.target.checked })} className="h-4 w-4 accent-brand-500" /> Show marks against each question</label>
          <label className="flex items-center gap-2 text-sm text-ink-200"><input type="checkbox" checked={h.show_roll_no} onChange={(e) => setH({ show_roll_no: e.target.checked })} className="h-4 w-4 accent-brand-500" /> Name and roll number lines</label>
        </div>
      </Card>

      <Card title="Sections" description="Questions are numbered continuously across sections.">
        <div className="space-y-3">
          {paper.sections.map((s, i) => (
            <div key={s.id} className="grid gap-2 rounded-xl border border-line p-3 md:grid-cols-[1fr_2fr_auto]">
              <div>
                <Label htmlFor={`sec-t-${s.id}`}>Section title</Label>
                <Input id={`sec-t-${s.id}`} maxLength={120} value={s.title} onChange={(e) => setSections(paper.sections.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)))} />
              </div>
              <div>
                <Label htmlFor={`sec-i-${s.id}`}>Section instructions</Label>
                <Input id={`sec-i-${s.id}`} maxLength={500} value={s.instructions} onChange={(e) => setSections(paper.sections.map((x) => (x.id === s.id ? { ...x, instructions: e.target.value } : x)))} />
              </div>
              <div className="flex items-end gap-1">
                <Button variant="ghost" size="icon" aria-label={`Move ${s.title || 'section'} up`} disabled={i === 0} onClick={() => setSections(moveItem(paper.sections, i, i - 1))}><ArrowUp className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" aria-label={`Move ${s.title || 'section'} down`} disabled={i === paper.sections.length - 1} onClick={() => setSections(moveItem(paper.sections, i, i + 1))}><ArrowDown className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" aria-label={`Remove ${s.title || 'section'}`} disabled={paper.sections.length <= 1}
                  onClick={() => setSections(paper.sections.filter((x) => x.id !== s.id))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
          <Button size="sm" variant="secondary" disabled={paper.sections.length >= 10}
            onClick={() => setSections([...paper.sections, { id: newId('S').slice(0, 12), title: `Section ${String.fromCharCode(65 + paper.sections.length)}`, instructions: '' }])}>
            <Plus className="h-3.5 w-3.5" /> Add section
          </Button>
        </div>
      </Card>
    </fieldset>
  )
}
