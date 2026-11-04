/**
 * Logic tests for the pure data helpers inside client.js.
 *
 * The client module is a single static script loaded through
 * `window.__ModuleLoader__`, so the helpers cannot be imported. They are
 * delimited by `#region` markers inside client.js and sliced out here; the
 * slice only uses built-ins (Date/Number/Map/Set), never React or the DOM.
 * This is a logic check, not a rendering or visual check.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

/**
 * Slice one `#region <name>` block out of the client source.
 * @param {string} name - Region name.
 * @returns {string} The block body.
 */
function region(name) {
  const start = source.indexOf(`// #region ${name}`)
  const end = source.indexOf(`// #endregion ${name}`)
  assert.ok(start !== -1 && end !== -1, `region ${name} missing`)
  return source.slice(start, end)
}

const helpers = new Function(`${region('pure-helpers')}
${region('pure-data')}
return { EMPTY_SESSIONS, EMPTY_WORKSPACES, selectorHook, relativeTime, shortPath,
  resolveLocaleId, shouldRenderRail, RAIL_MIN_VIEWPORT,
  deriveSections, normalizeTasks, normalizePlugins, currentSessionId, profileAvatarUrl, accountClientMetadata }`)()

const { deriveSections, normalizeTasks, normalizePlugins, relativeTime, shortPath, selectorHook,
  resolveLocaleId, shouldRenderRail, RAIL_MIN_VIEWPORT, currentSessionId, profileAvatarUrl,
  accountClientMetadata, EMPTY_SESSIONS } = helpers

/**
 * Build a SessionSummary-shaped row.
 * @param {string} id - Session id.
 * @param {object} overrides - Field overrides.
 * @returns {object} Row.
 */
function session(id, overrides = {}) {
  return {
    id, displayTitle: `title-${id}`, running: false, retainedBy: {}, blank: false,
    updatedAt: 1000, ...overrides,
  }
}

const WORKSPACES = [
  { workspaceId: 'ws1', title: 'Alpha', path: '/repo/alpha', sessionIds: ['s1', 's2'] },
  { workspaceId: 'ws2', title: 'Beta', path: '/repo/beta', sessionIds: ['s3'] },
  { workspaceId: 'ws3', title: 'Gamma', path: '/repo/gamma', sessionIds: [] },
]

test('deriveSections: pinned workspaces lead, in pin order', () => {
  const sections = deriveSections(WORKSPACES, { byId: {} }, [], ['ws3', 'ws1'], 'en')
  assert.deepEqual(sections.pinnedRows.map((r) => r.id), ['ws3', 'ws1'])
  assert.deepEqual(sections.normalRows.map((r) => r.id), ['ws2'])
})

test('deriveSections: normal rows keep host order when nothing is pinned', () => {
  const sections = deriveSections(WORKSPACES, { byId: {} }, [], [], 'en')
  assert.equal(sections.pinnedRows.length, 0)
  assert.deepEqual(sections.normalRows.map((r) => r.id), ['ws1', 'ws2', 'ws3'])
})

test('deriveSections: recent sessions are newest-first, archived/blank/subagent dropped, capped at 10', () => {
  const byId = {}
  for (let index = 0; index < 14; index += 1) {
    byId[`r${index}`] = session(`r${index}`, { updatedAt: index })
  }
  byId.archived = session('archived', { updatedAt: 99 })
  byId.blankOne = session('blankOne', { updatedAt: 98, blank: true })
  byId.child = session('child', { updatedAt: 97, origin: 'subagent' })
  const sections = deriveSections(WORKSPACES, { byId }, ['archived'], [], 'zh')
  assert.equal(sections.recentRows.length, 10)
  assert.deepEqual(sections.recentRows.map((r) => r.id).slice(0, 3), ['r13', 'r12', 'r11'])
  const ids = sections.recentRows.map((r) => r.id)
  for (const excluded of ['archived', 'blankOne', 'child']) {
    assert.ok(!ids.includes(excluded), `${excluded} must be excluded`)
  }
})

test('currentSessionId: a covering panel clears the highlight', () => {
  const sessions = { byId: { a: session('a', { retainedBy: { mainView: 1 } }) } }
  // 宿主行为：非会话面板占据主区时，它自己也不高亮任何会话行。
  assert.equal(currentSessionId(sessions, true), undefined)
  assert.equal(currentSessionId(sessions, false), 'a')
  // undefined（调用方没提供门控信息）时不应误清空。
  assert.equal(currentSessionId(sessions, undefined), 'a')
})

test('deriveSections: recent rows mark the session the main view shows', () => {
  const sessions = {
    byId: {
      s1: session('s1', { updatedAt: 200, retainedBy: {} }),
      s2: session('s2', { updatedAt: 100, retainedBy: { mainView: 1 } }),
    },
  }
  // 没有面板覆盖时，主视图保留的那个会话要高亮。
  const shown = deriveSections(WORKSPACES, sessions, [], [], 'en', false)
  assert.deepEqual(shown.recentRows.map((r) => [r.id, r.active]), [['s1', false], ['s2', true]])
  // 有面板覆盖会话时，全部不高亮。
  const covered = deriveSections(WORKSPACES, sessions, [], [], 'en', true)
  assert.deepEqual(covered.recentRows.map((r) => r.active), [false, false])
})

test('deriveSections: workspace rows carry no path subtitle', () => {
  const sections = deriveSections(WORKSPACES, { byId: {} }, [], [], 'en', undefined)
  assert.ok(sections.normalRows.length > 0)
  for (const row of sections.normalRows) {
    // 路径副标题已移除，行数据里不应再有 meta。
    assert.equal(row.meta, undefined)
  }
})

test('normalizeTasks: unwraps RemoteResult, keeps only active tasks, reads fallback fields', () => {
  const answer = {
    ok: true,
    value: [
      { id: 't1', title: 'Morning brief', nextRunAt: '2026-11-05T09:00:00Z' },
      { id: 't2', instruction: 'Check CI every hour', status: 'active' },
      { id: 't3', title: 'Ended', status: 'ended' },
      { id: 't4', title: 'Paused', status: 'paused' },
      { id: 't5', title: 'Disabled', enabled: false },
    ],
  }
  const rows = normalizeTasks(answer)
  assert.deepEqual(rows.map((r) => r.id), ['t1', 't2'])
  assert.equal(rows[1].title, 'Check CI every hour')
  assert.ok(rows[0].meta.includes('2026'))
})

test('normalizeTasks: tolerates bare arrays and junk in the list', () => {
  assert.deepEqual(normalizeTasks([{ id: 'x', title: 'X' }, null]).map((r) => r.id), ['x'])
  assert.deepEqual(normalizeTasks(null), [])
})

test('normalizePlugins: keeps only enabled, installed, non-official bundles', () => {
  // 数据源是 pluginManager.listBundles：official 区分宿主自带与用户安装，
  // enabled 是用户是否启用，installed 是 profile 是否声明了它。
  const answer = {
    ok: true,
    value: {
      bundles: [
        { name: 'dsh-notify-me', official: false, enabled: true, installed: true, version: '1.17.0' },
        { name: '@deepseek-ai/dsh-web-app', official: true, enabled: true, installed: true, version: '0.2.1-rc.5' },
        { name: 'dsh-better-sidebar', official: false, enabled: false, installed: true },
        { name: 'dsh-context', official: false, enabled: true, installed: false },
        { name: 'dsh-mcp-connector', official: false, enabled: true, installed: true, version: '0.2.93' },
      ],
    },
  }
  const rows = normalizePlugins(answer)
  assert.deepEqual(rows.map((r) => r.name), ['dsh-mcp-connector', 'dsh-notify-me'])
  assert.equal(rows[0].meta, 'v0.2.93')
})

test('normalizePlugins: returns nothing for a null answer', () => {
  assert.deepEqual(normalizePlugins(null), [])
})

test('currentSessionId: the session the main view retains', () => {
  // 与宿主 ui-workspace/tree.ts 同一判据：retainedBy.mainView > 0。
  const sessions = {
    byId: {
      a: session('a', { retainedBy: {} }),
      b: session('b', { retainedBy: { mainView: 1 } }),
      c: session('c', { retainedBy: { mainView: 2 } }),
    },
  }
  assert.equal(currentSessionId(sessions), 'b')
  assert.equal(currentSessionId({ byId: { a: session('a') } }), undefined)
  assert.equal(currentSessionId(null), undefined)
  assert.equal(currentSessionId({}), undefined)
})

test('profileAvatarUrl: reads the ready profile avatar, nothing else', () => {
  assert.equal(profileAvatarUrl({ ok: true, value: { status: 'ready', avatarUrl: 'https://x/a.png' } }),
    'https://x/a.png')
  // 未登录 / 未就绪 / 空 URL 都当作没有头像，交给原生占位。
  assert.equal(profileAvatarUrl({ ok: true, value: { status: 'signed-out' } }), undefined)
  assert.equal(profileAvatarUrl({ ok: true, value: { status: 'ready', avatarUrl: '' } }), undefined)
  assert.equal(profileAvatarUrl({ ok: true, value: { status: 'ready', avatarUrl: '   ' } }), undefined)
  assert.equal(profileAvatarUrl(null), undefined)
  assert.equal(profileAvatarUrl({ ok: true, value: null }), undefined)
})

test('accountClientMetadata: host-shaped identity, null without a version', () => {
  // 宿主 accountClientMetadata：version + locale + 时区秒（getTimezoneOffset 的符号要翻转）。
  assert.deepEqual(accountClientMetadata('zh', '0.2.1-rc.5', -480),
    { version: '0.2.1-rc.5', locale: 'zh', timezoneOffsetSeconds: 28800 })
  // 缺版本就不能发请求（宿主同样 throw）。
  assert.equal(accountClientMetadata('zh', undefined, 0), null)
  assert.equal(accountClientMetadata('zh', '', 0), null)
  // locale 缺失时退化为 en，而不是发空串。
  assert.equal(accountClientMetadata('', '1.0.0', 0).locale, 'en')
})

test('relativeTime: Chinese and English phrasing', () => {
  const now = Date.now()
  assert.equal(relativeTime(now - 1000, 'zh'), '刚刚')
  assert.equal(relativeTime(now - 1000, 'en'), 'now')
  assert.equal(relativeTime(now - 5 * 60_000, 'zh'), '5 分钟前')
  assert.equal(relativeTime(now - 5 * 60_000, 'en'), '5 min ago')
  assert.equal(relativeTime(now - 3 * 3600_000, 'zh'), '3 小时前')
  assert.equal(relativeTime(Number.NaN, 'zh'), '')
})

test('resolveLocaleId: reads the host `active` field, not a missing `id`', () => {
  // 宿主的 LocaleSnapshot 用 active；写成 id 会静默退回英文（2026-11-04 桌面验收问题）。
  assert.equal(resolveLocaleId({ active: 'zh' }), 'zh')
  assert.equal(resolveLocaleId({ active: 'zh-CN', locales: [], revision: 3 }), 'zh-CN')
  // 防御性兼容：合成快照可能只有 id / locale。
  assert.equal(resolveLocaleId({ id: 'zh' }), 'zh')
  assert.equal(resolveLocaleId({ locale: 'en' }), 'en')
  // 空值、缺字段与非法输入必须回退到 en，而不是把空串当语言。
  assert.equal(resolveLocaleId({ active: '' }), 'en')
  assert.equal(resolveLocaleId({}), 'en')
  assert.equal(resolveLocaleId(null), 'en')
  assert.equal(resolveLocaleId('zh'), 'en')
})

test('shouldRenderRail: macOS + collapsed + wide enough, nothing else', () => {
  // 宽度边界：768 是「680 正文最小 + 56 轨 + 32 安全」推出的阈值。
  assert.equal(shouldRenderRail('darwin', true, RAIL_MIN_VIEWPORT), true)
  assert.equal(shouldRenderRail('darwin', true, RAIL_MIN_VIEWPORT + 400), true)
  assert.equal(shouldRenderRail('darwin', true, RAIL_MIN_VIEWPORT - 1), false)
  // 展开态交还宿主，浮轨不得出现。
  assert.equal(shouldRenderRail('darwin', false, 1600), false)
  // Web 宿主自带 56px 折叠轨；Windows 未验证——两者都不画，避免重复轨。
  assert.equal(shouldRenderRail('web', true, 1600), false)
  assert.equal(shouldRenderRail('win32', true, 1600), false)
  // 宽度未知（NaN/undefined）时宁可不画，也不要画一条盖住正文的轨。
  assert.equal(shouldRenderRail('darwin', true, Number.NaN), false)
  assert.equal(shouldRenderRail('darwin', true, undefined), false)
})

test('shortPath: keeps two trailing segments', () => {
  assert.equal(shortPath('/Users/example/Projects/repo'), '…/Projects/repo')
  assert.equal(shortPath('/repo'), '/repo')
  assert.equal(shortPath(''), '')
})

test('selectorHook: falls back to a constant reader when the hook is missing', () => {
  const read = selectorHook(undefined, EMPTY_SESSIONS)
  assert.equal(read((state) => state.ids).length, 0)
  const real = selectorHook((select) => select({ ids: ['x'] }), EMPTY_SESSIONS)
  assert.deepEqual(real((state) => state.ids), ['x'])
})
