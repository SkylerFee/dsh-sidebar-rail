/** 发布前的版本与制品校验；此脚本只在没有 OIDC 权限的构建任务执行。 */
import { appendFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE_NAME = '@skylerfee/dsh-sidebar-rail'

/**
 * 校验发布版本、标签与 GitHub 的预发布标志，返回可安全写入输出文件的元数据。
 * 不接受构建后缀，避免 npm 规范化后产生同版本的不同标签；失败时抛出可定位错误。
 */
export function releaseIdentity(manifest, releaseTag, prerelease) {
  if (manifest?.name !== PACKAGE_NAME) throw new Error('发布包名不符')
  const version = manifest.version
  if (typeof version !== 'string' || version !== version.trim()) throw new Error('发布版本不能包含首尾空白')
  const matched = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version)
  if (!matched) throw new Error('发布版本必须是无构建后缀的严格 SemVer')
  const identifiers = matched[4]?.split('.') ?? []
  if (identifiers.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    throw new Error('预发布数字标识不能带前导零')
  }
  if (releaseTag !== `v${version}`) throw new Error('Release 标签与包版本不符')
  if (typeof prerelease !== 'boolean' || prerelease !== (identifiers.length > 0)) {
    throw new Error('GitHub prerelease 标志与包版本不符')
  }
  const distTag = identifiers[0] ?? 'latest'
  if (identifiers.length > 0 && (!/^[a-z][a-z0-9-]*$/.test(distTag) || distTag === 'latest')) {
    throw new Error('预发布通道必须以小写字母开头，且不能使用 latest')
  }
  return { version, distTag }
}

/** 校验 tar 清单，只允许最终入口、字典、文档图片和包说明；拒绝重复、穿越及敏感文件。 */
export function assertPackageEntries(entries) {
  const exact = new Set([
    'package/package.json', 'package/lib/index.js', 'package/lib/client.js',
    'package/cordis.patch.yml', 'package/icon.svg', 'package/LICENSE',
    'package/README.md', 'package/README.zh.md',
  ])
  const seen = new Set()
  for (const entry of entries) {
    if (seen.has(entry)) throw new Error(`制品中存在重复路径：${entry}`)
    seen.add(entry)
    if (exact.has(entry) || /^package\/locale\/[a-zA-Z-]+\.json$/.test(entry)
      || /^package\/docs\/images\/[a-zA-Z0-9-]+\.png$/.test(entry)) continue
    throw new Error(`制品包含白名单外文件：${entry}`)
  }
  for (const required of ['package/package.json', 'package/lib/index.js', 'package/lib/client.js',
    'package/cordis.patch.yml', 'package/icon.svg', 'package/locale/en.json', 'package/locale/zh.json']) {
    if (!seen.has(required)) throw new Error(`制品缺少必要文件：${required}`)
  }
}

/** 验证已经打好的 tarball，不执行其内容，并输出发布任务需要的版本、通道与 SHA-256。 */
function inspectTarball(path) {
  const entries = execFileSync('tar', ['-tzf', path], { encoding: 'utf8' }).trim().split('\n')
  assertPackageEntries(entries)
  const types = execFileSync('tar', ['-tvzf', path], { encoding: 'utf8' }).trim().split('\n')
  if (types.some((entry) => !entry.startsWith('-'))) throw new Error('制品只允许普通文件，不接受链接或特殊节点')
  const manifest = JSON.parse(execFileSync('tar', ['-xOzf', path, 'package/package.json'], { encoding: 'utf8' }))
  const identity = releaseIdentity(manifest, process.env.RELEASE_TAG, process.env.RELEASE_PRERELEASE === 'true')
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
  return { ...identity, sha256 }
}

/** 执行构建侧发布检查；失败终止工作流，不向日志输出任何凭据。 */
function main() {
  if (!['true', 'false'].includes(process.env.RELEASE_PRERELEASE)) throw new Error('缺少 Release prerelease 标志')
  const path = process.argv[2]
  const result = path === undefined
    ? releaseIdentity(JSON.parse(readFileSync('package.json', 'utf8')), process.env.RELEASE_TAG, process.env.RELEASE_PRERELEASE === 'true')
    : inspectTarball(path)
  if (process.env.GITHUB_OUTPUT) {
    for (const [key, value] of Object.entries(result)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
  }
  console.log('[dsh-sidebar-rail] 发布检查通过', JSON.stringify(result))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) {
    console.error('[dsh-sidebar-rail] 发布检查失败：', error.message)
    process.exitCode = 1
  }
}
