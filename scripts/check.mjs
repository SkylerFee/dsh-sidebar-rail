#!/usr/bin/env node
/**
 * Repository checks that a linter would normally own.
 *
 * This repo deliberately carries no dev dependencies and no build step: the
 * client half must stay a hand-written static module that the host can load
 * as-is (see docs/adr/0002). So the mechanical rules live here, in plain Node,
 * and `npm run check` is the single entry point that CI, the pre-commit hook and
 * `prepublishOnly` all call.
 *
 * Every check prints one line on success. Any failure prints the rule, the file
 * and the offending detail, then exits non-zero.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const failures = []

/** Record a failed check without throwing, so every rule reports in one pass. */
function fail(rule, detail) {
  failures.push(`${rule}: ${detail}`)
}

/** Read a file from the repo root, recording a failure instead of throwing. */
function read(file) {
  const path = join(root, file)
  if (!existsSync(path)) {
    fail('files', `missing ${file}`)
    return ''
  }
  return readFileSync(path, 'utf8')
}

const pkg = JSON.parse(read('package.json'))
const client = read('client.js')

// ---------------------------------------------------------------- 1. regions --
// The unit tests slice helper functions out of client.js by these markers. If a
// marker is lost the slice silently shrinks and the tests keep passing against
// less code than they claim to cover.
{
  const regions = ['pure-helpers', 'pure-data']
  for (const name of regions) {
    const opens = client.split(`// #region ${name}`).length - 1
    const closes = client.split(`// #endregion ${name}`).length - 1
    if (opens !== 1 || closes !== 1) {
      fail('regions', `expected exactly one open/close pair for "${name}", found ${opens}/${closes}`)
      continue
    }
    const start = client.indexOf(`// #region ${name}`)
    const end = client.indexOf(`// #endregion ${name}`)
    if (end <= start) fail('regions', `"${name}" closes before it opens`)
  }
  const tests = read('test/data.test.mjs')
  if (!tests.includes("region('pure-helpers')") || !tests.includes("region('pure-data')")) {
    fail('regions', 'test/data.test.mjs no longer slices both regions')
  }
  if (!failures.some(entry => entry.startsWith('regions:'))) console.log('ok  regions: pure-helpers and pure-data are paired and sliced')
}

// -------------------------------------------------------------- 2. manifest --
// 包名、模块 ID 与补丁模块名必须完整一致；宿主按完整包名查找客户端工厂。
{
  const moduleId = /window\.__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(client)?.[1]
  if (moduleId !== pkg.name) {
    fail('manifest', `client.js registers id "${moduleId}" but the package is named "${pkg.name}" (expected "${pkg.name}")`)
  }

  const patch = pkg.dsh?.bundle?.patch
  if (typeof patch !== 'string') {
    fail('manifest', 'dsh.bundle.patch is missing')
  } else if (!existsSync(join(root, patch))) {
    fail('manifest', `dsh.bundle.patch points at missing ${patch}`)
  } else {
    const patchName = /^\s+name:\s*'([^']+)'\s*$/m.exec(read(patch))?.[1]
    if (patchName !== pkg.name) {
      fail('manifest', `${patch} loads "${patchName}" but the package is named "${pkg.name}"`)
    }
  }

  const clientExport = pkg.exports?.['./client']
  if (clientExport !== './client.js') {
    fail('manifest', `exports["./client"] should be ./client.js, found ${JSON.stringify(clientExport)}`)
  }

  for (const [key, target] of Object.entries(pkg.exports ?? {})) {
    if (typeof target !== 'string') continue
    if (target.includes('*')) {
      const dir = join(root, dirname(target))
      if (!existsSync(dir) || readdirSync(dir).filter(entry => entry.endsWith(extname(target))).length === 0) {
        fail('manifest', `exports["${key}"] matches no files under ${dirname(target)}`)
      }
      continue
    }
    if (!existsSync(join(root, target))) fail('manifest', `exports["${key}"] points at missing ${target}`)
  }

  for (const entry of pkg.files ?? []) {
    if (entry.includes('*')) {
      const dir = join(root, dirname(entry))
      if (!existsSync(dir)) fail('manifest', `files entry "${entry}" matches no directory`)
      continue
    }
    if (!existsSync(join(root, entry))) fail('manifest', `files entry "${entry}" does not exist`)
  }

  if (!failures.some(entry => entry.startsWith('manifest:'))) console.log(`ok  manifest: id "${moduleId}", exports, files and bundle patch agree`)
}

// ----------------------------------------------------------- 3. banned code --
// The hard constraints from AGENTS.md that a reviewer would otherwise have to
// remember: never take over the shipped sidebar, never fight the host layout,
// never pull in a module the platform does not seed.
{
  const banned = [
    [/!important/, 'CSS must not use !important against host styles'],
    [/name:\s*'sidebar'/, 'must not register the sidebar slot (it unmounts the host settings shell)'],
    [/require\(\s*'(?!react'|react-dom')/, 'only react and react-dom may be required'],
    [/innerHTML\s*=/, 'no innerHTML writes'],
    [/document\.write\(/, 'no document.write'],
  ]
  const hits = banned.filter(([pattern]) => pattern.test(client)).map(([, why]) => why)
  for (const why of hits) fail('banned', why)
  if (hits.length === 0) console.log('ok  banned: no !important, sidebar takeover, stray require or HTML writes')
}

// ----------------------------------------------------------------- 4. i18n --
// Both dictionaries feed the same UI, and a key only present on one side renders
// the raw key for half the users.
{
  const dictOf = (name) => {
    const start = client.indexOf(`const ${name} = {`)
    if (start === -1) return ''
    const end = client.indexOf('\n    }\n', start)
    return end === -1 ? '' : client.slice(start, end)
  }
  const zhBlock = dictOf('zh')
  const enBlock = dictOf('en')
  if (zhBlock === '' || enBlock === '') fail('i18n', 'could not locate the zh/en dictionaries in client.js')
  const keysOf = block => [...block.matchAll(/^\s+'([\w.]+)':/gm)].map(match => match[1])
  const zh = new Set(keysOf(zhBlock))
  const en = new Set(keysOf(enBlock))

  for (const key of zh) if (!en.has(key)) fail('i18n', `"${key}" exists in zh but not en`)
  for (const key of en) if (!zh.has(key)) fail('i18n', `"${key}" exists in en but not zh`)

  const used = new Set([...client.matchAll(/\bt\('([\w.]+)'\)/g)].map(match => match[1]))
  for (const key of used) {
    if (!zh.has(key) || !en.has(key)) fail('i18n', `t('${key}') has no dictionary entry`)
  }
  if (!failures.some(entry => entry.startsWith('i18n:'))) console.log(`ok  i18n: ${zh.size} keys, zh/en aligned, every t() key defined`)
}

// ---------------------------------------------------------------- reporting --
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`)
  for (const entry of failures) console.error(`  - ${entry}`)
  process.exit(1)
}
console.log('\nall repository checks passed')
