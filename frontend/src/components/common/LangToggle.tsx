import { useTranslation } from 'react-i18next'
import { setLanguage } from '../../i18n'

export default function LangToggle() {
  const { i18n } = useTranslation()
  const lang = i18n.language === 'en' ? 'en' : 'zh'

  return (
    <div className="flex rounded-lg border border-night-700 bg-night-900 p-0.5 text-xs">
      {(['zh', 'en'] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLanguage(l)}
          className={`rounded-md px-2.5 py-1 transition-colors ${
            lang === l
              ? 'bg-night-700 text-cyan-300'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {l === 'zh' ? '中' : 'EN'}
        </button>
      ))}
    </div>
  )
}
