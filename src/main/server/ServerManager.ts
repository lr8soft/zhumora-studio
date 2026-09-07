import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { dirname } from 'path'
import { buildArgs, paramsEqual, sanitizeParams } from '@shared/buildArgs'
import type { LaunchParams, ServerState, ServerLogEvent, Settings } from '@shared/types'

const HEALTH_POLL_MS = 1000
const HEALTH_TIMEOUT_MS = 120000 // 大模型加载慢，给 2 分钟
const STOP_GRACE_MS = 3000
const LOG_TAIL = 200

type StateListener = (state: ServerState) => void
type LogListener = (log: ServerLogEvent) => void

export class ServerManager {
  private state: ServerState = { state: 'stopped' }
  private proc: ChildProcess | null = null
  private logs: string[] = []
  private healthTimer: NodeJS.Timeout | null = null
  private stopTimer: NodeJS.Timeout | null = null
  private stateListener: StateListener | null = null
  private logListener: LogListener | null = null
  private lastParams: LaunchParams | null = null
  private stopping = false

  constructor(private getSettings: () => Settings) {}

  onState(cb: StateListener): void {
    this.stateListener = cb
  }
  onLog(cb: LogListener): void {
    this.logListener = cb
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

  async start(params: LaunchParams, runtimeBinary?: string): Promise<void> {
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
    const args = buildArgs(params)

    this.stopping = false
    this.lastParams = params
    const host = typeof params.host === 'string' && params.host ? params.host : '127.0.0.1'
    const port = typeof params.port === 'number' ? params.port : 1234

    this.setState({
      state: 'starting',
      host,
      port,
      modelPath,
      error: undefined,
      startedAt: Date.now()
    })
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

    this.setState({ ...this.state, pid: proc.pid })
    this.pollHealth(host, port, binary)
  }

  async stop(): Promise<void> {
    if (!this.proc || this.state.state === 'stopped') return
    this.stopping = true
    this.clearHealthTimer()
    this.setState({ state: 'stopping' })
    const proc = this.proc
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

  private pollHealth(host: string, port: number, _binary: string): void {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    const tick = async () => {
      if (this.stopping || !this.proc) return
      try {
        const res = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(2000) })
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
