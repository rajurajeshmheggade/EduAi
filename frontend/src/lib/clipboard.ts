/** Writes to the clipboard; falls back to a hidden textarea where the async API is unavailable (non-https). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through */ }
  try {
    const t = document.createElement('textarea')
    t.value = text
    t.setAttribute('readonly', '')
    t.style.position = 'fixed'; t.style.opacity = '0'
    document.body.appendChild(t)
    t.select()
    const ok = document.execCommand?.('copy') ?? false
    t.remove()
    return ok
  } catch { return false }
}
