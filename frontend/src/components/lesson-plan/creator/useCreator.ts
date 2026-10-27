import { designActions } from './designActions'
import { planActions } from './planActions'
import { useCreatorStore, type CreatorProps } from './useCreatorStore'

/** The whole Lesson Plan Creator wizard: state + derived values + every step's actions. */
export function useCreator(p: CreatorProps) {
  const st = useCreatorStore(p)
  return { ...st, ...planActions(st), ...designActions(st) }
}

export type Creator = ReturnType<typeof useCreator>
