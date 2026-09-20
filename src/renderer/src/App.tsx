import { useEffect, useState } from 'react'
import { useAppStore, subscribeMainEvents } from './store'
import { applyLanguage } from './i18n'
import TitleBar from './components/TitleBar'
import Sidebar, { type ViewId } from './components/Sidebar'
import ModelDock from './components/ModelDock'
import ModelsView from './views/ModelsView'
import ApiView from './views/ApiView'
import ServerView from './views/ServerView'
import StatusView from './views/StatusView'
import ChatView from './views/ChatView'
import OnboardingView from './views/OnboardingView'
import RuntimeView from './views/RuntimeView'
import KeysView from './views/KeysView'
import UsageView from './views/UsageView'
import SettingsView from './views/SettingsView'

export default function App() {
  // 默认落地"对话"页（新手主线：聊天优先）
  const [view, setView] = useState<ViewId>('chat')
  // 模型页外部定位（首启引导点热门卡 → 自动打开该模型详情）
  const [modelFocus, setModelFocus] = useState<string | null>(null)
  const settings = useAppStore((s) => s.settings)
  const init = useAppStore((s) => s.init)
  const onboarded = settings?.onboarded ?? false

  useEffect(() => {
    void init().then(() => {
      const st = useAppStore.getState()
      if (st.settings) applyLanguage(st.settings.lang)
    })
    return subscribeMainEvents()
  }, [init])

  useEffect(() => {
    const theme = settings?.theme ?? 'system'
    const apply = () => {
      const dark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [settings?.theme])

  useEffect(() => {
    if (settings?.fontSize) document.documentElement.style.fontSize = `${settings.fontSize}px`
  }, [settings?.fontSize])

  // 首启引导未完成：全屏引导（运行时进度 + 选模型 + 跳过）
  if (settings && !onboarded) {
    return (
      <div className="app-frame">
        <TitleBar />
        <OnboardingView
          onDone={() => {
            const next = useAppStore.getState().settings
            if (next && !next.onboarded) {
              // settings 保存失败时的兜底：本地放行，不再反复弹引导
              useAppStore.setState({ settings: { ...next, onboarded: true } })
            }
          }}
          onNavigate={(v, focus) => {
            if (focus) setModelFocus(focus)
            setView(v)
          }}
        />
      </div>
    )
  }

  return (
    <div className="app-frame">
      <TitleBar />
      <div className="app-body">
        <Sidebar view={view} onNavigate={(v) => { if (v !== 'models') setModelFocus(null); setView(v) }} />
        <div className="main-col">
          <ModelDock onNavigate={(v) => setView(v)} />
          <main className="main-area">
            {view === 'models' && <ModelsView focusModelId={modelFocus} />}
            {view === 'api' && <ApiView />}
            {view === 'server' && <ServerView />}
            {view === 'status' && <StatusView />}
            {view === 'chat' && <ChatView onNavigate={(v) => setView(v)} />}
            {view === 'runtime' && <RuntimeView onNavigate={(v) => setView(v)} />}
            {view === 'keys' && <KeysView />}
            {view === 'usage' && <UsageView />}
            {view === 'settings' && <SettingsView />}
          </main>
        </div>
      </div>
    </div>
  )
}
