import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { setLanguage } from '@/i18n'
import { LANGUAGES, type LangCode } from '@/i18n/locales'
import { cn } from '@/lib/utils'

/** Language picker for parent / student screens. Each option is labelled in its own script. */
export function LanguageSwitcher({ onChange, className }: { onChange?: (lang: LangCode) => void; className?: string }) {
  const { t, i18n } = useTranslation()
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <Languages className="h-4 w-4 text-ink-500" aria-hidden />
      <div role="radiogroup" aria-label={t('common.language')} className="flex flex-wrap gap-1">
        {LANGUAGES.map((l) => (
          <button key={l.code} type="button" role="radio" aria-checked={i18n.language === l.code} lang={l.code}
            onClick={() => { void setLanguage(l.code); onChange?.(l.code) }}
            className={cn('min-h-9 cursor-pointer rounded-lg border px-3 text-sm transition-colors',
              i18n.language === l.code ? 'border-brand-400 bg-brand-500/10 font-medium text-brand-600' : 'border-line text-ink-300 hover:text-fg')}>
            {l.label}
          </button>
        ))}
      </div>
    </div>
  )
}
