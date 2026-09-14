import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { dirname } from 'path'
import { buildArgs, paramsEqual, sanitizeParams } from '@shared/buildArgs'
import type { LaunchParams, ServerState, ServerLogEvent, Settings } from '@shared/types'
import { startProxy, findFreePort, PROXY_INTERNAL_MARK, type ProxyHandle } from './proxy'

const HEALTH_POLL_MS = 1000
const HEALTH_TIMEOUT_MS = 120000 // 大模型加载慢，给 2 分钟
const STOP_GRACE_MS = 3000
const LOG_TAIL = 200

type StateListener = (state: ServerState) => void
type LogListener = (log: ServerLogEvent) => void
type RequestLogListener = (entry: { ip: string; apiKey: string; endpoint: string; status: number }) => void

/**
 * 架构：llama-server 绑定 127.0.0.1:<internalPort>，
 * 对外端口 <port> 由反向代理监听（见 proxy.ts），所有请求（含外部应用）
 * 都经过代理 → 可记录 ip + api key + 端点 + 时间（用量统计的“调用记录”）。
 */
export class ServerManager {
  private state: ServerState = { state: 'stopped' }
  private proc: ChildProcess | null = null
  private proxy: ProxyHandle | null = null
  private logs: string[] = []
  private healthTimer: NodeJS.Timeout | null = null
  private stopTimer: NodeJS.Timeout | null = null
  private stateListener: StateListener | null = null
  private logListener: LogListener | null = null
  private requestLogListener: RequestLogListener | null = null
  private lastParams: LaunchParams | null = null
  private stopping = false

  constructor(private getSettings: () => Settings) {}

  onState(cb: StateListener): void {
    this.stateListener = cb
  }
  onLog(cb: LogListener): void {
    this.logListener = cb
  }
  onRequestLog(cb: RequestLogListener): void {
    this.requestLogListener = cb
  }

  getState(): ServerState {
    return {
      ...this.state,
      logTail: this.logs.slice(-LOG_TAIL / 5)
    }
  }

  getLogs(): string[] {
    return [...this.logs]
  }

  /** 二进制解析：settings.llamaBinary 优先，否则用已下载的 runtime */
  private resolveBinary(runtime: { binaryPath?: string }): string | null {
    const custom = this.getSettings().llamaBinary
    if (custom && existsSync(custom)) return custom
    if (runtime.binaryPath && existsSync(runtime.binaryPath)) return runtime.binaryPath
    return null
  }

  async start(
    params: LaunchParams,
    runtimeBinary?: string,
    runtimeInfo?: { version?: string; variant?: string }
  ): Promise<void> {
    if (this.state.state === 'starting' || this.state.state === 'ready') {
      throw new Error('server 正在运行，请先停止')
    }
    const modelPath = params.modelPath
    if (typeof modelPath !== 'string' || modelPath === '' || !existsSync(modelPath)) {
      throw new Error('模型文件不存在，请先选择模型')
    }
    const binary = this.resolveBinary({ binaryPath: runtimeBinary })
    if (!binary) {
      throw new Error(
        '未找到 llama-server。请在"运行时"页下载构建，或在设置中手动指定 llama-server 路径。'
      )
    }

    const host = typeof params.host === 'string' && params.host ? params.host : '127.0.0.1'
    const port = typeof params.port === 'number' ? params.port : 1234

    // 1) llama-server 内部端口（仅本机），对外走反向代理
    const internalPort = await findFreePort()
    const args = buildArgs(params)
    // 覆盖监听地址/端口：内部只绑 127.0.0.1:internalPort
    const hostIdx = args.indexOf('--host')
    if (hostIdx >= 0 && hostIdx + 1 < args.length) args[hostIdx + 1] = '127.0.0.1'
    else args.unshift('--host', '127.0.0.1')
    const portIdx = args.indexOf('--port')
    if (portIdx >= 0 && portIdx + 1 < args.length) args[portIdx + 1] = String(internalPort)
    else args.push('--port', String(internalPort))

    // 2) 对外代理
    this.stopping = false
    this.lastParams = params
    this.logs = []

    const proc = spawn(binary, args, {
      cwd: dirname(modelPath as string),
      windowsHide: true
    })
    this.proc = proc
    proc.stdout?.on('data', (d: Buffer) => this.appendLog('stdout', d))
    proc.stderr?.on('data', (d: Buffer) => this.appendLog('stderr', d))
    proc.on('error', (err) => {
      this.setState({
        state: 'error',
        error: `无法启动 llama-server: ${err.message}（检查二进制路径与 GPU 构建是否匹配）`
      })
    })
    proc.on('exit', (code, signal) => {
      this.proc = null
      this.clearHealthTimer()
      this.closeProxy()
      if (this.stopping) {
        this.setState({ state: 'stopped' })
        return
      }
      if (this.state.state === 'ready') {
        // 运行中意外退出
        this.setState({
          state: 'error',
          error: `llama-server 意外退出 (code=${code ?? signal})，见日志尾部`
        })
      } else if (this.state.state === 'starting') {
        this.setState({
          state: 'error',
          error: `llama-server 启动失败 (code=${code ?? signal})，见日志尾部`
        })
      } else {
        this.setState({ state: 'stopped' })
      }
    })

    let proxy: ProxyHandle
    try {
      proxy = await startProxy(host, port, '127.0.0.1', internalPort, (entry) => {
        this.requestLogListener?.(entry)
      })
    } catch (e) {
      await this.stop().catch(() => undefined)
      throw new Error(`无法监听端口 ${port}（被占用？）：${(e as Error).message}`)
    }
    this.proxy = proxy

    this.setState({
      state: 'starting',
      host,
      port,
      modelPath,
      error: undefined,
      startedAt: Date.now(),
      runtime: runtimeInfo
    })
    this.setState({ ...this.state, pid: proc.pid })
    this.pollHealth('127.0.0.1', internalPort)
  }

  async stop(): Promise<void> {
    if (!this.proc && !this.proxy) return
    this.stopping = true
    this.clearHealthTimer()
    this.closeProxy()
    const proc = this.proc
    if (!proc) {
      this.setState({ state: 'stopped' })
      return
    }
    this.setState({ state: 'stopping' })
    try {
      proc.kill('SIGTERM')
    } catch {
      // ignore
    }
    this.stopTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        // ignore
      }
    }, STOP_GRACE_MS)
  }

  private closeProxy(): void {
    if (this.proxy) {
      try {
        this.proxy.server.closeAllConnections?.()
      } catch {
        // ignore
      }
      this.proxy.close()
      this.proxy = null
    }
  }

  /** 健康检查走内部端口（带标记，不记入调用记录） */
  private pollHealth(host: string, port: number): void {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    const tick = async () => {
      if (this.stopping || !this.proc) return
      try {
        const res = await fetch(`http://${host}:${port}/health`, {
          headers: { [PROXY_INTERNAL_MARK]: '1' },
          signal: AbortSignal.timeout(2000)
        })
        if (res.ok) {
          this.setState({ state: 'ready', error: undefined })
          return
        }
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) {
        this.setState({ state: 'error', error: '健康检查超时（/health 未就绪），见日志尾部' })
        await this.stop().catch(() => undefined)
        return
      }
      this.healthTimer = setTimeout(tick, HEALTH_POLL_MS)
    }
    this.healthTimer = setTimeout(tick, HEALTH_POLL_MS)
  }

  private appendLog(stream: 'stdout' | 'stderr', data: Buffer): void {
    const lines = data.toString('utf8').split(/\r?\n/).filter((l) => l.length > 0)
    for (const line of lines) {
      this.logs.push(`[${stream === 'stderr' ? 'err' : 'out'}] ${line}`)
      this.logListener?.({ stream, line })
    }
    if (this.logs.length > 4000) this.logs.splice(0, this.logs.length - 4000)
  }

  private setState(patch: Partial<ServerState>): void {
    this.state = { ...this.state, ...patch }
    this.stateListener?.(this.getState())
  }

  private clearHealthTimer(): void {
    if (this.healthTimer) {
      clearTimeout(this.healthTimer)
      this.healthTimer = null
    }
  }

  /** 当前参数与上次启动是否一致（renderer 用于提示"需重启生效"） */
  isStale(params: LaunchParams): boolean {
    if (!this.lastParams) return false
    return !paramsEqual(params, this.lastParams)
  }

  sanitizedParams(): LaunchParams | null {
    return this.lastParams ? sanitizeParams(this.lastParams) : null
  }
}
