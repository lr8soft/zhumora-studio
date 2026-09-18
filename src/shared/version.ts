/** 解析 llama.cpp nightly build 号："b10951" → 10951。无法解析返回 0。 */
export function buildNum(tag: string | undefined | null): number {
  const m = (tag ?? '').match(/(\d+)/)
  return m ? Number(m[1]) : 0
}

/**
 * 构建号比较：b10951 > b10936。
 * 返回值 >0 表示 a 更新、<0 表示 a 更旧、0 表示相同。
 * 用于判断"当前已安装的 runtime 是否有更新版本可下载"。
 */
export function compareVersions(a: string | undefined | null, b: string | undefined | null): number {
  return buildNum(a) - buildNum(b)
}
