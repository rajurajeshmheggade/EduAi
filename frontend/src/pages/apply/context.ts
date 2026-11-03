import { createContext, useContext } from 'react'
import type { Me, PublicInfo } from '@/services/applyService'

export interface ApplyCtx {
  slug: string
  info: PublicInfo
  /** The signed-in applicant's application (null while signed out or loading). */
  me: Me | null
  meError: string | null
  signedIn: boolean
  reloadMe: () => Promise<Me | null>
  setMe: (m: Me) => void
  onSignedIn: () => void
  signOut: (message?: string) => Promise<void>
  /** Drop the local session without calling the server (the credential was just removed by a submission). */
  forget: () => void
  /** Message for the sign-in page (e.g. "your session has ended"). */
  notice: string | null
  base: string
}

export const ApplyContext = createContext<ApplyCtx | null>(null)

export function useApply(): ApplyCtx {
  const c = useContext(ApplyContext)
  if (!c) throw new Error('useApply outside the admission application')
  return c
}
