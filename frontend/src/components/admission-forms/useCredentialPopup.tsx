import { useState } from 'react'
import { CredentialDialog } from '@/components/admission-forms/CredentialDialog'
import { admissionFormService as svc, type IssuedCredential } from '@/services/admissionFormService'

/** The credentials pop-up wired to the acknowledgement endpoint. */
export function useCredentialPopup(org?: string | null, onDone?: () => void) {
  const [credential, setCredential] = useState<IssuedCredential | null>(null)
  const popup = (
    <CredentialDialog credential={credential} onClose={() => { setCredential(null); onDone?.() }}
      onAcknowledge={(copied) => svc.acknowledge(credential!.credential_id, copied, org)} />
  )
  return { popup, show: setCredential }
}
