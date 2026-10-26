import { BookOpen } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/field'

/** In-page subject switcher for subject-scoped workspaces (textbooks, AI classroom). */
export function SubjectPicker({ className }: { className?: string }) {
  const { user, subject, setSubject } = useAuth()
  if (!user || user.allowed_subjects.length === 0) return null
  if (user.allowed_subjects.length === 1) {
    return <Badge tone="brand" className={className}><BookOpen className="h-3 w-3" /> {user.allowed_subjects[0]}</Badge>
  }
  return (
    <Select aria-label="Subject" id="subject-picker" className={className ?? 'w-40'} value={subject ?? ''} onChange={(e) => setSubject(e.target.value)}>
      {user.allowed_subjects.map((s) => <option key={s} value={s}>{s}</option>)}
    </Select>
  )
}
