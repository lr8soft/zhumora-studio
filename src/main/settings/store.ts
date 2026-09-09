import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'
import { defaultParams } from '@shared/buildArgs'
import type { AppLang, LaunchParams, Settings } from '@shared/types'

export const SETTINGS_SCHEMA_VERSION = 1

const APP_LANGS: AppLang[] = ['auto', 'en', 'zh', 'ja', 'es', 'fr', 'de']

/** 边界归一化：schemaVersion 补默认值，唯一入口 */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw ?? {}) as Partial<Settings>
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    modelsDir:
      typeof r.modelsDir === 'string' && r.modelsDir ? r.modelsDir : join(app.getPath('userData'), 'models'),
    llamaBinary: typeof r.llamaBinary === 'string' ? r.llamaBinary : '',
    runtime: {
      version: typeof r.runtime?.version === 'string' ? r.runtime.version : '',
      variant: typeof r.runtime?.variant === 'string' ? r.runtime.variant : '',
      autoUpdate: Boolean(r.runtime?.autoUpdate)
    },
    lastParams: { ...defaultParams(), ...(r.lastParams as LaunchParams ?? {}) },
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : 'system',
    fontSize: typeof r.fontSize === 'number' && r.fontSize >= 13 && r.fontSize <= 18 ? r.fontSize : 15,
    lang: typeof r.lang === 'string' && (APP_LANGS as string[]).includes(r.lang) ? (r.lang as AppLang) : 'auto'
  }
}

export class SettingsStore {
  private file: string
  private cache: Settings

  constructor(userDataPath: string) {
    this.file = join(userDataPath, 'settings.json')
    this.cache = normalizeSettings(readJson(this.file))
  }

  get(): Settings {
    // 返回副本，防止调用方污染缓存
    return {
      ...this.cache,
      runtime: { ...this.cache.runtime },
      lastParams: { ...this.cache.lastParams }
    }
  }

  save(patch: Partial<Settings>): Settings {
    const next = normalizeSettings({ ...this.get(), ...patch })
    this.cache = next
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(next, null, 2), 'utf8')
    return this.get()
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
