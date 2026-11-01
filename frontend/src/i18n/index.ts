import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { LANGUAGES, RESOURCES, type LangCode } from './locales'

const KEY = 'eduai.lang'

function stored(): LangCode {
  try {
    const v = localStorage.getItem(KEY)
    return LANGUAGES.some((l) => l.code === v) ? (v as LangCode) : 'en'
  } catch {
    return 'en'
  }
}

/**
 * Loads the Noto font a script needs, once. Translated screens set `lang` on their own root element (screen readers,
 * :lang() fonts); staff screens stay English, so the document language is not changed globally.
 */
function loadFont(lang: LangCode) {
  const font = LANGUAGES.find((l) => l.code === lang)?.font
  if (!font) return
  const id = `font-${lang}`
  if (document.getElementById(id)) return
  const link = Object.assign(document.createElement('link'), {
    id, rel: 'stylesheet',
    href: `https://fonts.googleapis.com/css2?family=${font.replace(/ /g, '+')}:wght@400;500;600;700&display=swap`,
  })
  document.head.appendChild(link)
}

void i18n.use(initReactI18next).init({
  resources: RESOURCES,
  lng: stored(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },   // React already escapes
})
loadFont(i18n.language as LangCode)

/** True once the user picked a language in this browser (then a saved profile language does not override it). */
export function hasChosenLanguage(): boolean {
  try { return localStorage.getItem(KEY) !== null } catch { return false }
}

export function setLanguage(lang: LangCode) {
  try { localStorage.setItem(KEY, lang) } catch { /* storage unavailable: still switch for this visit */ }
  loadFont(lang)
  return i18n.changeLanguage(lang)
}

export default i18n
