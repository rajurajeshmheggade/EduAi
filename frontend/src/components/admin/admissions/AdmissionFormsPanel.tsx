import { AdmissionFormsWorkspace } from '@/components/admission-forms/AdmissionFormsWorkspace'

/** Admin console → Admission forms: every form of the school, the review queue, recovery requests and the branding of
 * the standalone admission application. */
export function AdmissionFormsPanel({ org }: { org: string | null }) {
  return <AdmissionFormsWorkspace org={org} canBrand reportBase="/admin/admission-reports" />
}
