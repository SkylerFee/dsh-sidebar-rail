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
  remoteOutcome, flyoutPlacement, keepsRailRevealed, RAIL_REVEAL_WIDTH, readRecentCount, sessionStatusOf, formatWalletBalance, balanceRows, accountLinks }`)()

const { deriveSections, normalizeTasks, normalizePlugins, relativeTime, shortPath, selectorHook,
  resolveLocaleId, shouldRenderRail, RAIL_MIN_VIEWPORT, currentSessionId, accountSeatState,
  accountClientMetadata, clientBuildVersion, readRecentCount, sessionStatusOf,
  formatWalletBalance, balanceRows, accountLinks, remoteOutcome, flyoutPlacement,
  keepsRailRevealed, RAIL_REVEAL_WIDTH, EMPTY_SESSIONS } = helpers

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
  // 与宿主 ui-workspace sessionStatuses 同优先级。
  assert.equal(sessionStatusOf({ running: true }, { pendingInteraction: 'approval', running: true, completionUnread: true }), 'warning')
  assert.equal(sessionStatusOf({ running: true }, { pendingInteraction: 'question', running: false }), 'warning')
  assert.equal(sessionStatusOf({ running: true }, { running: true, completionUnread: false }), 'ongoing')
  // status 缺失时退回 SessionSummary.running。
  assert.equal(sessionStatusOf({ running: true }, undefined), 'ongoing')
  assert.equal(sessionStatusOf({ running: false }, undefined), 'idle')
  // 完成未读。
  assert.equal(sessionStatusOf({ running: false }, { running: false, completionUnread: true }), 'done')
  assert.equal(sessionStatusOf({ running: false, completed: true }, undefined), 'done')
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
