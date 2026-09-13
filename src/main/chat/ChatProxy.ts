import { randomUUID } from 'crypto'
import type {
  ChatErrorEvent,
  ChatEndEvent,
  ChatMessage,
  ChatSendRequest,
  ChatSession,
  ChatTokenEvent,
  ServerState
} from '@shared/types'
import type { ChatRepo } from '../store/chatRepo'

interface TokenListener {
  (e: ChatTokenEvent): void
}
interface EndListener {
  (e: ChatEndEvent): void
}
interface ErrorListener {
  (e: ChatErrorEvent): void
}

/**
 * 调 llama-server /v1/chat/completions（SSE），逐 token 转发事件，
 * 结束时算 tokens/s 并持久化到 sqlite。
 */
export class ChatProxy {
  private abortCtrl: AbortController | null = null
  private tokenCb: TokenListener | null = null
  private endCb: EndListener | null = null
  private errorCb: ErrorListener | null = null
  private apiKey: string | undefined

  constructor(private chatRepo: ChatRepo, private getServerState: () => ServerState) {}

  /** 组合根在 server 启动后注入（server 用了 --api-key 才需要带） */
  setApiKey(key: string | undefined): void {
    this.apiKey = key && key.length > 0 ? key : undefined
  }

  onToken(cb: TokenListener): void {
    this.tokenCb = cb
  }
  onEnd(cb: EndListener): void {
    this.endCb = cb
  }
  onError(cb: ErrorListener): void {
    this.errorCb = cb
  }

  abort(): void {
    this.abortCtrl?.abort()
  }

  async send(session: ChatSession, req: ChatSendRequest): Promise<void> {
    if (this.abortCtrl) throw new Error('已有请求进行中')
    const server = this.getServerState()
    if (server.state !== 'ready' || !server.host || !server.port) {
      throw new Error('server 未就绪')
    }

    const url = `http://${server.host}:${server.port}/v1/chat/completions`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`

    const body: Record<string, unknown> = {
      model: server.modelPath ?? 'local',
      messages: req.messages,
      stream: true,
      // llama.cpp server 默认 include_usage=false，不传则流式 chunk 永不带 usage
      stream_options: { include_usage: true }
    }
    const ov = req.overrides ?? {}
    if (ov.temperature !== undefined) body.temperature = ov.temperature
    if (ov.topP !== undefined) body.top_p = ov.topP
    if (ov.topK !== undefined) body.top_k = ov.topK
    if (ov.maxTokens !== undefined) body.max_tokens = ov.maxTokens

    const messageId = randomUUID()
    const startedAt = Date.now()
    let assistantContent = ''
    let usage: { prompt: number; completion: number } | undefined
    let finishReason: string | undefined

    const emitToken = (delta: string) => {
      assistantContent += delta
      this.tokenCb?.({ sessionId: session.id, messageId, delta })
    }

    try {
      this.abortCtrl = new AbortController()
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: this.abortCtrl.signal
      })
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue
          try {
            const json = JSON.parse(data)
            const delta: string = json.choices?.[0]?.delta?.content ?? ''
            if (delta) emitToken(delta)
            if (json.choices?.[0]?.finish_reason) finishReason = json.choices[0].finish_reason
            if (json.usage) {
              usage = { prompt: json.usage.prompt_tokens ?? 0, completion: json.usage.completion_tokens ?? 0 }
            }
          } catch {
            // 非 JSON 行忽略
          }
        }
      }

      const elapsedSec = Math.max(0.001, (Date.now() - startedAt) / 1000)
      const tokensPerSec = usage?.completion ? usage.completion / elapsedSec : undefined
      this.persistAssistant(session, messageId, assistantContent, usage, tokensPerSec)
      this.endCb?.({ sessionId: session.id, messageId, finishReason, usage, tokensPerSec })
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError'
      if (assistantContent) {
        // 已有部分内容：落盘保留
        this.persistAssistant(session, messageId, assistantContent, usage, undefined)
      }
      this.errorCb?.({
        sessionId: session.id,
        messageId,
        message: aborted ? '已中止' : (err as Error).message
      })
    } finally {
      this.abortCtrl = null
    }
  }

  private persistAssistant(
    session: ChatSession,
    messageId: string,
    content: string,
    usage?: { prompt: number; completion: number },
    tokensPerSec?: number
  ): void {
    const msg: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content,
      usage,
      tokensPerSec,
      modelId: this.getServerState().modelPath,
      createdAt: Date.now()
    }
    this.chatRepo.saveMessage(session.id, msg)
    this.chatRepo.touchSession(session.id)
  }

}
