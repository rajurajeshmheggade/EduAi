import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Role } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Super-admin and institution admin share one admin experience and are both shown as "Admin". */
const ROLE_LABEL: Record<Role, string> = {
  superadmin: 'Super Admin', orgadmin: 'Admin', teacher: 'Teacher', student: 'Student',
  counsellor: 'Counsellor', reviewer: 'Integrity reviewer', parent: 'Parent',
}
export const roleLabel = (r: Role) => ROLE_LABEL[r]
