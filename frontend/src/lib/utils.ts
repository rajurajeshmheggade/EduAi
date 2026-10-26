import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Role } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Super-admin and institution admin share one admin experience and are both shown as "Admin". */
export const roleLabel = (r: Role) => (r === 'orgadmin' || r === 'superadmin' ? 'Admin' : r === 'teacher' ? 'Teacher' : 'Student')
