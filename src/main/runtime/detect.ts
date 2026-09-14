import { execFile } from 'child_process'
import { promisify } from 'util'
import { cpus } from 'os'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { GpuProbeResult, RuntimeAsset } from '@shared/types'

const pexecFile = promisify(execFile)

/** 显卡列表（按平台）：Windows → CIM；Linux → lspci；macOS → system_profiler。失败返回 [] */
async function listAdapters(): Promise<string[]> {
  const clean = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  try {
    if (process.platform === 'win32') {
      const { stdout } = await pexecFile('powershell', [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"
      ])
      return clean(stdout)
    }
    if (process.platform === 'linux') {
      // 首选 nvidia-smi：NVIDIA 机器上 lspci 常常缺失，而 nvidia-smi 随驱动安装，
      // 且给出的就是产品名（如 "NVIDIA GeForce RTX 3090"）
      try {
        const { stdout } = await pexecFile('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {
          timeout: 8000
        })
        const names = clean(stdout).filter((n) => n.length > 0)
        if (names.length > 0) return [...new Set(names)]
      } catch {
        // 无 NVIDIA 驱动 → 落到 lspci
      }
      // lspci：取 VGA/3D/Display 控制器，去掉末尾的 PCI ID
      const { stdout } = await pexecFile('lspci', ['nn'], { timeout: 8000 })
      const list = clean(stdout)
        .filter((l) => /VGA|3D controller|Display controller/i.test(l))
        .map((l) => l.replace(/\s*\[[0-9a-f]{4}:[0-9a-f]{4}\](\s*\[.*\])?$/i, '').trim())
      if (list.length > 0) return list
      // lspci 也不可用：读 /sys 的 DRM 节点（纯内核接口，任何发行版都有）
      const sysDrm = '/sys/class/drm'
      const out: string[] = []
      for (const card of readdirSync(sysDrm)) {
        if (!/^card\d+$/.test(card)) continue
        try {
          const dev = readFileSync(join(sysDrm, card, 'device', 'vendor'), 'utf8').trim()
          if (dev) out.push(`GPU (${dev})`)
        } catch {
          // 节点不存在（非 GPU 的 card，如 card0-Virtual-1）
        }
      }
      return out
    }
    if (process.platform === 'darwin') {
      // system_profiler 的 "Chipset Model: Apple M3" 行
      const { stdout } = await pexecFile('system_profiler', ['SPDisplaysDataType'], { timeout: 15000 })
      return clean(stdout)
        .filter((l) => /^Chipset Model:/i.test(l))
        .map((l) => l.replace(/^Chipset Model:\s*/i, ''))
    }
  } catch {
    return []
  }
  return []
}

/** GPU 探测：架构 + 视频适配器 + NVIDIA 驱动版本。失败不抛，返回 error。 */
export async function probeGpu(): Promise<GpuProbeResult> {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const platform =
    process.platform === 'win32' ? ('win' as const) : process.platform === 'darwin' ? ('macos' as const) : ('linux' as const)
  const result: GpuProbeResult = { arch, platform, adapters: [] }
  try {
    result.adapters = await listAdapters()
  } catch (err) {
    result.error = (err as Error).message
  }
  if (result.adapters.some((a) => /nvidia/i.test(a))) {
    try {
      const { stdout } = await pexecFile('nvidia-smi', [
        '--query-gpu=driver_version',
        '--format=csv,noheader'
      ])
      result.nvidiaDriver = stdout.split(/\r?\n/)[0]?.trim()
    } catch {
      // nvidia-smi 不可用，驱动未知
    }
  }
  return result
}

function driverMajor(driver?: string): number {
  if (!driver) return 0
  const m = driver.match(/(\d{3})/)
  return m ? Number(m[1]) : 0
}

/**
 * 纯函数：根据探测结果 + 可用 assets 推荐变体。
 * 同族选最高版本（cuda 取最大版本号）。
 */
export function pickVariant(probe: GpuProbeResult, assets: RuntimeAsset[]): string {
  // 先按本机架构过滤；无匹配则不过滤（下载时会再校验）
  let pool = assets.filter((a) => a.arch === probe.arch)
  if (pool.length === 0) pool = assets

  const has = (family: string) => pool.some((a) => a.variant.startsWith(family))
  const best = (family: string): string | undefined => {
    const list = pool
      .filter((a) => a.variant.startsWith(family))
      .sort((a, b) => variantVersion(b.variant) - variantVersion(a.variant))
    return list[0]?.variant
  }

  const driver = driverMajor(probe.nvidiaDriver)
  const isNvidia = probe.adapters.some((a) => /nvidia/i.test(a))
  const isAmd = probe.adapters.some((a) => /amd|radeon/i.test(a))
  const isIntel = probe.adapters.some((a) => /intel|iris|arc/i.test(a))
  const isLinux = probe.platform === 'linux'

  if (isNvidia) {
    // 官方 Linux 构建没有 CUDA 变体（cuda 只有 bin-win）：
    // NVIDIA 用户的主路径是"指定自己编译的 CUDA 版 llama-server"（UI 引导），
    // 官方可下载构建里 Vulkan 同样支持 NVIDIA，作为可下载的推荐兜底
    if (isLinux) {
      if (has('vulkan')) return best('vulkan') ?? 'vulkan'
      if (has('cpu')) return 'cpu'
      return pool[0]?.variant ?? 'cpu'
    }
    if (driver >= 580 && has('cuda-13')) return best('cuda-13') ?? 'cuda'
    if (driver >= 528 && has('cuda-12')) return best('cuda-12') ?? 'cuda'
    // 驱动未知/过旧：给 cuda（保守），UI 可手改
    return has('cuda') ? best('cuda') ?? 'cuda' : 'cpu'
  }
  if (isAmd && has('vulkan')) return best('vulkan') ?? 'vulkan'
  if (isIntel && has('vulkan')) return best('vulkan') ?? 'vulkan'
  if (has('cpu')) return 'cpu'
  return pool[0]?.variant ?? 'cpu'
}

function variantVersion(variant: string): number {
  const m = variant.match(/(\d+)\.?(\d+)?/)
  if (!m) return 0
  return Number(m[1]) * 1000 + Number(m[2] ?? 0)
}

export function cpuThreadHint(): number {
  return cpus().length
}
