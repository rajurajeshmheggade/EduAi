/* Card styling for a picked row / library item (Rapid's fileKind + LABEL_IMG), and the asset-type icons. */
import { CircleQuestionMark, ClipboardList, Clapperboard, FolderOpen, Star, type LucideIcon } from 'lucide-react'
import type { AssetType } from '@/types/lessonPlan'
import { KINDS, isCardKind } from '../resourcesModel'

export interface KindStyle { tint: string; fg: string; label: string }

/** A row's badge + tint. `type` is the card kind the library returned; the name is the fallback signal. */
export function fileKind(name: string, type: string): KindStyle {
  if (isCardKind(type)) return { tint: KINDS[type].tint, fg: KINDS[type].fg, label: KINDS[type].label }
  const n = name || ''
  if ((type || '').startsWith('video') || /\.(mp4|mov|webm)$/i.test(n)) return { tint: 'bg-pink-50', fg: 'text-pink-600', label: 'Video' }
  if ((type || '').startsWith('image') || /\.(png|jpe?g|gif|svg)$/i.test(n)) return { tint: 'bg-green-50', fg: 'text-green-600', label: 'Image' }
  if (/\.(pptx?|key)$/i.test(n)) return { tint: 'bg-orange-50', fg: 'text-orange-600', label: 'Slides' }
  return { tint: 'bg-blue-50', fg: 'text-blue-600', label: 'Document' }
}

const LABEL_IMG: Record<string, string> = {
  Video: 'video', Worksheet: 'worksheet', Slides: 'slides', Reference: 'reference', Document: 'reference', PDF: 'reference',
  Test: 'test', Question: 'question', Activity: 'activity', Image: 'slides', Audio: 'video',
}

/** Which miniature the thumbnail draws for a row. */
export function thumbKind(name: string, type: string): string {
  return isCardKind(type) ? type : (LABEL_IMG[fileKind(name, type).label] || 'reference')
}

export const ASSET_ICON: Record<AssetType, LucideIcon> = {
  Resources: FolderOpen,
  Tests: ClipboardList,
  Questions: CircleQuestionMark,
  Activities: Star,
  'Video Catalogue': Clapperboard,
}
