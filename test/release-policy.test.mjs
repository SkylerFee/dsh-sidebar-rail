/** 发布策略回归：执行构建校验及 workflow 中真实的最终发布判定，不访问外网。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { PACKAGE_NAME, releaseIdentity, assertPackageEntries } from '../scripts/release-policy.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const workflow = readFileSync(join(root, '.github/workflows/publish.yml'), 'utf8')
const guard = workflow.split('// BEGIN_PUBLISH_GUARD')[1].split('// END_PUBLISH_GUARD')[0]
  .split('\n').slice(1).map((line) => line.replace(/^          /, '')).join('\n')
const required = ['package/package.json', 'package/lib/index.js', 'package/lib/client.js',
  'package/cordis.patch.yml', 'package/icon.svg', 'package/locale/en.json', 'package/locale/zh.json']

/** 提供固定 registry 响应并提取 workflow 的真实函数；请求地址用于断言网络边界。 */
function publisher(responses = []) {
  const calls = []
  const sandbox = {
    AbortSignal,
    fetch: async (url, options) => {
      calls.push({ url, redirect: options.redirect })
      const response = responses.shift()
      if (response instanceof Error) throw response
      assert.ok(response, '不允许出现意料外的 registry 请求')
      return { status: response.status, ok: response.status >= 200 && response.status < 300, json: async () => response.body }
    },
  }
  runInNewContext(`${guard}\nthis.api = { verifyIdentity, assertForwardVersion, verifyRegistry };`, sandbox)
  return { ...sandbox.api, calls }
}

/** 构造一致的最终发布环境字段，缺省为新稳定版本。 */
function expected(version = '1.1.0', prerelease = 'false', distTag = 'latest') {
  return { version, prerelease, distTag, releaseTag: `v${version}` }
}

test('release identity: stable and prerelease channels require matching GitHub metadata', () => {
  assert.deepEqual(releaseIdentity({ name: PACKAGE_NAME, version: '1.1.0' }, 'v1.1.0', false), { version: '1.1.0', distTag: 'latest' })
  assert.deepEqual(releaseIdentity({ name: PACKAGE_NAME, version: '1.1.0-rc.2' }, 'v1.1.0-rc.2', true), { version: '1.1.0-rc.2', distTag: 'rc' })
  assert.throws(() => releaseIdentity({ name: PACKAGE_NAME, version: '1.1.0' }, 'v1.1.0', true), /prerelease/)
  assert.throws(() => releaseIdentity({ name: PACKAGE_NAME, version: '1.1.0-rc.2' }, 'v1.1.0-rc.2', false), /prerelease/)
})

test('release identity: mismatched tags, malformed semver and unsafe channels fail closed', () => {
  assert.throws(() => releaseIdentity({ name: 'other', version: '1.1.0' }, 'v1.1.0', false), /包名/)
  assert.throws(() => releaseIdentity({ name: PACKAGE_NAME, version: '1.1.0' }, 'v1.2.0', false), /标签/)
  for (const version of ['01.1.0', '1.1', '1.1.0+local', '1.1.0\n', '1.1.0\ndistTag=latest', '1.1.0-rc.01', '1.1.0-1', '1.1.0-latest.1', '1.1.0-RC.1']) {
    assert.throws(() => releaseIdentity({ name: PACKAGE_NAME, version }, `v${version}`, version.includes('-')), version)
  }
})

test('tarball policy: published entries are allowlisted and mandatory runtime files must exist', () => {
  assert.doesNotThrow(() => assertPackageEntries([...required, 'package/README.md', 'package/docs/images/preview-light.png']))
  for (const injected of ['package/.npmrc', 'package/.env', 'package/src/client.ts', 'package/test/token.json',
    'package/locale/../secret.json', 'package/docs/images/key.pem', '/tmp/key', 'package/lib/extra.js']) {
    assert.throws(() => assertPackageEntries([...required, injected]), /白名单/)
  }
  assert.throws(() => assertPackageEntries([...required, required[0]]), /重复/)
  assert.throws(() => assertPackageEntries(required.filter((path) => path !== 'package/lib/client.js')), /必要/)
})

test('publisher: final tarball identity is checked independently of build outputs', () => {
  const api = publisher()
  assert.throws(() => api.verifyIdentity({ name: PACKAGE_NAME, version: '1.1.0\n' }, expected('1.1.0\n')), /空白/)
  const result = api.verifyIdentity({ name: PACKAGE_NAME, version: '1.1.0' }, expected())
  assert.equal(result.stable, true)
  assert.equal(result.distTag, 'latest')
  const pre = api.verifyIdentity({ name: PACKAGE_NAME, version: '1.1.0-beta.4' }, expected('1.1.0-beta.4', 'true', 'beta'))
  assert.equal(pre.stable, false)
  for (const bad of [
    { ...expected(), version: '1.2.0' },
    { ...expected(), releaseTag: 'v1.0.0' },
    { ...expected(), distTag: 'beta' },
    { ...expected(), prerelease: 'true' },
    { ...expected(), prerelease: '' },
  ]) assert.throws(() => api.verifyIdentity({ name: PACKAGE_NAME, version: '1.1.0' }, bad))
  assert.throws(() => api.verifyIdentity({ name: 'other', version: '1.1.0' }, expected()), /包名/)
})

test('publisher: invalid versions and dist-tags cannot reach npm publish', () => {
  const api = publisher()
  for (const version of ['1.1.0+metadata', '1.1.0-rc.01', '1.1.0-1', '1.1.0-latest.1', '1.1.0-RC.1', '1.1.0\n']) {
    assert.throws(() => api.verifyIdentity({ name: PACKAGE_NAME, version }, expected(version, 'true', version.split('-')[1]?.split('.')[0])))
  }
})

test('publisher: stable version ordering is numeric across all three components', () => {
  const { assertForwardVersion } = publisher()
  for (const [version, latest] of [['1.10.0', '1.9.9'], ['2.0.0', '1.99.99'], ['1.1.10', '1.1.9'],
    ['9007199254740993.0.0', '9007199254740992.0.0']]) {
    assert.doesNotThrow(() => assertForwardVersion(version, latest))
  }
  for (const [version, latest] of [['1.9.9', '1.10.0'], ['1.0.0', '2.0.0'], ['1.1.0', '1.1.1'], ['1.1.0', '1.1.0']]) {
    assert.throws(() => assertForwardVersion(version, latest), /回退|重复/)
  }
  assert.throws(() => assertForwardVersion('1.1.0', 'corrupt'), /元数据/)
})

test('publisher: a delayed older stable release cannot move latest backwards', async () => {
  const api = publisher([{ status: 404 }, { status: 200, body: { version: '1.2.0' } }])
  await assert.rejects(api.verifyRegistry({ version: '1.1.0', stable: true }), /回退/)
  assert.equal(api.calls.length, 2)
  assert.ok(api.calls.every((call) => call.url.startsWith('https://registry.npmjs.org/@skylerfee%2fdsh-sidebar-rail/')))
  assert.ok(api.calls.every((call) => call.redirect === 'error'))
})

test('publisher: existing versions and registry outages stop publication', async () => {
  await assert.rejects(publisher([{ status: 200, body: { version: '1.1.0' } }]).verifyRegistry({ version: '1.1.0', stable: true }), /已在 registry/)
  await assert.rejects(publisher([{ status: 500 }]).verifyRegistry({ version: '1.1.0', stable: true }), /500/)
  await assert.rejects(publisher([new Error('timeout')]).verifyRegistry({ version: '1.1.0', stable: true }), /timeout/)
  await assert.doesNotReject(publisher([{ status: 404 }, { status: 404 }]).verifyRegistry({ version: '1.1.0', stable: true }))
  const pre = publisher([{ status: 404 }])
  await assert.doesNotReject(pre.verifyRegistry({ version: '1.1.0-rc.1', stable: false }))
  assert.equal(pre.calls.length, 1, '预发布不读写 latest')
})

test('tarball CLI: inspects the actual archive and rejects a symlink before upload', () => {
  mkdirSync(join(root, 'tmp'), { recursive: true })
  const directory = mkdtempSync(join(root, 'tmp/release-policy-test-'))
  try {
    for (const path of required) {
      const fullPath = join(directory, path)
      mkdirSync(join(fullPath, '..'), { recursive: true })
      writeFileSync(fullPath, path === 'package/package.json' ? JSON.stringify({ name: PACKAGE_NAME, version: '1.1.0' }) : 'fixture')
    }
    const archive = join(directory, 'package.tgz')
    // 显式文件清单避免 tar 生成的目录条目；npm pack 同样只写普通文件条目。
    execFileSync('tar', ['-czf', archive, '-C', directory, ...required])
    const command = [join(root, 'scripts/release-policy.mjs'), archive]
    const env = { ...process.env, RELEASE_TAG: 'v1.1.0', RELEASE_PRERELEASE: 'false', GITHUB_OUTPUT: '' }
    let result = spawnSync(process.execPath, command, { encoding: 'utf8', env, cwd: root })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /"sha256":"[a-f0-9]{64}"/)
    rmSync(join(directory, 'package/lib/client.js'))
    symlinkSync('index.js', join(directory, 'package/lib/client.js'))
    execFileSync('tar', ['-czf', archive, '-C', directory, ...required])
    result = spawnSync(process.execPath, command, { encoding: 'utf8', env, cwd: root })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /链接或特殊/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
