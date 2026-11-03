import { api } from './apiClient'

/** What the licence allows for one catalogue resource (decided by the server, see DIKSHA_LICENSE_AND_ATTRIBUTION.md). */
export interface DikshaPermissions {
  license: string | null
  discover: boolean
  embed: boolean
  store_copy: boolean
  redistribute: boolean
  modify: boolean
  review_required: boolean
  eligible: boolean
  notes: string[]
}

/** How a resource opens inside the app. `none` = it cannot be shown here (the server does not list such items). */
export type DikshaViewer = 'pdf' | 'video' | 'audio' | 'youtube' | 'html' | 'none'
export interface DikshaAccess { viewer: DikshaViewer; src: string | null; video_id?: string; reason?: string }

export interface DikshaItem {
  source: 'diksha'
  source_id: string
  kind: 'textbook' | 'collection' | 'resource'
  name: string | null
  description: string | null
  cover_url: string | null
  primary_category: string | null
  content_type: string | null
  mime_type: string | null
  resource_type: 'pdf' | 'video' | 'youtube' | 'audio' | 'epub' | 'interactive' | 'collection' | 'other'
  boards: string[]
  classes: number[]
  class_labels: string[]
  subjects: string[]
  mediums: string[]
  license: { name: string | null; url: string | null }
  author: string | null
  creator: string | null
  attributions: string[]
  copyright: string | null
  copyright_year: number | null
  organisation: string[]
  leaf_count: number | null
  size_bytes: number | null
  duration: number | string | null
  version: number | null
  published_on: string | null
  status: string | null
  permissions: DikshaPermissions
  access: DikshaAccess
  path?: string[]
  published_to?: { publication_id: string; class_code: string; class_name: string; subject_code: string }[]
}

export interface DikshaUnit { id: string; name: string; index: number | null; units: DikshaUnit[]; resources: DikshaItem[]; resource_count: number }
export interface DikshaTextbook { book: DikshaItem; units: DikshaUnit[]; resources: DikshaItem[]; resource_count: number; empty_units: number }

export interface FacetOption<T = string> { value: T; label: string; count?: number }
/** Content types of the library: textbooks (chapter lists) and the formats that open inside the app. */
export type ContentType = 'textbook' | 'video' | 'document' | 'interactive' | 'audio'
export const DEFAULT_CONTENT_TYPE: ContentType = 'textbook'
export interface DikshaFilterOptions {
  total: number
  content_type?: ContentType
  boards: FacetOption[]
  classes: FacetOption<number>[]
  /** Only subjects that have content of the chosen type. */
  subjects: FacetOption[]
  /** Languages for the chosen type (and subject, when one is chosen). */
  mediums: FacetOption[]
  content_types: FacetOption<ContentType>[]
}
export interface DikshaMeta { enabled: boolean; boards: FacetOption[]; classes: number[]; content_types: FacetOption<ContentType>[]; embed_noncommercial: boolean }

export interface DikshaQuery {
  board?: string; class_number?: number | ''; subject?: string; medium?: string; content_type?: ContentType; q?: string; page?: number; page_size?: number
}
export interface DikshaSearchResult { items: DikshaItem[]; total: number | null; page: number; page_size: number; window_exceeded: boolean }

/** A catalogue item published to the student's class (metadata snapshot stored by the LMS). */
export interface PublishedExternal {
  source: 'diksha'
  source_id: string
  kind: 'textbook' | 'resource'
  name: string
  metadata: Omit<DikshaItem, 'permissions' | 'access' | 'published_to'>
  source_status: 'available' | 'unavailable'
  subjects: { subject_code: string; subject_name: string; teacher_name: string | null }[]
  published_at: string
  context: { textbook_id: string; textbook_name: string; path: string[] } | null
}

export interface PublishSelection { source_id: string; within?: string; item: DikshaItem }

const B = '/ICMELive/api/v1/library/diksha'
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null))

export const dikshaService = {
  meta: async () => (await api.get<DikshaMeta>(`${B}/meta`)).data,
  filters: async (f: { board?: string; class_number?: number | ''; content_type?: ContentType; subject?: string }) =>
    (await api.get<DikshaFilterOptions>(`${B}/filters`, { params: clean(f) })).data,
  search: async (f: DikshaQuery) => (await api.get<DikshaSearchResult>(`${B}/search`, { params: clean({ ...f }) })).data,
  textbook: async (id: string) => (await api.get<DikshaTextbook>(`${B}/textbooks/${encodeURIComponent(id)}`)).data,
  resource: async (id: string, within?: string | null) =>
    (await api.get<DikshaItem>(`${B}/resources/${encodeURIComponent(id)}`, { params: clean({ within }) })).data,
  publish: async (body: { items: { source_id: string; within?: string }[]; class_code: string; subject_code: string }) =>
    (await api.post<{ published: string[]; already_published: string[]; year_code: string; student_count: number }>(`${B}/publications`, body)).data,
  refresh: async (org?: string | null) => (await api.post<{ checked: number; updated: number; unavailable: number; failed: number }>(
    `${B}/refresh`, null, { params: clean({ org_code: org }) })).data,
}

/** In-app reader route for catalogue items (`/library/diksha/…` is the old path, redirected there). */
export const EXPLORE_ROUTE = '/library/explore'

/** Link to the in-app reader page of a catalogue textbook / resource. */
export function dikshaReaderLink(sourceId: string, kind: 'textbook' | 'resource' | 'collection', opts: { within?: string | null; from?: string } = {}) {
  const q = new URLSearchParams({ kind: kind === 'collection' ? 'textbook' : kind })
  if (opts.within) q.set('within', opts.within)
  if (opts.from) q.set('from', opts.from)
  return `${EXPLORE_ROUTE}/${encodeURIComponent(sourceId)}?${q.toString()}`
}
