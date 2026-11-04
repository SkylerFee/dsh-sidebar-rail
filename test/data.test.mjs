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
  resolveLocaleId, deriveSections, normalizeTasks, normalizePlugins }`)()

const { deriveSections, normalizeTasks, normalizePlugins, relativeTime, shortPath, selectorHook, resolveLocaleId, EMPTY_SESSIONS } = helpers

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

test('normalizePlugins: unwraps RemoteResult, keeps enabled rows, prefers moduleName', () => {
  const answer = {
    ok: true,
    value: {
      managementAvailable: true,
      entries: [
        { entryId: 'e1', moduleName: '@scope/plugin-a', enabled: true, fiberPhase: 'active' },
        { entryId: 'e2', moduleName: '@scope/plugin-b', enabled: false },
        { entryId: 'e3', moduleName: '@scope/plugin-c', enabled: true, version: '1.2.3' },
      ],
    },
  }
  const rows = normalizePlugins(answer)
  assert.deepEqual(rows.map((r) => r.name), ['@scope/plugin-a', '@scope/plugin-c'])
  assert.equal(rows[1].meta, 'v1.2.3')
})

test('normalizePlugins: returns nothing for a null answer', () => {
  assert.deepEqual(normalizePlugins(null), [])
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
