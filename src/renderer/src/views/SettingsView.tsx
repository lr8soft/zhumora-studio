import { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, applyLanguage, type AppLanguage } from '../i18n'
import type { AppLang, Settings } from '@shared/types'

/** 二进制名按平台：Windows 带 .exe，Linux/macOS 无后缀（renderer 无 process，靠 UA 判断） */
function binName(): string {
  return /Windows/i.test(navigator.userAgent) ? 'llama-server.exe' : 'llama-server'
}

export default function SettingsView() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const [draft, setDraft] = useState<Partial<Settings>>({})
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (settings && Object.keys(draft).length === 0) setDraft({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  const val = <K extends keyof Settings>(k: K): Settings[K] => draft[k] ?? settings?.[k] ?? ({} as Settings)[k]

  const save = async () => {
    setSaveError(null)
    try {
      const next = await window.zhumora.settings.save(draft)
      setSettings(next)
      setDraft({})
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setSaveError((e as Error).message)
    }
  }

  const pickDir = async () => {
    const p = await window.zhumora.system.pickDirectory()
    if (p) setDraft((d) => ({ ...d, modelsDir: p }))
  }

  const pickBinary = async () => {
    const p = await window.zhumora.system.pickBinary()
    if (p) setDraft((d) => ({ ...d, llamaBinary: p }))
  }

  const openModelsDir = async () => {
    await window.zhumora.system.openPath(settings?.modelsDir ?? '')
  }

  /** 语言：即时生效（i18n + localStorage），同时持久化到 settings（只存 lang，不连带草稿） */
  const changeLang = (lang: AppLanguage) => {
    applyLanguage(lang)
    void window.zhumora.settings.save({ lang: lang as AppLang }).then((next) => {
      useAppStore.getState().setSettings(next)
      setDraft((d) => {
        const rest = { ...d }
        delete rest.lang
        return rest
      })
    })
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h2>{t('settings.title')}</h2>
          <p>{t('settings.desc')}</p>
        </div>
        <div className="header-actions">
          {saved && <span className="badge badge-ready">{t('settings.saved')}</span>}
          <button className="btn btn-primary" onClick={() => void save()}>
            {t('settings.save')}
          </button>
        </div>
      </div>

      {/* 语言 */}
      <div className="card">
        <div className="card-head"><h3>{t('settings.language')}</h3></div>
        <div className="card-body" style={{ display: 'grid', gap: 10 }}>
          <select
            className="field-input"
            style={{ maxWidth: 280 }}
            value={String(val('lang'))}
            onChange={(e) => changeLang(e.target.value as AppLanguage)}
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code === 'auto' ? t('settings.autoDetect') : l.nativeLabel}
              </option>
            ))}
          </select>
          <div className="hint">{t('settings.languageHint')}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><h3>{t('settings.modelsDir')}</h3></div>
        <div className="card-body" style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              className="field-input mono"
              style={{ flex: 1 }}
              value={String(val('modelsDir'))}
              onChange={(e) => setDraft((d) => ({ ...d, modelsDir: e.target.value }))}
            />
            <button className="btn" onClick={() => void pickDir()}>{t('settings.browse')}</button>
            <button className="btn btn-ghost" onClick={() => void openModelsDir()}>{t('settings.open')}</button>
          </div>
          <div className="hint">{t('settings.modelsDirHint')}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h3>{t('settings.binary')}</h3>
          <span className="sub">{t('settings.binarySub')}</span>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              className="field-input mono"
              style={{ flex: 1 }}
              value={String(val('llamaBinary'))}
              placeholder={t('settings.binaryPh')}
              onChange={(e) => setDraft((d) => ({ ...d, llamaBinary: e.target.value }))}
            />
            <button className="btn" onClick={() => void pickBinary()}>{t('settings.browse')}</button>
          </div>
          <div className="hint" style={{ lineHeight: 1.5 }}>
            {t('settings.binaryHint', { bin: binName() })}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><h3>{t('settings.appearance')}</h3></div>
        <div className="card-body">
          <div className="form-row">
            <div className="field">
              <label>{t('settings.theme')}</label>
              <select
                value={String(val('theme'))}
                onChange={(e) => setDraft((d) => ({ ...d, theme: e.target.value as Settings['theme'] }))}
              >
                <option value="system">{t('settings.themeSystem')}</option>
                <option value="light">{t('settings.themeLight')}</option>
                <option value="dark">{t('settings.themeDark')}</option>
              </select>
            </div>
            <div className="field">
              <label>{t('settings.fontSize')}</label>
              <select
                value={String(val('fontSize'))}
                onChange={(e) => setDraft((d) => ({ ...d, fontSize: Number(e.target.value) }))}
              >
                {[13, 14, 15, 16, 17, 18].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><h3>{t('settings.about')}</h3></div>
        <div className="card-body" style={{ fontSize: '0.8rem', color: 'var(--app-color-text-soft)', lineHeight: 1.7 }}>
          <p>{t('settings.aboutLine1')}</p>
          <p>
            {t('settings.aboutLine2')}
          </p>
        </div>
      </div>

      {saveError && (
        <div className="toast error" style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>
          {saveError}
        </div>
      )}
    </div>
  )
}
