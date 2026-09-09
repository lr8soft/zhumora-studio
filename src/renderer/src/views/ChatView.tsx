import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import type { ChatMessage, ChatRole } from '@shared/types'

export default function ChatView() {
  const sessions = useAppStore((s) => s.sessions)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const messages = useAppStore((s) => s.messages)
  const streaming = useAppStore((s) => s.streaming)
  const models = useAppStore((s) => s.models)
  const serverState = useAppStore((s) => s.serverState)
  const [input, setInput] = useState('')
  const [sysPrompt, setSysPrompt] = useState('')
  const [showAdv, setShowAdv] = useState(false)
  const [adv, setAdv] = useState({ temperature: '', topP: '', maxTokens: '' })
  const boxRef = useRef<HTMLDivElement>(null)
  const serverReady = serverState.state === 'ready'
  const active = sessions.find((s) => s.id === activeSessionId)
  const isStreaming = Boolean(streaming[activeSessionId ?? ''])

  useEffect(() => {
    if (activeSessionId) {
      void window.zhumora.chat.messages(activeSessionId).then((msgs) => {
        useAppStore.getState().setMessages(activeSessionId, msgs)
      })
    }
  }, [activeSessionId])

  useEffect(() => {
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages[activeSessionId ?? '']?.length, streaming[activeSessionId ?? '']?.content, isStreaming])

  const newSession = async () => {
    const modelId = (active?.modelId ?? '') || (models[0]?.id ?? '')
    const session = await window.zhumora.chat.createSession(modelId)
    useAppStore.getState().setSessions(await window.zhumora.chat.sessions())
    useAppStore.getState().setActiveSession(session.id)
  }

  const delSession = async (id: string) => {
    if (!window.confirm('删除该会话及全部消息？')) return
    await window.zhumora.chat.deleteSession(id)
    const st = useAppStore.getState()
    if (st.activeSessionId === id) st.setActiveSession(null)
    st.setSessions(await window.zhumora.chat.sessions())
  }

  const send = async () => {
    const text = input.trim()
    if (!text || !activeSessionId || isStreaming) return
    setInput('')

    // 组装消息序列：历史 + system（若有）+ 本条 user
    const history = messages[activeSessionId] ?? []
    const seq: { role: ChatRole; content: string }[] = []
    if (sysPrompt.trim()) seq.push({ role: 'system', content: sysPrompt.trim() })
    for (const m of history) {
      if (m.role === 'user' || m.role === 'assistant') seq.push({ role: m.role, content: m.content })
    }
    seq.push({ role: 'user', content: text })

    // 本地先挂 user 消息
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: Date.now()
    }
    useAppStore.getState().setMessages(activeSessionId, [...history, userMsg])

    try {
      await window.zhumora.chat.send({
        sessionId: activeSessionId,
        messages: seq,
        overrides: {
          temperature: adv.temperature ? Number(adv.temperature) : undefined,
          topP: adv.topP ? Number(adv.topP) : undefined,
          maxTokens: adv.maxTokens ? Number(adv.maxTokens) : undefined
        }
      })
    } catch (e) {
      window.alert((e as Error).message)
    }
  }

  const msgCount = messages[activeSessionId ?? '']?.length ?? 0
  const stream = activeSessionId ? streaming[activeSessionId] : undefined

  return (
    <div className="chat-layout" style={{ flex: 1, minHeight: 0 }}>
      <div className="chat-sessions">
        <div className="chat-sessions-head">
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => void newSession()}>
            新会话
          </button>
        </div>
        <div className="chat-session-list">
          {sessions.length === 0 && (
            <div style={{ padding: '12px 8px', color: 'var(--app-color-text-mute)', fontSize: '0.783rem' }}>
              暂无会话
            </div>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              className={s.id === activeSessionId ? 'active' : ''}
              onClick={() => useAppStore.getState().setActiveSession(s.id)}
            >
              <span className="title">{s.title}</span>
              <span className="del" onClick={(e) => { e.stopPropagation(); void delSession(s.id) }} title="删除">
                ✕
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="chat-main">
        <div className="chat-toolbar">
          <span style={{ fontSize: '0.8rem', color: 'var(--app-color-text-soft)' }}>模型</span>
          <select value={active?.modelId ?? ''} onChange={() => {}}>
            <option value="">{serverState.modelPath ? serverState.modelPath.split(/[\\/]/).pop() : '（server 未启动）'}</option>
          </select>
          <span className="spacer" style={{ flex: 1 }} />
          {!serverReady && (
            <span className="badge badge-stopped">
              {serverState.state === 'error' ? 'server 出错' : 'server 未运行'} — 先在"服务"页启动
            </span>
          )}
          {serverReady && <span className="badge badge-ready">已连接</span>}
        </div>

        <div className="chat-messages" ref={boxRef}>
          {!activeSessionId ? (
            <div className="empty-state">
              <div>
                <div className="mark">💬</div>
                点左侧"新会话"开始对话
              </div>
            </div>
          ) : msgCount === 0 && !stream ? (
            <div className="empty-state">
              <div>
                <div className="mark">✨</div>
                开始和 {serverState.modelPath?.split(/[\\/]/).pop() ?? '模型'} 对话
              </div>
            </div>
          ) : (
            <>
              {(messages[activeSessionId] ?? []).map((m) => (
                <MessageBubble key={m.id} msg={m} />
              ))}
              {stream && (
                <div className="msg assistant">
                  <div className="who">assistant</div>
                  <div className="bubble">
                    {stream.content}
                    <span className="cursor" />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="chat-input">
          <div className="chat-input-inner">
            <details style={{ margin: 0 }} open={showAdv} onToggle={(e) => setShowAdv((e.target as HTMLDetailsElement).open)}>
              <summary style={{ cursor: 'pointer', fontSize: '0.767rem', color: 'var(--app-color-text-mute)' }}>
                高级选项（请求级覆盖 + system prompt）
              </summary>
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                <div className="sysprompt field">
                  <input
                    type="text"
                    placeholder="System Prompt（可选，每次请求注入 messages 头部）"
                    value={sysPrompt}
                    onChange={(e) => setSysPrompt(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label>temperature</label>
                    <input type="number" step="0.1" value={adv.temperature} onChange={(e) => setAdv({ ...adv, temperature: e.target.value })} />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>top_p</label>
                    <input type="number" step="0.05" value={adv.topP} onChange={(e) => setAdv({ ...adv, topP: e.target.value })} />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>max_tokens</label>
                    <input type="number" step="1" value={adv.maxTokens} onChange={(e) => setAdv({ ...adv, maxTokens: e.target.value })} />
                  </div>
                </div>
              </div>
            </details>
            <textarea
              value={input}
              placeholder={serverReady ? '输入消息，Enter 发送 / Shift+Enter 换行' : 'server 未运行，无法发送'}
              disabled={!serverReady}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <div className="chat-input-actions">
              <span className="sysprompt">{msgCount} 条消息</span>
              <span className="spacer" />
              {isStreaming ? (
                <button className="btn btn-danger" onClick={() => void window.zhumora.chat.abort()}>
                  停止生成
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => void send()} disabled={!serverReady || !input.trim() || !activeSessionId}>
                  发送
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isErr = msg.id.startsWith('err-')
  return (
    <div className={`msg ${msg.role === 'user' ? 'user' : 'assistant'} ${isErr ? 'err' : ''}`}>
      <div className="who">
        {msg.role}
        {msg.usage && (
          <span className="usage">
            {msg.usage.prompt}+{msg.usage.completion} tok
            {msg.tokensPerSec ? ` · ${msg.tokensPerSec.toFixed(1)} tok/s` : ''}
          </span>
        )}
      </div>
      <div className="bubble">{msg.content || '（空）'}</div>
    </div>
  )
}
