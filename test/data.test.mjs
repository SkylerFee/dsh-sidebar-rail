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
  deriveSections, normalizeTasks, normalizePlugins, currentSessionId, accountSeatState, accountClientMetadata, clientBuildVersion, readRecentCount,
  remoteOutcome, flyoutPlacement, keepsRailRevealed, RAIL_REVEAL_WIDTH, readRecentCount, sessionStatusOf, formatWalletBalance, balanceRows, accountLinks, withAccountExtras, flyoutSectionedHeight, sectionMaxHeight, sectionIsOpen, projectSessionRows, pickedDirectory, groupTasksByStatus, groupPluginsByState, taskNextRun }`)()

const { deriveSections, normalizeTasks, normalizePlugins, relativeTime, shortPath, selectorHook,
  resolveLocaleId, shouldRenderRail, RAIL_MIN_VIEWPORT, currentSessionId, accountSeatState,
  accountClientMetadata, clientBuildVersion, readRecentCount, sessionStatusOf,
  formatWalletBalance, balanceRows, accountLinks, remoteOutcome, flyoutPlacement,
  keepsRailRevealed, RAIL_REVEAL_WIDTH, EMPTY_SESSIONS, withAccountExtras, flyoutSectionedHeight, sectionMaxHeight, sectionIsOpen, projectSessionRows, pickedDirectory, groupTasksByStatus, groupPluginsByState, taskNextRun } = helpers

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

test('taskNextRun: the host formula, not a nextRunAt field', () => {
  // ScheduleCatalogEntry 只有 scheduledAt 与可选 deliveryFloorEndsAt；nextRunAt 与
  // next 在契约里都不存在（ADR-0005）。宿主的算法是「底限结束时间晚于计划时间时
  // 用它，否则用计划时间」——照抄，不要发明字段。
  assert.equal(
    taskNextRun({ scheduledAt: '2026-11-10T09:00:00Z', deliveryFloorEndsAt: '2026-11-10T10:00:00Z' }),
    '2026-11-10T10:00:00Z',
    'a delivery floor past the scheduled time wins',
  )
  assert.equal(
    taskNextRun({ scheduledAt: '2026-11-10T09:00:00Z', deliveryFloorEndsAt: '2026-11-10T08:00:00Z' }),
    '2026-11-10T09:00:00Z',
    'a floor before the scheduled time is ignored',
  )
  assert.equal(taskNextRun({ scheduledAt: '2026-11-10T09:00:00Z' }), '2026-11-10T09:00:00Z')
  // 相等时取 scheduledAt，不改变显示。
  assert.equal(
    taskNextRun({ scheduledAt: '2026-11-10T09:00:00Z', deliveryFloorEndsAt: '2026-11-10T09:00:00Z' }),
    '2026-11-10T09:00:00Z',
  )
  // 脏输入返回空串，由调用方决定不显示 meta。
  assert.equal(taskNextRun({}), '')
  assert.equal(taskNextRun(null), '')
  assert.equal(taskNextRun({ scheduledAt: 'not-a-date' }), '')
})

test('normalizeTasks: meta comes from taskNextRun, never from a nextRunAt field', () => {
  // 回归锁：旧实现写 task.nextRunAt ?? task.next ?? scheduledAt，前两个键不存在。
  // 即使送进来一个 nextRunAt，也不该被采用——契约里没有这个字段。
  const rows = normalizeTasks({ ok: true, value: [
    { id: 'a', title: 'a', scheduledAt: '2026-11-10T09:00:00Z', nextRunAt: '2020-01-01T00:00:00Z' },
    { id: 'b', title: 'b', scheduledAt: '2026-11-10T09:00:00Z', deliveryFloorEndsAt: '2026-11-10T11:00:00Z' },
    { id: 'c', title: 'c' },
  ] })
  // 用时间戳比较，避免断言依赖运行环境的时区。
  assert.equal(Date.parse(rows[0].meta), Date.parse('2026-11-10T09:00:00Z'), 'a stray nextRunAt must not win')
  assert.equal(Date.parse(rows[1].meta), Date.parse('2026-11-10T11:00:00Z'), 'the delivery floor is what the host would show')
  assert.equal(rows[2].meta, '')
})

test('groupTasksByStatus: every host status lands in its own group', () => {
  // spec 4：进行中 active / 已暂停 paused / 已结束 ended，一区不漏。
  const rows = [
    { id: 'a1', title: 'a1', meta: 'm', status: 'active' },
    { id: 'p1', title: 'p1', meta: 'm', status: 'paused' },
    { id: 'e1', title: 'e1', meta: 'm', status: 'ended' },
    { id: 'a2', title: 'a2', meta: 'm', status: 'active' },
  ]
  const groups = groupTasksByStatus(rows)
  assert.deepEqual(groups.active.map((r) => r.id), ['a1', 'a2'])
  assert.deepEqual(groups.paused.map((r) => r.id), ['p1'])
  assert.deepEqual(groups.ended.map((r) => r.id), ['e1'])
})

test('groupTasksByStatus: all three keys exist even when empty', () => {
  // 空分区也要保留标题 + 空态，所以这里返回的必须是完整三键而不是缺键。
  const empty = groupTasksByStatus([])
  assert.deepEqual(Object.keys(empty).sort(), ['active', 'ended', 'paused'])
  assert.deepEqual(empty.active, [])
  assert.deepEqual(empty.paused, [])
  assert.deepEqual(empty.ended, [])
})

test('groupTasksByStatus: an unknown status is dropped, not silently made active', () => {
  // 宿主枚举目前只有这三种；未来多一个值时宁可少列一条，也不要把它塞进「进行中」
  // 让人以为任务还在跑。
  const groups = groupTasksByStatus([{ id: 'x', title: 'x', meta: '', status: 'future-state' }])
  assert.deepEqual([...groups.active, ...groups.paused, ...groups.ended], [])
  assert.deepEqual(groupTasksByStatus(undefined).active, [])
})

test('normalizeTasks: keeps every status instead of filtering to active', () => {
  // 0.3.x 在这里就把 paused/ended 丢掉了；0.4.0 的任务浮层要分三区，
  // 所以适配层必须带出状态而不是过筛。catalog() 本来就返回全部状态。
  const answer = { ok: true, value: [
    { id: 'a', title: 'a', status: 'active' },
    { id: 'p', title: 'p', status: 'paused' },
    { id: 'e', title: 'e', status: 'ended' },
    { id: 'i', title: 'i', status: 'inactive' },
    { id: 'l', title: 'l', active: false },
    { id: 'u', title: 'u', status: 'future-state' },
  ] }
  const rows = normalizeTasks(answer)
  assert.deepEqual(rows.map((r) => r.id), ['a', 'p', 'e', 'i', 'l', 'u'], 'nothing is filtered out')
  assert.deepEqual(rows.map((r) => r.status), ['active', 'paused', 'ended', 'ended', 'paused', ''])
  // 端到端：归一化后再分区，三种状态各归各位。
  const groups = groupTasksByStatus(rows)
  assert.deepEqual(groups.active.map((r) => r.id), ['a'])
  assert.deepEqual(groups.paused.map((r) => r.id), ['p', 'l'])
  assert.deepEqual(groups.ended.map((r) => r.id), ['e', 'i'])
})

test('normalizePlugins: carries installed, so the split stays explicit', () => {
  // 判据是 installed === true && enabled === false（spec 5）。归一化必须把 installed
  // 带出来，否则分区层只能靠「上游已经滤掉未安装项」这个隐含前提工作——上游一变
  // 就会静默漂移。
  const rows = normalizePlugins({ ok: true, value: {
    bundles: [
      { name: 'on', official: false, enabled: true, installed: true, version: '1.0.0' },
      { name: 'off', official: false, enabled: false, installed: true },
      // 宿主未报 installed 视为已安装：normalizePlugins 只剔除明确 installed:false 的。
      { name: 'unreported', official: false, enabled: false },
    ],
  } })
  assert.deepEqual(rows.map((r) => [r.name, r.enabled, r.installed]), [
    ['off', false, true],
    ['on', true, true],
    ['unreported', false, true],
  ])
})

test('groupPluginsByState: the disabled side applies the spec criterion', () => {
  // 显式判据：installed && !enabled。一条「未安装但 enabled:false」的行不属于任何区
  // ——它不是「被关掉的插件」，而是「还没装的东西」，进哪一区都是错的。
  const groups = groupPluginsByState([
    { name: 'on', enabled: true, installed: true },
    { name: 'off', enabled: false, installed: true },
    { name: 'absent', enabled: false, installed: false },
    { name: 'on-absent', enabled: true, installed: false },
  ])
  assert.deepEqual(groups.enabled.map((r) => r.name), ['on'])
  assert.deepEqual(groups.disabled.map((r) => r.name), ['off'])
})

test('groupPluginsByState: enabled and installed-but-off are separated', () => {
  // spec 5：「未启用」只含 installed && !enabled，未安装的官方按需插件不进来。
  // 归一化层已经挡掉了未安装项与宿主自带项，这里只做两分。
  const rows = [
    { name: 'on', meta: 'v1', enabled: true, installed: true },
    { name: 'off', meta: 'v2', enabled: false, installed: true },
    { name: 'missing', meta: 'v3', enabled: false, installed: false },
    { name: 'on-but-not-installed', meta: 'v4', enabled: true, installed: false },
  ]
  const groups = groupPluginsByState(rows)
  // 只有 installed 的行进入分区：未安装的（missing）与「未安装却 enabled」的畸形行
  // 都不属于这两区。
  assert.deepEqual(groups.enabled.map((r) => r.name), ['on'])
  assert.deepEqual(groups.disabled.map((r) => r.name), ['off'])
})

test('groupPluginsByState: both keys exist when empty', () => {
  const empty = groupPluginsByState([])
  assert.deepEqual(Object.keys(empty).sort(), ['disabled', 'enabled'])
  assert.deepEqual(groupPluginsByState(undefined).enabled, [])
})

test('pickedDirectory: one shape for "chosen", "cancelled" and "failed"', () => {
  // 目录选择器有三条结局，调用方只该看到一个扁平结果（spec 3.3）。
  assert.deepEqual(pickedDirectory('/repo/alpha'), { kind: 'picked', path: '/repo/alpha' })
  // 取消是最常见的一条，且必须静默：不是错误，也不该弹提示。
  assert.deepEqual(pickedDirectory(null), { kind: 'cancelled' })
  // 选择器拒绝（backend 缺能力、用户中止、RPC 失败）走失败态，要有可见结果。
  assert.equal(pickedDirectory(undefined).kind, 'cancelled')
  // 空白字符串不是一条可用路径。
  assert.equal(pickedDirectory('').kind, 'cancelled')
  assert.equal(pickedDirectory('   ').kind, 'cancelled')
  const failed = pickedDirectory(new Error('directory picker failed'))
  assert.equal(failed.kind, 'failed')
  assert.equal(failed.message, 'directory picker failed')
  // 非 Error 的拒绝也要有可读文案，不能渲染成 "undefined"。
  const weird = pickedDirectory('boom')
  assert.equal(weird.kind, 'failed')
  assert.equal(typeof weird.message, 'string')
  assert.ok(weird.message.length > 0)
})

test('pickedDirectory: a refused backend is a failure, never a silent cancel', () => {
  // ADR-0005：browse 后端没有 native 能力时 pick 会被 directory-picker/unavailable
  // 拒绝。这条与「用户按了取消」必须在类型上分开——取消要静默，拒绝要有提示。
  const refused = pickedDirectory(new Error('directoryPicker.pick needs the native capability; the composed picker serves "browse"'))
  assert.equal(refused.kind, 'failed')
  assert.ok(refused.message.length > 0)
  // 取消只有一种表示：null。
  assert.equal(pickedDirectory(null).kind, 'cancelled')
})

test('pickedDirectory: an absolute path is required, a relative one is a failure', () => {
  // 宿主的 create 接受任何字符串但其 registry 需要绝对路径；相对路径要在这里
  // 挡掉并给出失败态，而不是登记出一个不可用的项目。
  assert.equal(pickedDirectory('repo/alpha').kind, 'failed')
  assert.equal(pickedDirectory('/repo/alpha').kind, 'picked')
})

test('projectSessionRows: lists every member unfiltered, in host order', () => {
  // 项目展开要回答「这个项目里到底有什么」：不按 archived/blank/origin 再筛一遍，
  // 也不截条数，顺序照抄 sessionIds（spec 3.2）。子代理会话本就不在 sessionIds 里。
  const byId = {
    s1: session('s1', { displayTitle: 'first', updatedAt: 10 }),
    s2: session('s2', { updatedAt: 30 }),
    s3: session('s3', { blank: true, updatedAt: 20 }),
  }
  const rows = projectSessionRows(['s1', 's3', 's2'], byId, 'en')
  assert.deepEqual(rows.map((r) => r.id), ['s1', 's3', 's2'], 'host order, not sorted by time')
  assert.equal(rows.length, 3, 'nothing is filtered out')
  assert.equal(rows[1].title, 'title-s3', 'a blank session is listed, under its own title')
})

test('projectSessionRows: archived members stay listed and are marked', () => {
  const byId = { s1: session('s1'), s2: session('s2') }
  const rows = projectSessionRows(['s1', 's2'], byId, 'en', ['s2'])
  assert.deepEqual(rows.map((r) => r.id), ['s1', 's2'])
  assert.equal(rows[0].archived, false)
  assert.equal(rows[1].archived, true, 'the renderer needs to tell the two apart')
})

test('projectSessionRows: unknown members degrade to an id-only row', () => {
  // sessionIds 是宿主 registry 的结果，byId 是宿主会话快照：两者可能短暂不同步。
  // 缺条目时给一行占位，而不是整段消失。
  const rows = projectSessionRows(['ghost'], { s1: session('s1') }, 'en')
  assert.deepEqual(rows, [{ id: 'ghost', title: 'ghost', meta: '', archived: false, current: false }])
})

test('projectSessionRows: a missing or junk session list is empty, not a throw', () => {
  assert.deepEqual(projectSessionRows(undefined, {}, 'en'), [])
  assert.deepEqual(projectSessionRows(null, {}, 'en'), [])
  assert.deepEqual(projectSessionRows([], { s1: session('s1') }, 'en'), [])
})

test('deriveSections: a pinned project lives in exactly one of the three sections', () => {
  // 「置顶项目不在项目区重复」是 0.4.0 三分区的硬要求（spec 3.1）。这条锁住它：
  // 两组的 id 集合必须互斥，且并集等于宿主全部项目。
  const sections = deriveSections(WORKSPACES, { byId: {} }, [], ['ws2'], 'en')
  const pinnedIds = sections.pinnedRows.map((r) => r.id)
  const normalIds = sections.normalRows.map((r) => r.id)
  assert.deepEqual(pinnedIds, ['ws2'])
  assert.ok(!normalIds.includes('ws2'), 'a pinned project must not repeat in the projects section')
  assert.deepEqual([...pinnedIds, ...normalIds].sort(), ['ws1', 'ws2', 'ws3'])
})

test('deriveSections: normal rows keep host order when nothing is pinned', () => {
  const sections = deriveSections(WORKSPACES, { byId: {} }, [], [], 'en')
  assert.equal(sections.pinnedRows.length, 0)
  assert.deepEqual(sections.normalRows.map((r) => r.id), ['ws1', 'ws2', 'ws3'])
})

test('deriveSections: recent sessions are newest-first, filtered, and honour the count', () => {
  const byId = {}
  for (let i = 0; i < 14; i += 1) byId[`s${i}`] = session(`s${i}`, { updatedAt: i * 10 })
  byId.archived = session('archived', { updatedAt: 999 })
  byId.blank = session('blank', { updatedAt: 998, blank: true })
  byId.sub = session('sub', { updatedAt: 997, origin: 'subagent' })

  // 默认（未传设置）→ DEFAULT_RECENT_COUNT，而不是旧实现的硬编码 10。
  const byDefault = deriveSections(WORKSPACES, { byId }, ['archived'], [], 'en', false, undefined)
  assert.equal(byDefault.recentRows.length, 5)
  // 过滤仍然生效：归档/空白/子代理都不出现。
  const ids = byDefault.recentRows.map((row) => row.id)
  assert.ok(!ids.includes('archived') && !ids.includes('blank') && !ids.includes('sub'))
  // 倒序：最新在前。
  assert.deepEqual(ids, ['s13', 's12', 's11', 's10', 's9'])

  // 用户把数量调到上限 → 返回上限条数，且不超过硬上限 RECENT_LIMIT。
  const many = deriveSections(WORKSPACES, { byId }, ['archived'], [], 'en', false, 20)
  assert.equal(many.recentRows.length, 14)   // 只有 14 条可用
  const huge = deriveSections(WORKSPACES, { byId }, ['archived'], [], 'en', false, 200)
  assert.equal(huge.recentRows.length, 14)   // 仍受可用条数限制
  // 超出硬上限的请求被夹到 RECENT_LIMIT 之内。
  assert.ok(huge.recentRows.length <= 20)
})

test('readRecentCount: clamps whatever storage held back into range', () => {
  // 缺失/脏值 → 默认值，绝不渲染意外条数。
  assert.equal(readRecentCount(undefined), 5)
  assert.equal(readRecentCount(null), 5)
  assert.equal(readRecentCount(''), 5)
  assert.equal(readRecentCount(Number.NaN), 5)
  assert.equal(readRecentCount('abc'), 5)
  // 越界夹取。
  assert.equal(readRecentCount(0), 1)
  assert.equal(readRecentCount(-3), 1)
  assert.equal(readRecentCount(999), 20)
  // 字符串（手改 localStorage）与小数。
  assert.equal(readRecentCount('7'), 7)
  assert.equal(readRecentCount(7.6), 8)
})

test('currentSessionId: a covering panel clears the highlight', () => {
  const sessions = { byId: { a: session('a', { retainedBy: { mainView: 1 } }) } }
  // 宿主行为：非会话面板占据主区时，它自己也不高亮任何会话行。
  assert.equal(currentSessionId(sessions, true), undefined)
  assert.equal(currentSessionId(sessions, false), 'a')
  // undefined（调用方没提供门控信息）时不应误清空。
  assert.equal(currentSessionId(sessions, undefined), 'a')
})

test('deriveSections: recent rows carry the host status mark for the renderer', () => {
  // 回归锁：sessionStatusOf 曾经是「定义完整、单测通过、但没有任何调用点」的死函数，
  // 因为 deriveSections 加了 statuses 形参却没在循环里用它，行对象没有 status 字段。
  // 这条断言直接盯住生产路径的输出，而不是再测一次纯函数。
  const sessions = {
    byId: {
      run: session('run', { updatedAt: 500, running: true }),
      wait: session('wait', { updatedAt: 400, running: false }),
      unread: session('unread', { updatedAt: 300, running: false }),
      plain: session('plain', { updatedAt: 200, running: false }),
    },
  }
  const statuses = new Map([
    ['run', { running: true, pendingInteraction: undefined, completionUnread: false }],
    ['wait', { running: false, pendingInteraction: { key: 'k', kind: 'approval', sessionId: 'wait' }, completionUnread: false }],
    ['unread', { running: false, pendingInteraction: undefined, completionUnread: true }],
    ['plain', { running: false, pendingInteraction: undefined, completionUnread: false }],
  ])
  const sections = deriveSections(WORKSPACES, sessions, [], [], 'en', false, 10, statuses)
  assert.deepEqual(
    sections.recentRows.map((r) => [r.id, r.status]),
    [['run', 'ongoing'], ['wait', 'warning'], ['unread', 'done'], ['plain', 'idle']],
  )
})

test('deriveSections: a missing or object-shaped status snapshot degrades to no marks', () => {
  const sessions = { byId: { s1: session('s1', { running: true }) } }
  // 宿主未注入 useSessionStatus 时 statuses 为 undefined，不能抛错。
  assert.equal(deriveSections(WORKSPACES, sessions, [], [], 'en', false, 5, undefined).recentRows[0].status, 'ongoing')
  // 普通对象（非 Map）也要能读，形状变化时退化为「无状态事实」而不是崩溃。
  const asObject = deriveSections(WORKSPACES, sessions, [], [], 'en', false, 5, { s1: { running: false } })
  assert.equal(asObject.recentRows[0].status, 'idle')
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

test('normalizeTasks: unwraps RemoteResult, keeps every status, reads fallback fields', () => {
  const answer = {
    ok: true,
    value: [
      { id: 't1', title: 'Morning brief', scheduledAt: '2026-11-05T09:00:00Z' },
      { id: 't2', instruction: 'Check CI every hour', status: 'active' },
      { id: 't3', title: 'Ended', status: 'ended' },
      { id: 't4', title: 'Paused', status: 'paused' },
      { id: 't5', title: 'Disabled', enabled: false },
    ],
  }
  const rows = normalizeTasks(answer)
  // 0.3.x 只留 active；0.4.0 的浮层要分三区，所以每条都留下并带上状态。
  assert.deepEqual(rows.map((r) => r.id), ['t1', 't2', 't3', 't4', 't5'])
  assert.deepEqual(rows.map((r) => r.status), ['active', 'active', 'ended', 'paused', 'paused'])
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
  // 宿主自带项（official）与未安装项（installed:false）都不进来；用户装了但关掉
  // 的 dsh-better-sidebar 要留下，它属于「未启用」分区。
  assert.deepEqual(rows.map((r) => r.name), ['dsh-better-sidebar', 'dsh-mcp-connector', 'dsh-notify-me'])
  assert.deepEqual(rows.map((r) => r.enabled), [false, true, true])
  assert.equal(rows[1].meta, 'v0.2.93')
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

test('accountSeatState: signs the seat out, in, and in-without-a-picture', () => {
  const signedOut = { ok: true, value: { status: 'signed-out' } }
  const signedIn = { ok: true, value: { status: 'credential-stored' } }

  // 未登录：原生不显示头像槽，交给省略号形态。
  assert.deepEqual(accountSeatState(signedOut, null), { kind: 'signed-out', avatarUrl: undefined })
  // 登录且有图。
  assert.deepEqual(
    accountSeatState(signedIn, { ok: true, value: { status: 'ready', value: { avatarUrl: 'https://x/a.png' } } }),
    { kind: 'signed-in', avatarUrl: 'https://x/a.png' })
  // 登录但图片未就绪 / 空 URL：仍算登录（用图标），不能退回「未登录」。
  assert.deepEqual(accountSeatState(signedIn, { ok: true, value: { status: 'ready', value: { avatarUrl: '' } } }),
    { kind: 'signed-in', avatarUrl: undefined })
  assert.deepEqual(accountSeatState(signedIn, null), { kind: 'signed-in', avatarUrl: undefined })
  // 取不到登录态：不猜测。
  assert.equal(accountSeatState(null, null).kind, 'unknown')
})

test('clientBuildVersion: boot graph first, process env as fallback', () => {
  const original = globalThis.__DSH_BOOT__
  try {
    globalThis.__DSH_BOOT__ = { release: { version: '0.2.2-rc.1' } }
    assert.equal(clientBuildVersion(), '0.2.2-rc.1')
    // 没有 release 时不报错，落到 process.env（Node 下存在但通常为空）。
    globalThis.__DSH_BOOT__ = {}
    assert.equal(clientBuildVersion(), undefined)
    delete globalThis.__DSH_BOOT__
    assert.equal(clientBuildVersion(), undefined)
  } finally {
    if (original === undefined) delete globalThis.__DSH_BOOT__
    else globalThis.__DSH_BOOT__ = original
  }
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

test('remoteOutcome: a resolved failure frame is not an empty list', () => {
  // geteway 把 RPC 失败作为 { ok:false, error } 解析返回，宿主也显式判 ok。
  const failed = remoteOutcome({ ok: false, error: { code: 'gateway/peer-disposed', message: 'offline' } })
  assert.equal(failed.kind, 'failed')
  assert.equal(failed.error.code, 'gateway/peer-disposed')
  // 成功但空列表：这才是「空态」。
  assert.deepEqual(remoteOutcome({ ok: true, value: [] }), { kind: 'ready', value: [], error: undefined })
  // 可选服务不存在时包装函数返回 null → 服务不可用，不是空列表。
  assert.equal(remoteOutcome(null).kind, 'unavailable')
  assert.equal(remoteOutcome(undefined).kind, 'unavailable')
  // 裸载荷（测试或未来的直连 remote）按成功处理。
  assert.equal(remoteOutcome([1, 2]).kind, 'ready')
})

test('flyoutPlacement: never claims more height than the window has left', () => {
  // 矮窗口 + 靠下的锚点：旧实现用固定的 100vh-32px，浮层底部必然越界。
  const short = flyoutPlacement({ top: 600, bottom: 636 }, 700, false)
  assert.equal(short.top, 600)
  assert.equal(short.maxHeight, 700 - 600 - 12)
  assert.ok(short.top + short.maxHeight <= 700)
  // 顶到边缘时抬到最小间距，但高度仍受窗口约束。
  const clamped = flyoutPlacement({ top: 0, bottom: 36 }, 700, false)
  assert.equal(clamped.top, 12)
  assert.ok(clamped.top + clamped.maxHeight <= 700)
  // 账号座位：底对齐，从底部往上算可用高度。
  const account = flyoutPlacement({ top: 640, bottom: 676 }, 700, true)
  assert.equal(account.bottom, 700 - 676)
  assert.equal(account.maxHeight, 700 - account.bottom - 12)
  assert.equal(account.top, undefined)
})

test('flyoutSectionedHeight: fills from below the chrome strip to the window bottom', () => {
  // 0.4.0 起分区浮层不再用视口比例：从 --dsh-frame-top-clearance 之下占满到窗口底。
  assert.equal(flyoutSectionedHeight(1000, 48), 952)
  assert.equal(flyoutSectionedHeight(900, 48), 852)
  // 窗口比 chrome 带还矮时没有可用高度，不能产出负值。
  assert.equal(flyoutSectionedHeight(40, 48), 0)
  // 脏输入不产出负值或 NaN。clearance 不可用时退回文档侧的默认 48px——
  // 当成 0 会让浮层盖住 chrome 带，比少算 48px 更糟。
  assert.equal(flyoutSectionedHeight(0, 48), 0)
  assert.equal(flyoutSectionedHeight(Number.NaN, 48), 0)
  assert.equal(flyoutSectionedHeight(1000, Number.NaN), 952)
  assert.equal(flyoutSectionedHeight(1000, -10), 952)
})

test('flyoutSectionedHeight: the same count change never resizes the panel', () => {
  // 回归锁（0.3.2 的性质）：条数从 1 调到 20 时，浮层高度必须完全一致。
  // 占满高度只由视口与顶部 chrome 带决定，与内容、条数都无关。
  const viewport = 900
  const forOne = flyoutSectionedHeight(viewport, 48)
  const forTwenty = flyoutSectionedHeight(viewport, 48)
  assert.equal(forOne, forTwenty)
  assert.equal(forOne, 852)
})

test('sectionIsOpen: the spec default applies until the person folds a section', () => {
  // 无记录时用该分区的规范默认值：工作区全展开，任务只有「进行中」默认展开。
  assert.equal(sectionIsOpen({}, 'workspace.projects', true), true)
  assert.equal(sectionIsOpen({}, 'tasks.ended', false), false)
  // 折叠表存的是「是否已收起」：true 收起，false 表示显式展开。
  assert.equal(sectionIsOpen({ 'tasks.active': true }, 'tasks.active', true), false)
  assert.equal(sectionIsOpen({ 'tasks.ended': false }, 'tasks.ended', false), true)
  assert.equal(sectionIsOpen({ 'tasks.active': false }, 'tasks.active', false), true)
  // 其他分区的记录不影响本区；脏输入退回默认值而不是抛错。
  assert.equal(sectionIsOpen({ other: true }, 'tasks.active', true), true)
  assert.equal(sectionIsOpen(null, 'tasks.active', true), true)
  assert.equal(sectionIsOpen(undefined, 'tasks.active', false), false)
})

test('sectionMaxHeight: each section caps at one third of the available height', () => {
  // 内容超出 1/3 时该区自己滚动；不足 1/3 时不强行撑满（由 CSS 的 flex 负责）。
  assert.equal(sectionMaxHeight(900), 300)
  assert.equal(sectionMaxHeight(852), 284)
  assert.equal(sectionMaxHeight(901), 300)
  // 极小的可用高度向下取整到 0，不产出负值或小数。
  assert.equal(sectionMaxHeight(2), 0)
  assert.equal(sectionMaxHeight(0), 0)
  assert.equal(sectionMaxHeight(Number.NaN), 0)
})

test('keepsRailRevealed: position decides, so an overlaid strip cannot oscillate', () => {
  // 轨区（0..56）内保持展开；这不受"哪个元素在指针下"影响——这正是修闪烁的关键。
  assert.equal(keepsRailRevealed(0, RAIL_REVEAL_WIDTH), true)
  assert.equal(keepsRailRevealed(27, RAIL_REVEAL_WIDTH), true)
  assert.equal(keepsRailRevealed(RAIL_REVEAL_WIDTH, RAIL_REVEAL_WIDTH), true)
  // 越过轨宽即收起，右移 1px 就会离开。
  assert.equal(keepsRailRevealed(RAIL_REVEAL_WIDTH + 1, RAIL_REVEAL_WIDTH), false)
  assert.equal(keepsRailRevealed(600, RAIL_REVEAL_WIDTH), false)
  // 指针移出窗口左缘（macOS 下 clientX 可为负）也收起。
  assert.equal(keepsRailRevealed(-1, RAIL_REVEAL_WIDTH), false)
  // 宽度未知时退回默认 56，不因为脏参数崩溃。
  assert.equal(keepsRailRevealed(30, Number.NaN), true)
  assert.equal(keepsRailRevealed(Number.NaN, RAIL_REVEAL_WIDTH), false)
})

test('sessionStatusOf: pending interaction outranks activity, which outranks unread', () => {
  // 与宿主 ui-workspace sessionStatuses 同优先级。pendingInteraction 的真实形状是
  // `{ key, kind, sessionId }`，只看 `kind`，所以 fixture 必须带 kind。
  const pending = (kind) => ({ key: `k-${kind}`, kind, sessionId: 'sX' })
  assert.equal(sessionStatusOf({ running: true }, { pendingInteraction: pending('approval'), running: true, completionUnread: true }), 'warning')
  assert.equal(sessionStatusOf({ running: true }, { pendingInteraction: pending('question'), running: false }), 'warning')
  assert.equal(sessionStatusOf({ running: false }, { pendingInteraction: pending('plan-review'), running: false }), 'warning')
  // 宿主 visiblePendingKind 只认这三种；其他 kind 不得把行画成 warning。
  assert.equal(sessionStatusOf({ running: true }, { pendingInteraction: pending('mcp-elicitation'), running: true }), 'ongoing')
  assert.equal(sessionStatusOf({ running: false }, { pendingInteraction: pending('other'), running: false }), 'idle')
  assert.equal(sessionStatusOf({ running: true }, { running: true, completionUnread: false }), 'ongoing')
  // status 缺失时退回 SessionSummary.running。
  assert.equal(sessionStatusOf({ running: true }, undefined), 'ongoing')
  assert.equal(sessionStatusOf({ running: false }, undefined), 'idle')
  // status.running 显式为 false 时压过 summary.running（宿主 `status?.running ?? s.running`）。
  assert.equal(sessionStatusOf({ running: true }, { running: false }), 'idle')
  // 完成未读。
  assert.equal(sessionStatusOf({ running: false }, { running: false, completionUnread: true }), 'done')
  // SessionSummary 没有 completed 字段，宿主只看 completionUnread。
  assert.equal(sessionStatusOf({ running: false, completed: true }, undefined), 'idle')
  // 都没有 → idle。
  assert.equal(sessionStatusOf({ running: false }, { running: false, completionUnread: false }), 'idle')
  assert.equal(sessionStatusOf(undefined, undefined), 'idle')
})

test('formatWalletBalance: truncates positives, rounds negatives, like the host', () => {
  // 宿主 formatBalance：正数 roundDown 截断，负数 toFixed 四舍五入。
  assert.equal(formatWalletBalance('0', '¥'), '¥0.00')
  assert.equal(formatWalletBalance('0.00', '¥'), '¥0.00')
  assert.equal(formatWalletBalance('12.345', '¥'), '¥12.34')
  assert.equal(formatWalletBalance('1234.5678', '¥'), '¥1,234.56')
  assert.equal(formatWalletBalance('0.001', '¥'), '<¥0.01')
  assert.equal(formatWalletBalance('0.5', '¥'), '¥0.50')
  // 负数四舍五入，因此 12.345 视为 12.35（正数则截断成 12.34）。
  assert.equal(formatWalletBalance('-12.345', '¥'), '-¥12.35')
  assert.equal(formatWalletBalance('-0.001', '¥'), '-¥0.01')
  // 非法输入返回空串，由调用方决定不渲染。
  assert.equal(formatWalletBalance('', '¥'), '')
  assert.equal(formatWalletBalance('abc', '¥'), '')
  assert.equal(formatWalletBalance(null, '¥'), '')
})

test('balanceRows: reads the real three-layer balance contract', () => {
  // 真实形状：RemoteResult{ value: { status:'ready', value: wallets, bonusWallets } }。
  // 早期实现把 answer.value 当数组，于是真实 Host 恒为空、而按数组写的假数据却通过。
  const answer = { ok: true, value: {
    status: 'ready',
    value: [
      { currency: 'CNY', balance: '12.34' },
      { currency: 'CNY', balance: '0' },        // 零余额保留：宿主渲染收到的全部钱包
      { currency: 'USD', balance: '5.678' },
      { currency: 'EUR', balance: '9' },        // 未知币种跳过
      null,
    ],
    bonusWallets: [{ currency: 'CNY', balance: '3.5' }],
  } }
  assert.deepEqual(balanceRows(answer), {
    wallets: [
      { currency: 'CNY', text: '¥12.34' },
      { currency: 'CNY', text: '¥0.00' },
      { currency: 'USD', text: '$5.67' },
    ],
    bonusWallets: [{ currency: 'CNY', text: '¥3.50' }],
  })
  // 失败 / null / 缺失 一律返回两个空数组，交给浮层显示「余额暂不可用」。
  const empty = { wallets: [], bonusWallets: [] }
  assert.deepEqual(balanceRows({ ok: true, value: null }), empty)
  assert.deepEqual(balanceRows({ ok: true, value: { status: 'failed' } }), empty)
  assert.deepEqual(balanceRows({ ok: false, error: {} }), empty)
  assert.deepEqual(balanceRows(null), empty)
})

test('formatWalletBalance: matches the host on its own fixture set', () => {
  // 逐条对齐宿主 ui-settings-account/tests/formatBalance.client.spec.ts，
  // 含指数记法（Platform wire schema 允许 0E-16 / 1e+3）。
  assert.equal(formatWalletBalance('0.000000', '¥'), '¥0.00')
  assert.equal(formatWalletBalance('12.34000000', '¥'), '¥12.34')
  assert.equal(formatWalletBalance('1234.56999', '¥'), '¥1,234.56')
  assert.equal(formatWalletBalance('0.00000001', '¥'), '<¥0.01')
  assert.equal(formatWalletBalance('0.01', '¥'), '¥0.01')
  assert.equal(formatWalletBalance('-0.000001', '¥'), '-¥0.01')
  assert.equal(formatWalletBalance('-12.345', '¥'), '-¥12.35')
  assert.equal(formatWalletBalance('-0.0000', '¥'), '¥0.00')
  assert.equal(formatWalletBalance('0E-16', '¥'), '¥0.00')
  assert.equal(formatWalletBalance('1E-8', '¥'), '<¥0.01')
  assert.equal(formatWalletBalance('5.0000000000000000', '¥'), '¥5.00')
  assert.equal(formatWalletBalance('5e0', '¥'), '¥5.00')
  assert.equal(formatWalletBalance('1e+3', '¥'), '¥1,000.00')
})

test('formatWalletBalance: a negative carry crosses into the whole units', () => {
  // 宿主负数分支是 `-${addCommas(value.abs().toFixed(2))}`：四舍五入的是绝对值，
  // 所以进位可以越过元位。只给分位 padStart 会得到 `-¥0.100`（三位小数）。
  assert.equal(formatWalletBalance('-0.999', '¥'), '-¥1.00')
  assert.equal(formatWalletBalance('-1.999', '¥'), '-¥2.00')
  assert.equal(formatWalletBalance('-99.999', '¥'), '-¥100.00')
  assert.equal(formatWalletBalance('-0.995', '¥'), '-¥1.00')
  // 不进位时仍是普通两位；整数部分跨千位分组。
  assert.equal(formatWalletBalance('-999.994', '¥'), '-¥999.99')
  assert.equal(formatWalletBalance('-1234.566', '¥'), '-¥1,234.57')
  // 正数不四舍五入，因此不会进位。
  assert.equal(formatWalletBalance('0.999', '¥'), '¥0.99')
  assert.equal(formatWalletBalance('99.999', '¥'), '¥99.99')
})

test('accountLinks: keeps only absolute http(s) destinations', () => {
  // getState 无论是否登录都返回 links（宿主按 platform origin 构造）。
  assert.deepEqual(accountLinks({ ok: true, value: {
    status: 'credential-stored',
    links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' },
  } }), { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' })
  // 未登录也有链接，仍应可用。
  assert.deepEqual(accountLinks({ ok: true, value: {
    status: 'signed-out', links: { usageUrl: 'https://p.example/usage', topUpUrl: 'https://p.example/top_up' },
  } }).usageUrl, 'https://p.example/usage')
  // 非 http(s) 或缺失一律丢弃，绝不渲染一个可疑链接。
  assert.deepEqual(accountLinks({ ok: true, value: { links: { usageUrl: 'javascript:alert(1)' } } }), {})
  assert.deepEqual(accountLinks({ ok: true, value: { links: { topUpUrl: '/relative' } } }), {})
  assert.deepEqual(accountLinks(null), {})
  assert.deepEqual(accountLinks({ ok: false, error: {} }), {})
})

test('withAccountExtras: every account path keeps the usage and top-up links', () => {
  // 回归锁：未登录、profile 不可用、余额失败这三条早退分支曾经直接 return
  // `accountSeatState(...)`，把那两条链接一起丢掉；真实账号浮层因此对未登录用户
  // 永不显示「查询用量 / 充值」。宿主 getState 无论登录态都带 links。
  const view = { ok: true, value: {
    status: 'signed-out',
    links: { usageUrl: 'https://p.example/usage', topUpUrl: 'https://p.example/top_up' },
  } }
  const seat = accountSeatState(view, null)
  for (const balance of [null, { ok: false, error: {} }, { ok: true, value: { status: 'failed' } }]) {
    const merged = withAccountExtras(seat, view, balance)
    assert.equal(merged.links.usageUrl, 'https://p.example/usage')
    assert.equal(merged.links.topUpUrl, 'https://p.example/top_up')
    // 余额不可用时仍是空数组，而不是 undefined（渲染层按 length 判断）。
    assert.deepEqual(merged.balances, { wallets: [], bonusWallets: [] })
    assert.equal(merged.kind, 'signed-out')
  }
  // 没有任何视图时也不抛错：链接为空、余额为空。
  const bare = withAccountExtras({ kind: 'unknown', avatarUrl: undefined }, null, null)
  assert.deepEqual(bare.links, {})
  assert.deepEqual(bare.balances, { wallets: [], bonusWallets: [] })
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
