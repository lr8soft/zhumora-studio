import http from 'http'
import type { AddressInfo } from 'net'

/**
 * llama-server 反向代理：
 * 应用对外暴露的端口实际由 proxy 监听，llama-server 绑定 127.0.0.1 内部端口，
 * 这样所有请求（含外部应用直连）都经过 proxy，可记录
 *   ip + api key + 端点 + 时间 + 模型 + tokens。
 * 流式（SSE）响应按 chunk 直通（不阻塞客户端），同时旁路解析 usage/model。
 */

export const PROXY_INTERNAL_MARK = 'x-zhumora-internal'

export interface CapturedRequest {
  ip: string
  apiKey: string
  endpoint: string
  status: number
  model?: string
  promptTokens?: number
  completionTokens?: number
  durationMs?: number
}

export type RequestLogger = (entry: CapturedRequest) => void

export interface ProxyHandle {
  server: http.Server
  internalHost: string
  internalPort: number
  close: () => void
}

/** 找一个空闲端口 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as AddressInfo | null
      const port = addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

function bearerKey(req: http.IncomingMessage): string {
  const auth = String(req.headers.authorization ?? '')
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ''
}

function endpointOf(req: http.IncomingMessage): string {
  try {
    return `${req.method ?? 'GET'} ${new URL(req.url ?? '/', 'http://x').pathname}`
  } catch {
    return req.url ?? ''
  }
}

export function startProxy(
  bindHost: string,
  bindPort: number,
  internalHost: string,
  internalPort: number,
  log: RequestLogger
): Promise<ProxyHandle> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const mark = req.headers[PROXY_INTERNAL_MARK]
      const internal = Array.isArray(mark) ? mark[0] : mark
      const fwdHeaders: http.OutgoingHttpHeaders = { ...req.headers }
      delete fwdHeaders[PROXY_INTERNAL_MARK]

      const startedAt = Date.now()
      const captured: CapturedRequest = {
        ip: req.socket.remoteAddress ?? '?',
        apiKey: bearerKey(req),
        endpoint: endpointOf(req),
        status: 0
      }
      let logged = false
      const finish = (): void => {
        if (internal || logged) return
        logged = true
        captured.durationMs = Date.now() - startedAt
        log(captured)
      }

      const upstream = http.request(
        { host: internalHost, port: internalPort, method: req.method, path: req.url, headers: fwdHeaders },
        (up) => {
          captured.status = up.statusCode ?? 502
          const ctype = String(up.headers['content-type'] ?? '')
          const isSse = /text\/event-stream/i.test(ctype)

          res.writeHead(up.statusCode ?? 502, up.headers)
          if (!isSse) {
            // 非流式：边收边转发，同时累积（封顶 8MB）用于解析 model + usage
            const cap = 8 * 1024 * 1024
            let acc = Buffer.alloc(0)
            let capped = false
            up.on('data', (c: Buffer) => {
              res.write(c)
              if (!capped) {
                acc = Buffer.concat([acc, c])
                if (acc.length > cap) {
                  capped = true
                  acc = Buffer.alloc(0)
                }
              }
            })
            up.on('end', () => {
              if (!capped && acc.length > 0) {
                try {
                  const json = JSON.parse(acc.toString('utf8'))
                  if (typeof json.model === 'string') captured.model = json.model
                  if (json.usage) {
                    captured.promptTokens = json.usage.prompt_tokens
                    captured.completionTokens = json.usage.completion_tokens
                  }
                } catch {
                  // 非 JSON（如 4xx 文本）忽略
                }
              }
              res.end()
              finish()
            })
            up.on('error', () => {
              if (!res.writableEnded) res.end()
              finish()
            })
          } else {
            // 流式：直通转发，同时旁路解析 SSE 行
            const decoder = new TextDecoder()
            let sseBuffer = ''
            const onData = (c: Buffer): void => {
              res.write(c)
              sseBuffer += decoder.decode(c, { stream: true })
              const lines = sseBuffer.split('\n')
              sseBuffer = lines.pop() ?? ''
              for (const line of lines) {
                const t = line.trim()
                if (!t.startsWith('data:')) continue
                const data = t.slice(5).trim()
                if (!data || data === '[DONE]') continue
                try {
                  const json = JSON.parse(data)
                  if (typeof json.model === 'string' && !captured.model) captured.model = json.model
                  if (json.usage) {
                    captured.promptTokens = json.usage.prompt_tokens
                    captured.completionTokens = json.usage.completion_tokens
                  }
                } catch {
                  // 非 JSON 行忽略
                }
              }
            }
            up.on('data', onData)
            up.on('end', () => {
              res.end()
              finish()
            })
            up.on('error', () => {
              if (!res.writableEnded) res.end()
              finish()
            })
          }
        }
      )
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502)
        if (!res.writableEnded) res.end()
        captured.status = captured.status || 502
        finish()
      })
      // 客户端中断（如取消请求）：销毁上游连接，记一次记录
      res.on('close', () => {
        if (!res.writableEnded) {
          try {
            upstream.destroy()
          } catch {
            // ignore
          }
        }
        finish()
      })
      req.pipe(upstream)
    })

    server.on('error', (e) => reject(e))
    server.listen(bindPort, bindHost, () => {
      resolve({
        server,
        internalHost,
        internalPort,
        close: () => {
          server.close()
        }
      })
    })
  })
}
