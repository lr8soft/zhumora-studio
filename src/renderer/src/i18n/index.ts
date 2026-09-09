// ============================================================
// i18n 初始化 — i18next + react-i18next（对齐 mini-agent）
// 支持 7 种模式: auto（系统检测）+ en/zh/ja/es/fr/de
// 默认 auto：首启检测系统语言，用户可在 Settings 中手动切换
// ============================================================
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'
import zh from './locales/zh'
import ja from './locales/ja'
import es from './locales/es'
import fr from './locales/fr'
import de from './locales/de'

export type AppLanguage = 'auto' | 'en' | 'zh' | 'ja' | 'es' | 'fr' | 'de'

export const SUPPORTED_LANGUAGES: { code: AppLanguage; nativeLabel: string }[] = [
  { code: 'auto', nativeLabel: 'Auto (System)' },
  { code: 'en', nativeLabel: 'English' },
  { code: 'zh', nativeLabel: '中文' },
  { code: 'ja', nativeLabel: '日本語' },
  { code: 'es', nativeLabel: 'Español' },
  { code: 'fr', nativeLabel: 'Français' },
  { code: 'de', nativeLabel: 'Deutsch' }
]

const LS_KEY = 'zhumora-language'

/**
 * 检测系统语言
 * 优先级: navigator.language → navigator.languages[0] → 'en'
 */
export function detectSystemLanguage(): string {
  const navLang = (navigator.language || '').toLowerCase()
  const navLangs = (navigator.languages || []).map((l) => l.toLowerCase())
  const candidates = [navLang, ...navLangs]

  for (const candidate of candidates) {
    if (candidate.startsWith('zh')) return 'zh'
    if (candidate.startsWith('ja')) return 'ja'
    if (candidate.startsWith('es')) return 'es'
    if (candidate.startsWith('fr')) return 'fr'
    if (candidate.startsWith('de')) return 'de'
    if (candidate.startsWith('en')) return 'en'
  }
  return 'en'
}

/** lang === 'auto' 时返回检测到的系统语言 */
export function getEffectiveLanguage(lang: AppLanguage): string {
  if (lang === 'auto') return detectSystemLanguage()
  return lang
}

function getStoredLanguage(): AppLanguage {
  try {
    const stored = localStorage.getItem(LS_KEY)
    if (stored && SUPPORTED_LANGUAGES.some((l) => l.code === stored)) return stored as AppLanguage
  } catch {
    /* localStorage not available */
  }
  return 'auto'
}

export function storeLanguage(lang: AppLanguage): void {
  try {
    localStorage.setItem(LS_KEY, lang)
  } catch {
    /* ignore */
  }
}

// 初始化 i18n
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
    ja: { translation: ja },
    es: { translation: es },
    fr: { translation: fr },
    de: { translation: de }
  },
  lng: getEffectiveLanguage(getStoredLanguage()),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false
  },
  react: {
    useSuspense: false
  }
})

/** 切换生效语言（先写 localStorage 供下次冷启动，再切 i18next） */
export function applyLanguage(lang: AppLanguage): void {
  storeLanguage(lang)
  void i18n.changeLanguage(getEffectiveLanguage(lang))
}

export default i18n
