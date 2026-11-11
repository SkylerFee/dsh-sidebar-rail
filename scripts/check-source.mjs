#!/usr/bin/env node
/**
 * 源码规则检查：只看 `src/`，不看生成产物。
 *
 * 这些是 AGENTS.md 里「违反即否决」的硬约束中能用机械规则表达的部分；
 * 判断类规范仍在 CODING_STANDARDS.md。每条通过时打印一行，任何失败打印规则、
 * 文件与命中细节后以非零码退出。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const failures = []

/**
 * 记录一次失败而不抛出，让所有规则在一趟里都报告出来。
 * @param rule - 规则名。
 * @param detail - 命中细节。
 */
function fail(rule, detail) {
  failures.push(`${rule}: ${detail}`)
}

/**
 * 递归列出目录下的所有源码文件。
 * @param dir - 起始目录。
 * @returns 文件绝对路径数组。
 */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

const files = walk(join(root, 'src'))
const tsFiles = files.filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'))
const cssFiles = files.filter((path) => path.endsWith('.css'))

/**
 * 读取一个文件，失败时记一条 files 规则并返回空串。
 * @param path - 绝对路径。
 * @returns 文件内容。
 */
function read(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    fail('files', `unreadable ${path}`)
    return ''
  }
}

const sources = new Map(tsFiles.map((path) => [path, read(path)]))

// ------------------------------------------------------- 1. 否决性约束 --
// 单槽替换、宿主布局接管、危险 DOM 写入：全部来自 AGENTS.md 的硬约束。
{
  const banned = [
    [/name:\s*['"]sidebar['"]/, 'must not register the sidebar single slot (it unmounts the host settings shell)'],
    [/!important/, 'CSS must not use !important against host styles'],
    [/innerHTML\s*=/, 'no innerHTML writes'],
    [/document\.write\(/, 'no document.write'],
    [/:\s*any\b/, 'no explicit any type'],
    [/as\s+any\b/, 'no as-any casts'],
    [/@ts-ignore/, 'no @ts-ignore'],
    [/@ts-expect-error/, 'no @ts-expect-error'],
  ]
  const hits = []
  for (const [path, text] of sources) {
    for (const [pattern, why] of banned) {
      if (pattern.test(text)) hits.push(`${why} (${path.slice(root.length + 1)})`)
    }
  }
  for (const path of cssFiles) {
    if (/!important/.test(read(path))) hits.push(`CSS must not use !important (${path.slice(root.length + 1)})`)
  }
  for (const why of hits) fail('banned', why)
  if (hits.length === 0) console.log('ok  banned: no sidebar takeover, !important, HTML writes, any or ts-ignore')
}

// ------------------------------------------------------ 2. 运行时依赖 --
// 客户端运行期只许向宿主 require react / react-dom。
{
  const allowed = new Set(['react', 'react-dom'])
  const hits = []
  for (const [path, text] of sources) {
    for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const request = match[1]
      if (request.startsWith('.') || request.startsWith('node:')) continue
      if (allowed.has(request)) continue
      hits.push(`${request} (${path.slice(root.length + 1)})`)
    }
  }
  for (const why of hits) fail('runtime-deps', `client source imports ${why}; only react and react-dom may come from the host`)
  if (hits.length === 0) console.log('ok  runtime-deps: client source imports only react / react-dom')
}

// ------------------------------------------------------------ 3. i18n --
// 中英文字典的键集合必须完全一致，且每个 t('...') 都有对应条目。
{
  const locales = read(join(root, 'src/client/locales.ts'))
  const keysOf = (name) => {
    const start = locales.indexOf(`export const ${name}`)
    if (start === -1) return null
    const open = locales.indexOf('{', start)
    const close = locales.indexOf('\n}', open)
    if (open === -1 || close === -1) return null
    return new Set([...locales.slice(open, close).matchAll(/^\s*'([\w.]+)':/gm)].map((m) => m[1]))
  }
  const zhKeys = keysOf('zh')
  const enKeys = keysOf('en')
  if (zhKeys === null || enKeys === null || zhKeys.size === 0) {
    fail('i18n', 'could not locate the zh/en dictionaries in src/client/locales.ts')
  } else {
    for (const key of zhKeys) if (!enKeys.has(key)) fail('i18n', `"${key}" exists in zh but not en`)
    for (const key of enKeys) if (!zhKeys.has(key)) fail('i18n', `"${key}" exists in en but not zh`)
    // 静态字面量键；模板字面量的键（如 `status.${x}`）由类型约束兜住。
    const used = new Set()
    for (const [, text] of sources) {
      for (const match of text.matchAll(/\bt\(\s*'([\w.]+)'\s*\)/g)) used.add(match[1])
    }
    for (const key of used) {
      if (!zhKeys.has(key) || !enKeys.has(key)) fail('i18n', `t('${key}') has no dictionary entry`)
    }
    if (!failures.some((entry) => entry.startsWith('i18n:'))) {
      console.log(`ok  i18n: ${zhKeys.size} keys, zh/en aligned, every literal t() key defined`)
    }
  }
}

// --------------------------------------------------- 4. 模型层纯净性 --
// 模型层不得反向依赖组件、入口或 React / DOM。
{
  const modelFiles = [...sources.keys()].filter((path) => path.includes('/model/'))
  const hits = []
  for (const path of modelFiles) {
    const text = sources.get(path) ?? ''
    for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const request = match[1]
      if (request.startsWith('./') || request.startsWith('../model/')) continue
      if (request.startsWith('../model/')) continue
      hits.push(`${request} (${path.slice(root.length + 1)})`)
    }
  }
  for (const why of hits) fail('model-purity', `model module depends on ${why}; model must not import UI, entry or React`)
  if (hits.length === 0) console.log('ok  model-purity: model modules stay free of UI, entry and React imports')
}

// ------------------------------------------------- 5. CSS 颜色只走宿主 token --
// 硬编码色值会让浮层在深/浅色主题下与宿主脱节（spec §4.6 的验收口径是「全部走
// 宿主 token」）。只允许 var(--...)、transparent 与 currentColor。
{
  const banned = [
    [/#[0-9a-fA-F]{3,8}\b/g, 'hex colour'],
    [/\brgba?\(/g, 'rgb()/rgba() colour'],
    [/\bhsla?\(/g, 'hsl()/hsla() colour'],
  ]
  const hits = []
  for (const path of cssFiles) {
    const text = read(path)
    for (const [pattern, why] of banned) {
      for (const match of text.matchAll(pattern)) {
        // 行号便于定位；不打印整行，避免把长规则回显到终端。
        const line = text.slice(0, match.index).split('\n').length
        hits.push(`${why} at line ${line} (${path.slice(root.length + 1)})`)
      }
    }
  }
  for (const why of hits) fail('颜色', why)
  if (hits.length === 0 && cssFiles.length > 0) {
    console.log('ok  颜色: stylesheets use only host tokens, transparent or currentColor')
  }
}

// ------------------------------------------------------- 6. 文件规模 --
// 单文件过大是「所有实现挤在一处」的回归信号。
{
  const LIMIT = 700
  for (const path of tsFiles) {
    const lines = (sources.get(path) ?? '').split('\n').length
    if (lines > LIMIT) fail('size', `${path.slice(root.length + 1)} has ${lines} lines (limit ${LIMIT})`)
  }
  if (!failures.some((entry) => entry.startsWith('size:'))) console.log(`ok  size: every source file stays under ${LIMIT} lines`)
}

// ------------------------------------------------- 7. 滚动标题的布局前提 --
// 会话标题靠 overflow:hidden + 自身 scrollLeft 滚动（use-title-marquee）。这条链路
// 只在标题被真正裁剪时成立：标题是 .dsr-row-main（column flex）的 flex item，
// 缺 min-width:0 时它会撑到内容宽度，clientWidth === scrollWidth，于是省略号与
// 滚动都静默失效——2026-11-11 的真机缺陷正是这样来的，而且没有任何 JS 报错。
// 因此把「标题规则必须带 min-width:0」变成机械检查。
{
  const cssText = cssFiles.map((path) => read(path)).join('\n')
  const titleRule = /\.dsr-row-title\s*\{([^}]*)\}/.exec(cssText)
  if (titleRule === null) {
    fail('滚动标题', 'no .dsr-row-title rule found; the marquee relies on it to clip')
  } else if (!/min-width\s*:\s*0/.test(titleRule[1])) {
    fail('滚动标题', '.dsr-row-title must set min-width:0 or the title never clips (no ellipsis, no marquee)')
  } else if (!/overflow\s*:\s*hidden/.test(titleRule[1])) {
    fail('滚动标题', '.dsr-row-title must set overflow:hidden so scrollLeft has somewhere to travel')
  } else {
    console.log('ok  滚动标题: the title clips itself (min-width:0 + overflow:hidden) before scrolling')
  }
}

// --------------------------------------------------------- reporting --
if (failures.length > 0) {
  console.error(`\n${failures.length} source check(s) failed:`)
  for (const entry of failures) console.error(`  - ${entry}`)
  process.exit(1)
}
console.log('\nall source checks passed')

