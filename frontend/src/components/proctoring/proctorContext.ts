import { createContext, useContext } from 'react'

export interface ProctorContextValue {
  /** A proctored session is running (false when proctoring is switched off for the module). */
  active: boolean
  sessionId: string | null
  /** The exam was handed in / the classroom closed: stop sensing and close the session. */
  finish: (reason: 'submitted' | 'closed') => Promise<void>
  /** The exam itself sends the student to another tab (Virtual Lab simulation on DIKSHA): not a tab switch. */
  allowAway: (reason: string) => void
}

export const ProctorContext = createContext<ProctorContextValue>({ active: false, sessionId: null, finish: async () => {}, allowAway: () => {} })

/** The running proctored session of the surrounding ProctorGate (no-ops outside one). */
export const useProctor = () => useContext(ProctorContext)
