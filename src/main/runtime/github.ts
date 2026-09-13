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

// bin-win asset 命名：llama-b10936-bin-win-cuda-12.4-x64.zip
// 注意变体段含连字符（cuda-12.4 / opencl-adreno），必须允许 -
const ASSET_RE = /^llama-(b\d+)-bin-win-([\w.-]+)-(\w+)\.zip$/
// CUDA 变体的运行时 dll（cudart/cublas）在独立伴生包里：cudart-llama-bin-win-cuda-12.4-x64.zip
const CUDART_RE = /^cudart-llama-(b\d+)-bin-win-cuda-([\w.-]+)-(\w+)\.zip$/

/**
 * 取最新 nightly release 的 bin-win assets。
 * 注意：/releases/latest 指向 stable（无二进制），必须遍历列表找第一个
 * prerelease 且 tag 匹配 b\d+ 的 release。
 */
export async function fetchWinAssets(): Promise<{ version: string; assets: RuntimeAsset[] }> {
  const res = await fetch(`${API}/releases?per_page=10`, {
    headers: { 'User-Agent': 'zhumora-studio', Accept: 'application/vnd.github+json' }
  })
  if (!res.ok) throw new Error(`GitHub API 请求失败: HTTP ${res.status}`)
  const releases = (await res.json()) as GhRelease[]

  const target = releases.find((r) => r.prerelease && /^b\d+$/.test(r.tag_name))
  if (!target) throw new Error('未找到带 bin-win 构建的 nightly release')

  const assets: RuntimeAsset[] = []
  for (const a of target.assets) {
    const m = a.name.match(ASSET_RE)
    if (!m) continue
    assets.push({
      name: a.name,
      version: m[1],
      variant: m[2],
      arch: m[3],
      size: a.size,
      sha256: a.digest?.replace(/^sha256:/, ''),
      url: a.browser_download_url
    })
  }
  if (assets.length === 0) throw new Error('该 release 没有 bin-win 构建')

  // 为 cuda 变体挂上 cudart 伴生包（缺了它 ggml-cuda.dll 加载会失败）
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

  return { version: target.tag_name, assets }
}
