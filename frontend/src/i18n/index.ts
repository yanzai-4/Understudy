import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from './zh.json'
import en from './en.json'

const STORAGE_KEY = 'understudy.lang'

const saved = localStorage.getItem(STORAGE_KEY)
const initial = saved === 'en' || saved === 'zh' ? saved : 'en'

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export function setLanguage(lang: 'zh' | 'en') {
  i18n.changeLanguage(lang)
  localStorage.setItem(STORAGE_KEY, lang)
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  // Persist to the backend so server-side language (e.g. demo seeding on reset)
  // always matches what the UI is showing. Fire-and-forget.
  void fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: { language: lang } }),
  }).catch(() => {})
}

export default i18n
