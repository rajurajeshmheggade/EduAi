/** Per-user browser storage for the study flow. Storage can be unavailable (private mode, blocked): never throw. */

export const storageKey = (name: string, scope: string) => `eduai.${name}.${scope}`

export function readStored<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch { /* storage unavailable or full: the state simply is not remembered */ }
}
