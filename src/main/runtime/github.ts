import type { RuntimeAsset } from '@shared/types'

const API = 'https://api.github.com/repos/ggml-org/llama.cpp'

interface GhAsset {
  name: string
  size: number
  digest?: string
  browser_download_url: string
}

interface GhRelease {
  tag_name: string
  prerelease: boolean
  assets: GhAsset[]
}

export type Platform = 'win' | 'linux' | 'macos'

const EXT: Record<Platform, string> = { win: 'zip', linux: 'tar.gz', macos: 'tar.gz' }

// release 的 bin 段平台名：Linux 构建的发行版段是 ubuntu（不是 linux）
const BIN_SEG: Record<Platform, string> = { win: 'win', linux: 'ubuntu', macos: 'macos' }

// asset 命名（bin 段按平台）：
//   llama-b10951-bin-win-cuda-12.4-x64.zip / -win-cpu-x64.zip / -win-vulkan-x64.zip
//   llama-b10951-bin-ubuntu-x64.tar.gz / -ubuntu-vulkan-x64.tar.gz / -ubuntu-rocm-10.0-x64.tar.gz
//   llama-b10951-bin-macos-arm64.tar.gz / -macos-x64.tar.gz
// 变体段可含连字符与点（cuda-12.4 / rocm-10.0 / opencl-adreno / sycl-fp32），
// 用贪婪 .+? 捕获；无变体段（如 ubuntu-x64）= cpu，由调用方兜底
export function assetRe(platform: Platform): RegExp {
  return new RegExp(`^llama-(b\\d+)-bin-${BIN_SEG[platform]}(?:-(.+?))?-(\\w+)\\.${EXT[platform]}$`)
}
// 仅 Windows 有：CUDA 变体的运行时 dll（cudart/cublas）独立伴生包，
// 文件名不带 build 号（cudart-llama-bin-win-cuda-12.4-x64.zip），组 1=cuda 版本、组 2=架构
export const CUDART_RE = /^cudart-llama-(?:b\d+-)?bin-win-cuda-([\w.-]+)-(\w+)\.zip$/

function platformOf(): Platform {
  return process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'macos' : 'linux'
}

/** 纯函数：从 release 列表选"最新的带资产 build"并解析 asset（可单测） */
export function listAssets(
  releases: GhRelease[],
  platform: Platform
): { tagName: string; skipped: string[]; assets: RuntimeAsset[] } {
  const bReleases = releases.filter((r) => r.prerelease && /^b\d+$/.test(r.tag_name))
  // 跳过 assets 为空的 release：nightly 先建 release 再传资产，
  // 刚发布的前几个 build 的 assets 可能还是 0（取第一个带本机平台资产的）
  const re = assetRe(platform)
  const target = bReleases.find((r) => r.assets.some((a) => re.test(a.name)))
  if (!target) {
    throw new Error(
      bReleases.length > 0
        ? `最新 nightly（${bReleases[0].tag_name}）的构建包还在上传中，稍后再试`
        : '未找到带预编译构建的 nightly release'
    )
  }
  const skipped = bReleases.slice(0, bReleases.indexOf(target)).map((r) => r.tag_name)

  const assets: RuntimeAsset[] = []
  for (const a of target.assets) {
    const m = a.name.match(re)
    if (!m) continue
    // ubuntu-x64.tar.gz 无变体段 = 纯 CPU 构建
    assets.push({
      name: a.name,
      version: m[1],
      variant: m[2] ?? 'cpu',
      arch: m[3],
      size: a.size,
      sha256: a.digest?.replace(/^sha256:/, ''),
      url: a.browser_download_url
    })
  }
  if (assets.length === 0) throw new Error('该 release 没有本机平台的预编译构建')

  // 仅 Windows：为 cuda 变体挂上 cudart 伴生包（缺了它 ggml-cuda.dll 加载会失败）
  if (platform === 'win') {
    for (const asset of assets) {
      if (!asset.variant.startsWith('cuda')) continue
      const found = target.assets.find((a) => {
        const m2 = a.name.match(CUDART_RE)
        // CUDART_RE 组：1=cuda 版本 2=架构；文件名不带 build 号，不校验 version
        return !!m2 && m2[1] === asset.variant.slice('cuda-'.length) && m2[2] === asset.arch
      })
      if (found) {
        asset.companion = {
          name: found.name,
          url: found.browser_download_url,
          size: found.size,
          sha256: found.digest?.replace(/^sha256:/, '')
        }
      }
    }
  }

  return { tagName: target.tag_name, skipped, assets }
}

/** 取最新 nightly release 的本机平台构建（网络层） */
export async function fetchPlatformAssets(): Promise<{
  version: string
  platform: Platform
  assets: RuntimeAsset[]
  skippedNewer: string[]
}> {
  const platform = platformOf()
  const res = await fetch(`${API}/releases?per_page=10`, {
    headers: { 'User-Agent': 'zhumora-studio', Accept: 'application/vnd.github+json' }
  })
  if (!res.ok) throw new Error(`GitHub API 请求失败: HTTP ${res.status}`)
  const releases = (await res.json()) as GhRelease[]
  const { tagName, skipped, assets } = listAssets(releases, platform)
  return {
    version: tagName,
    platform,
    assets,
    /** 比 target 更新、但资产还没传完的 build（用于 UI 提示） */
    skippedNewer: skipped
  }
}
