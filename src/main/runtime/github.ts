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

type Platform = 'win' | 'linux' | 'macos'

const EXT: Record<Platform, string> = { win: 'zip', linux: 'tar.gz', macos: 'tar.gz' }

// asset 命名（bin 段按平台）：
//   llama-b10951-bin-win-cuda-12.4-x64.zip / -win-cpu-x64.zip / -win-vulkan-x64.zip
//   llama-b10951-bin-ubuntu-x64.tar.gz / -ubuntu-vulkan-x64.tar.gz / -ubuntu-rocm-10.0-x64.tar.gz
//   llama-b10951-bin-macos-arm64.tar.gz / -macos-x64.tar.gz
// 注意变体段可含连字符（cuda-12.4 / opencl-adreno / rocm-10.0），必须允许 -
function assetRe(platform: Platform): RegExp {
  return new RegExp(`^llama-(b\\d+)-bin-${platform}(-[\\w.]+)?-(\\w+)\\.${EXT[platform]}$`)
}
// 仅 Windows 有：CUDA 变体的运行时 dll（cudart/cublas）独立伴生包
const CUDART_RE = /^cudart-llama-(b\d+)-bin-win-cuda-([\w.-]+)-(\w+)\.zip$/

function platformOf(): Platform {
  return process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'macos' : 'linux'
}

/**
 * 取最新 nightly release 的本机平台构建。
 * 注意：/releases/latest 指向 stable（无二进制），必须遍历列表找第一个
 * prerelease 且 tag 匹配 b\d+ 的 release。
 */
export async function fetchPlatformAssets(): Promise<{ version: string; platform: Platform; assets: RuntimeAsset[] }> {
  const platform = platformOf()
  const res = await fetch(`${API}/releases?per_page=10`, {
    headers: { 'User-Agent': 'zhumora-studio', Accept: 'application/vnd.github+json' }
  })
  if (!res.ok) throw new Error(`GitHub API 请求失败: HTTP ${res.status}`)
  const releases = (await res.json()) as GhRelease[]

  const target = releases.find((r) => r.prerelease && /^b\d+$/.test(r.tag_name))
  if (!target) throw new Error('未找到带预编译构建的 nightly release')

  const re = assetRe(platform)
  const assets: RuntimeAsset[] = []
  for (const a of target.assets) {
    const m = a.name.match(re)
    if (!m) continue
    // ubuntu-x64.tar.gz 无变体段 = 纯 CPU 构建
    assets.push({
      name: a.name,
      version: m[1],
      variant: m[2] ? m[2].slice(1) : 'cpu',
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
        return !!m2 && m2[1] === asset.version && m2[2] === asset.variant.slice(4) && m2[3] === asset.arch
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

  return { version: target.tag_name, platform, assets }
}
