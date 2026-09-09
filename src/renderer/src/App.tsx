import { useEffect, useState } from 'react'
import { useAppStore, subscribeMainEvents } from './store'
import { applyLanguage } from './i18n'
import TitleBar from './components/TitleBar'
import Sidebar, { type ViewId } from './components/Sidebar'
import RuntimeView from './views/RuntimeView'
import ModelsView from './views/ModelsView'
import ServerView from './views/ServerView'
import ChatView from './views/ChatView'
import KeysView from './views/KeysView'
import UsageView from './views/UsageView'
import SettingsView from './views/SettingsView'

export default function App() {
  const [view, setView] = useState<ViewId>('server')
  const settings = useAppStore((s) => s.settings)
  const init = useAppStore((s) => s.init)

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

  return (
    <div className="app-frame">
      <TitleBar />
      <div className="app-shell">
        <Sidebar view={view} onNavigate={setView} />
        <main className="main-area">
          {view === 'runtime' && <RuntimeView />}
          {view === 'models' && <ModelsView />}
          {view === 'server' && <ServerView />}
          {view === 'chat' && <ChatView />}
          {view === 'keys' && <KeysView />}
          {view === 'usage' && <UsageView />}
          {view === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  )
}
