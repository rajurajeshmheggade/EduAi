/**
 * Where the API lives.
 *
 * Empty (the default) = same origin: in dev the Vite proxy and in production the host's rewrites (frontend/vercel.json)
 * forward /api, /ICMELive, /files and /health to the backend. Set VITE_API_BASE_URL to the backend origin
 * (https://api.example.com, no path) at build time when the frontend is on a static host whose proxy would cut off long
 * AI calls (Vercel ends proxied requests after 30 s); the backend's CORS_ORIGINS must then list the frontend origin.
 */
const raw = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').trim()

/** Backend origin without a trailing slash, or '' for same-origin calls. */
export const API_BASE = raw.replace(/\/+$/, '')

/** Absolute URL for an API path such as '/api/v1/auth/login' (the path itself when API_BASE is empty). */
export const apiUrl = (path: string) => `${API_BASE}${path}`

/** baseURL for the axios clients: the backend origin, or '/' for same-origin calls. */
export const AXIOS_BASE = API_BASE || '/'

/** Backend origin to allow in the exam page's Content-Security-Policy ('' when the API is same-origin). */
export const API_ORIGIN = (() => { try { return API_BASE ? new URL(API_BASE).origin : '' } catch { return '' } })()
