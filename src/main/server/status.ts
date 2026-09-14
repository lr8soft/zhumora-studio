import { execFile } from 'child_process'
import { cpus, totalmem, freemem } from 'os'
import { promisify } from 'util'
import type { ServerStatus } from '@shared/types'

const pexecFile = promisify(execFile)

/**
 * 进程实时占用：CPU % + 工作集 MB（PowerShell Get-Process；wmic 已在 Win11 24H2 移除）。
 * CPU 用两次采样的总 CPU 时间差 / 采样间隔（CIM 的 PCT_Process 是速率计数器，不可靠）。
 * 间隔取 400ms，与页面 2s 轮询错开，单次采集耗时 ~0.4s 可接受。
 */
async function processStat(pid: number): Promise<{ cpu: number; memoryMB: number } | null> {
  const ps =
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue ` +
    `if (-not $p) { "[]"; exit } ` +
    `$c1 = $p.CPU; $ws1 = $p.WorkingSet64 ` +
    `Start-Sleep -Milliseconds 400 ` +
    `$p2 = Get-Process -Id ${pid} -ErrorAction SilentlyContinue ` +
    `if (-not $p2) { "[]"; exit } ` +
    `$cpu = if ($null -ne $c1 -and $null -ne $p2.CPU) { [math]::Max(0, ($p2.CPU - $c1) / 0.4 * 100) } else { 0 } ` +
    `"[$([math]::Round($cpu, 1)), $([math]::Round($ws1 / 1MB, 1))]";`
  try {
    const { stdout } = await pexecFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 8000 })
    const m = stdout.match(/\[(-?\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\]/)
    if (!m) return null
    const cpu = Number(m[1])
    const memoryMB = Number(m[2])
    if (!Number.isFinite(cpu) || !Number.isFinite(memoryMB)) return null
    return { cpu, memoryMB }
  } catch {
    return null
  }
}

/** 系统 CPU 负载 %：两次采样所有核心时间差值 */
async function systemCpuLoad(): Promise<number | undefined> {
  try {
    const sample = () =>
      cpus().reduce(
        (acc, c) => ({
          total: acc.total + c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle,
          idle: acc.idle + c.times.idle
        }),
        { total: 0, idle: 0 }
      )
    const a = sample()
    await new Promise((r) => setTimeout(r, 300))
    const b = sample()
    const dt = b.total - a.total
    if (dt <= 0) return undefined
    return Math.max(0, Math.min(100, Math.round((1 - (b.idle - a.idle) / dt) * 100)))
  } catch {
    return undefined
  }
}

/** nvidia-smi 实时 GPU 状态（非 NVIDIA / 不可用返回 []） */
async function nvidiaGpus(): Promise<ServerStatus['gpus']> {
  try {
    const { stdout } = await pexecFile(
      'nvidia-smi',
      ['--query-gpu=index,name,driver_version,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw',
       '--format=csv,noheader,nounits'],
      { timeout: 8000 }
    )
    const gpus: ServerStatus['gpus'] = []
    for (const line of stdout.split(/\r?\n/)) {
      const p = line.split(',').map((s) => s.trim())
      if (p.length < 7) continue
      gpus.push({
        index: Number(p[0]) || 0,
        name: p[1] || 'GPU',
        driver: p[2] || '',
        memUsedMB: Math.round(Number(p[3]) || 0),
        memTotalMB: Math.round(Number(p[4]) || 0),
        utilPct: Math.round(Number(p[5]) || 0),
        tempC: Math.round(Number(p[6]) || 0),
        powerW: p[7] && p[7] !== '[N/A]' ? Math.round(Number(p[7]) || 0) : 0
      })
    }
    return gpus
  } catch {
    return []
  }
}

/** 汇总一次运行状态快照（server 进程 + 系统 CPU/内存 + GPU） */
export async function collectServerStatus(state: ServerStatus['state']): Promise<ServerStatus> {
  const [procStat, cpuLoad, gpus] = await Promise.all([
    state.pid && state.state !== 'stopped' ? processStat(state.pid) : Promise.resolve(null),
    systemCpuLoad(),
    nvidiaGpus()
  ])
  const totalMB = Math.round(totalmem() / 1048576)
  const usedMB = Math.round((totalmem() - freemem()) / 1048576)
  return {
    state,
    process: {
      pid: state.pid,
      cpu: procStat?.cpu,
      memoryMB: procStat?.memoryMB,
      uptimeSec: state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : undefined
    },
    cpu: {
      load: cpuLoad,
      cores: cpus().length,
      totalMB,
      usedMB
    },
    gpus
  }
}
