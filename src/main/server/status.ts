import { execFile } from 'child_process'
import { readFileSync } from 'fs'
import { cpus, totalmem, freemem } from 'os'
import { promisify } from 'util'
import type { ServerStatus } from '@shared/types'

const pexecFile = promisify(execFile)
const IS_WIN = process.platform === 'win32'
const IS_LINUX = process.platform === 'linux'

type ProcStat = { cpu: number; memoryMB: number }

/**
 * 进程实时占用（CPU % + 内存 MB），按平台实现：
 * - Windows：PowerShell Get-Process 两次采样（wmic 已在 Win11 24H2 移除；
 *   CIM 的 PCT_Process 是速率计数器不可靠，改用 CPU 时间差）
 * - Linux：/proc/<pid>/stat 两次采样（utime+stime 差值）+ /proc/<pid>/statm 读 RSS
 * - macOS：ps 两次采样（%cpu 为进程生命周期均值，近似处理）
 */
async function processStatWin(pid: number): Promise<ProcStat | null> {
  const ps =
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
    `if (-not $p) { Write-Output "[]"; exit 0 }; ` +
    `$c1 = $p.CPU; $ws1 = $p.WorkingSet64; ` +
    `Start-Sleep -Milliseconds 400; ` +
    `$p2 = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
    `if (-not $p2) { Write-Output "[]"; exit 0 }; ` +
    `$cpu = 0; if ($null -ne $c1 -and $null -ne $p2.CPU) { $cpu = [math]::Max(0, ($p2.CPU - $c1) / 0.4 * 100) }; ` +
    `Write-Output ("[" + [math]::Round($cpu, 1) + "," + [math]::Round($ws1 / 1MB, 1) + "]")`
  try {
    const { stdout } = await pexecFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 8000 })
    const m = stdout.match(/\[(-?\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\]/)
    if (!m) return null
    const cpu = Number(m[1])
    const memoryMB = Number(m[2])
    return Number.isFinite(cpu) && Number.isFinite(memoryMB) ? { cpu, memoryMB } : null
  } catch {
    return null
  }
}

async function processStatLinux(pid: number): Promise<ProcStat | null> {
  const readTimes = (): { utime: number; stime: number } | null => {
    try {
      const s = readFileSync(`/proc/${pid}/stat`, 'utf8')
      // comm（字段 2）可能含空格，从最后一个 ')' 后切分：
      // 之后第 1 个是 state（字段 3），utime=字段 14 → 索引 11，stime=字段 15 → 索引 12
      const f = s.slice(s.lastIndexOf(')') + 1).split(/\s+/)
      return { utime: Number(f[11]) || 0, stime: Number(f[12]) || 0 }
    } catch {
      return null
    }
  }
  const readRssMB = (): number | null => {
    try {
      const pages = Number(readFileSync(`/proc/${pid}/statm`, 'utf8').trim().split(/\s+/)[1])
      return Number.isFinite(pages) ? Math.round((pages * 4) / 1024 * 10) / 10 : null // 页 4KB
    } catch {
      return null
    }
  }
  const a = readTimes()
  if (!a) return null
  await new Promise((r) => setTimeout(r, 400))
  const b = readTimes()
  const memoryMB = readRssMB()
  if (!b || memoryMB === null) return null
  const cpu = Math.max(0, (((b.utime + b.stime) - (a.utime + a.stime)) / 100 / 0.4) * 100) // USER_HZ=100
  return { cpu: Math.round(cpu * 10) / 10, memoryMB }
}

async function processStatMacOS(pid: number): Promise<ProcStat | null> {
  const readOnce = async (): Promise<{ cpu: number; rssKB: number } | null> => {
    try {
      const { stdout } = await pexecFile('ps', ['-o', '%cpu,rss', '-p', String(pid)], { timeout: 5000 })
      const line = stdout.split(/\r?\n/).slice(1).find((l) => l.trim())
      if (!line) return null
      const [cpu, rss] = line.trim().split(/\s+/)
      return { cpu: Number(cpu) || 0, rssKB: Number(rss) || 0 }
    } catch {
      return null
    }
  }
  const a = await readOnce()
  if (!a) return null
  // macOS 的 ps %cpu 是生命周期均值，无法做差值，第二次采样直接取用
  await new Promise((r) => setTimeout(r, 400))
  const b = (await readOnce()) ?? a
  return { cpu: Math.round(b.cpu * 10) / 10, memoryMB: Math.round(b.rssKB / 1024 * 10) / 10 }
}

async function processStat(pid: number): Promise<ProcStat | null> {
  try {
    if (IS_WIN) return await processStatWin(pid)
    if (IS_LINUX) return await processStatLinux(pid)
    return await processStatMacOS(pid)
  } catch {
    return null
  }
}

/** 系统 CPU 负载 %：两次采样所有核心的 idle/total 差值（跨平台） */
async function systemCpuLoad(): Promise<number | undefined> {
  const sample = (): { total: number; idle: number } => {
    try {
      const cores = cpus()
      if (cores.length > 0) {
        let total = 0
        let idle = 0
        for (const c of cores) {
          const t = c.times
          total += t.user + t.nice + t.sys + t.irq + t.idle
          idle += t.idle
        }
        return { total, idle }
      }
    } catch {
      // 落到 /proc/stat
    }
    if (IS_LINUX) {
      try {
        const n = readFileSync('/proc/stat', 'utf8')
          .split('\n')[0]
          .split(/\s+/)
          .slice(1)
          .map(Number)
        return { total: n.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0), idle: n[3] || 0 }
      } catch {
        // ignore
      }
    }
    return { total: 0, idle: 0 }
  }
  try {
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

/** GPU 实时状态：NVIDIA 走 nvidia-smi；AMD(Linux) 走 rocm-smi；Apple Silicon 暂无稳定 CLI，留空 */
async function gpus(): Promise<ServerStatus['gpus']> {
  const out: ServerStatus['gpus'] = []
  if (IS_WIN || IS_LINUX) {
    try {
      const { stdout } = await pexecFile(
        'nvidia-smi',
        [
          '--query-gpu=index,name,driver_version,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw',
          '--format=csv,noheader,nounits'
        ],
        { timeout: 8000 }
      )
      for (const line of stdout.split(/\r?\n/)) {
        const p = line.split(',').map((s) => s.trim())
        if (p.length < 7) continue
        out.push({
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
    } catch {
      // 非 NVIDIA 机器没有 nvidia-smi
    }
    if (out.length === 0 && IS_LINUX) {
      try {
        const { stdout } = await pexecFile('rocm-smi', ['--showmeminfo', 'vram', '--showuse', '--csv'], {
          timeout: 8000
        })
        const lines = stdout.trim().split(/\r?\n/).filter((l) => l.trim())
        if (lines.length >= 2) {
          const header = lines[0].split(',').map((s) => s.trim().toLowerCase())
          const idxOf = (part: string) => header.findIndex((h) => h.includes(part))
          const gi = idxOf('gpu') // 首个 GPU 列 = 卡序号
          const ti = idxOf('vram total memory')
          const ui = idxOf('vram total used memory')
          const ci = idxOf('gpu use')
          if (gi >= 0 && ti >= 0 && ui >= 0) {
            for (const line of lines.slice(1)) {
              const p = line.split(',').map((s) => s.trim())
              out.push({
                index: Number(p[gi]) || 0,
                name: 'AMD GPU',
                driver: '',
                memTotalMB: Math.round((Number(p[ti]) || 0) / 1048576),
                memUsedMB: Math.round((Number(p[ui]) || 0) / 1048576),
                utilPct: ci >= 0 ? Math.round(Number(p[ci]) || 0) : 0,
                tempC: 0,
                powerW: 0
              })
            }
          }
        }
      } catch {
        // 未装 rocm 工具
      }
    }
  }
  return out
}

/** 汇总一次运行状态快照（server 进程 + 系统 CPU/内存 + GPU） */
export async function collectServerStatus(state: ServerStatus['state']): Promise<ServerStatus> {
  const [procStat, cpuLoad, gpusList] = await Promise.all([
    state.pid && state.state !== 'stopped' ? processStat(state.pid) : Promise.resolve(null),
    systemCpuLoad(),
    gpus()
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
    gpus: gpusList
  }
}
