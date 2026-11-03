import { AdmissionFormsWorkspace } from '@/components/admission-forms/AdmissionFormsWorkspace'
import { useAuth } from '@/auth/AuthContext'

/** Teacher → Admission forms (also the counsellor's Applications page): build and publish forms, issue one-time
 * applicant credentials, review applications. */
export default function AdmissionForms() {
  const { user } = useAuth()
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <h1 className="font-display text-3xl font-bold">Admission <span className="text-gradient">forms</span></h1>
        <p className="mt-1 text-sm text-ink-300">Create the admission form, publish it as a standalone application, and review the applications that come in.</p>
      </header>
      <AdmissionFormsWorkspace reportBase={user?.role === 'teacher' ? undefined : null} />
    </div>
  )
}
