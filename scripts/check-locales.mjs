import { readFileSync } from 'fs'

const langs = ['en', 'zh', 'ja', 'es', 'fr', 'de']

/** 按缩进解析 locale ts 的全部 key 路径（值一律单行，够用） */
function keysOf(l) {
  const src = readFileSync(new URL(`../src/renderer/src/i18n/locales/${l}.ts`, import.meta.url), 'utf8')
  const out = new Set()
  const stack = [] // [indent, key]
  for (const raw of src.split('\n')) {
    if (!raw.trim() || /^\s*\/\//.test(raw)) continue
    const m = raw.match(/^(\s*)([\w$]+)\s*:(.*)$/)
    if (!m) continue
    const indent = m[1].length
    while (stack.length && stack[stack.length - 1][0] >= indent) stack.pop()
    stack.push([indent, m[2]])
    // '{' 视为对象；其余（含空值后的跨行字符串、单行字符串）视为叶子
    if (m[3].trim() !== '{') out.add(stack.map((s) => s[1]).join('.'))
  }
  return out
}

const ref = keysOf('en')
let bad = 0
for (const l of langs) {
  const cur = keysOf(l)
  for (const k of ref) if (!cur.has(k)) { console.log(`${l}: missing ${k}`); bad++ }
  for (const k of cur) if (!ref.has(k)) { console.log(`${l}: extra ${k}`); bad++ }
}
console.log(bad === 0 ? 'locale check ok (6 langs aligned)' : `${bad} mismatch(es)`)
