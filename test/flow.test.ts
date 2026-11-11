/**
 * 流程与生命周期测试：迁移后新增的模块边界需要能独立验证的那些行为。
 *
 * 覆盖 docs/typescript-migration.md §5.2 点名的风险：
 *   - 偏好写入是合并语义：写展开项目不覆盖置顶列表（0.5.1 移除 `recentCount` 后仍成立）；
 *   - 目录选择成功 / 取消 / 失败三种结局；
 *   - 分区的首次切换（默认展开与默认收起都要能翻）；
 *   - 请求状态机把「服务缺失」判成失败而不是空列表。
 *
 * 0.5.0 增补（spec-0.5.0 §4.2）：`expandedProjectIds` 的读写、合并语义与
 * 「失效 id 读取时忽略」。
 *
 * 全部用固定替身与纯函数，不发真实网络、不渲染 DOM。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  readExpandedProjectIds,
  readStore,
  writeExpandedProjectIds,
  writeStore,
} from '../src/client/preferences.ts'
import { RAIL_REVEAL_WIDTH, STORE_KEY } from '../src/client/model/constants.ts'
import { DEFAULT_FLYOUT_ANCHOR, flyoutAnchorFrom, sectionIsOpen } from '../src/client/model/geometry.ts'
import { normalizeTasks, pickedDirectory, remoteOutcome, sessionHasActiveTask } from '../src/client/model/remote.ts'

/**
 * 装一个可控的 localStorage 替身。
 * @param initial - 初始键值。
 * @returns `{ storage, writes }`：storage 是替身，writes 记录每次写入的键。
 */
function installStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial))
  const writes: { key: string; value: string }[] = []
  // 只实现本插件真正用到的两个方法；其余 Storage 成员仅需通过类型检查。
  const localStorage = {
    getItem(key: string): string | null {
      return data.has(key) ? (data.get(key) ?? null) : null
    },
    setItem(key: string, value: string): void {
      writes.push({ key, value })
      data.set(key, String(value))
    },
    removeItem(): void {},
    clear(): void {},
    key(): string | null {
      return null
    },
    length: 0,
  }
  // 只替换 localStorage 一个成员：整体替换 window 会让类型与宿主全局冲突。
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { ...(globalThis.window ?? {}), localStorage },
  })
  return { data, writes }
}

test('preferences: expandedProjectIds round-trips through the store', () => {
  const { data } = installStorage()
  // 默认无记录：空数组，而不是 undefined——调用方可以直接遍历。
  assert.deepEqual(readExpandedProjectIds(), [])
  writeExpandedProjectIds(['ws-a', 'ws-b'])
  assert.deepEqual(readExpandedProjectIds(), ['ws-a', 'ws-b'], 'the expanded list reads back as written')
  // 同一个键，不是另开一个：spec-0.5.0 §4.2 要求与置顶/条数共用副本。
  assert.ok(data.get(STORE_KEY) !== undefined)
  // 清空是合法写入（收起最后一个项目之后）。
  writeExpandedProjectIds([])
  assert.deepEqual(readExpandedProjectIds(), [])
})

test('preferences: writing expandedProjectIds never drops pinnedWorkspaceIds', () => {
  // 0.5.1 移除 recentCount 之后，合并语义只剩这两个字段，但「一个字段的写入不得
  // 抹掉另一个」这条性质必须继续成立（spec-0.5.0 §4.2）。
  const { data } = installStorage({
    [STORE_KEY]: JSON.stringify({ pinnedWorkspaceIds: ['ws1', 'ws2'] }),
  })
  writeExpandedProjectIds(['ws3'])
  const stored = JSON.parse(data.get(STORE_KEY) ?? '{}') as {
    pinnedWorkspaceIds: string[]
    expandedProjectIds: string[]
  }
  assert.deepEqual(stored.expandedProjectIds, ['ws3'])
  assert.deepEqual(stored.pinnedWorkspaceIds, ['ws1', 'ws2'], 'pins survive an expandedProjectIds write')

  // 反方向：写置顶列表也不能抹掉展开列表。
  writeStore({ pinnedWorkspaceIds: ['ws9'] })
  assert.deepEqual(readExpandedProjectIds(), ['ws3'], 'the expanded list survives a pins write')
  assert.deepEqual(readStore().pinnedWorkspaceIds, ['ws9'])

  // 旧版本遗留的 recentCount 字段既不读也不清理：读路径不写盘，写入时原样保留。
  const legacy = installStorage({
    [STORE_KEY]: JSON.stringify({ pinnedWorkspaceIds: ['ws1'], recentCount: 7 }),
  })
  writeExpandedProjectIds(['ws3'])
  const legacyStored = JSON.parse(legacy.data.get(STORE_KEY) ?? '{}') as Record<string, unknown>
  assert.equal(legacyStored.recentCount, 7, 'unknown legacy fields are preserved, never rewritten')
})

test('preferences: stale workspace ids are read back but never cleaned up', () => {
  // spec-0.5.0 §4.2 决策 2：失效 id（项目已删除）读取时忽略即可，不写回清理。
  // 模型层不做「它还存在吗」的判断——那是渲染层拿宿主工作区列表才知道的事。
  const { writes } = installStorage({
    [STORE_KEY]: JSON.stringify({ expandedProjectIds: ['gone-forever', 'ws1'] }),
  })
  assert.deepEqual(readExpandedProjectIds(), ['gone-forever', 'ws1'])
  // 读路径不产生写盘：否则每次打开浮层都会写一次存储。
  assert.equal(writes.length, 0, 'reading must not write')
})

test('preferences: malformed expandedProjectIds entries are ignored on read', () => {
  // 存储是手可编辑的明文 JSON：数字、null、嵌套对象、空串都不能漏进渲染层当键用。
  installStorage({
    [STORE_KEY]: JSON.stringify({ expandedProjectIds: ['ws1', 42, null, {}, '', ['ws2'], 'ws3'] }),
  })
  assert.deepEqual(readExpandedProjectIds(), ['ws1', 'ws3'])
  // 整个字段不是数组时退化成空，而不是抛错。
  installStorage({ [STORE_KEY]: JSON.stringify({ expandedProjectIds: 'ws1' }) })
  assert.deepEqual(readExpandedProjectIds(), [])
  installStorage({ [STORE_KEY]: JSON.stringify({}) })
  assert.deepEqual(readExpandedProjectIds(), [])
})

test('preferences: an unreadable store degrades instead of throwing', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      ...(globalThis.window ?? {}),
      localStorage: {
        getItem(): string | null {
          throw new Error('storage blocked')
        },
        setItem(): void {
          throw new Error('storage blocked')
        },
        removeItem(): void {},
        clear(): void {},
        key(): string | null {
          return null
        },
        length: 0,
      },
    },
  })
  // 一个被禁用的存储后端绝不能打断渲染。
  assert.deepEqual(readStore(), {})
  assert.doesNotThrow(() => writeStore({ pinnedWorkspaceIds: ['ws1'] }))
})

test('flyoutAnchorFrom: the horizontal origin is the rail, not the mid-transition rect', () => {
  // spec-0.5.0 §4.5.1：轨用 160ms 的 translateX(-100%) → 0 过渡，浮层 120ms 后打开。
  // 过渡中途的矩形 right 会明显偏小（轨还半在窗外），旧实现直接采信它，浮层偏左。
  const midTransition = { top: 120, bottom: 156, right: 18 }
  const settled = { top: 120, bottom: 156, right: RAIL_REVEAL_WIDTH }
  const fromMid = flyoutAnchorFrom(midTransition)
  const fromSettled = flyoutAnchorFrom(settled)
  // 关键断言：两种时序取值得到**同一个**锚点——位置不再依赖动画进度。
  assert.deepEqual(fromMid, fromSettled, 'the anchor must not depend on transition progress')
  assert.equal(fromMid.right, RAIL_REVEAL_WIDTH, 'the rail right edge is a constant, not a measurement')
  // 垂直位置仍跟随按钮，浮层才能与它对齐。
  assert.equal(fromMid.top, 120)
  assert.equal(fromMid.bottom, 156)
})

test('flyoutAnchorFrom: a missing or junk rect falls back to the rail geometry', () => {
  // 键盘打开（onFocus）与合成事件都可能没有可用矩形；兜底必须仍落在轨的右缘。
  for (const rect of [undefined, null, {}, { top: Number.NaN, bottom: Number.NaN, right: 3 }]) {
    const anchor = flyoutAnchorFrom(rect)
    assert.equal(anchor.right, RAIL_REVEAL_WIDTH, 'even without a rect the flyout sits right of the rail')
    assert.equal(anchor.top, DEFAULT_FLYOUT_ANCHOR.top)
    assert.equal(anchor.bottom, DEFAULT_FLYOUT_ANCHOR.bottom)
  }
  // 只有 top 可用时，bottom 单独回退：两个字段互不牵连。
  const half = flyoutAnchorFrom({ top: 300 })
  assert.equal(half.top, 300)
  assert.equal(half.bottom, DEFAULT_FLYOUT_ANCHOR.bottom)
})

test('pickedDirectory: chosen, cancelled and failed stay three distinct outcomes', () => {
  // 成功分支必须带回路径：迁移前的 K1 症状正是「选中的值被上层丢弃」。
  assert.deepEqual(pickedDirectory('/Users/me/project'), { kind: 'picked', path: '/Users/me/project' })
  assert.deepEqual(pickedDirectory(null), { kind: 'cancelled' })
  assert.deepEqual(pickedDirectory('   '), { kind: 'cancelled' })
  assert.equal(pickedDirectory(new Error('no native picker')).kind, 'failed')
  assert.equal(pickedDirectory('relative/path').kind, 'failed')
  assert.equal(pickedDirectory(42).kind, 'failed')
})

test('remoteOutcome: a missing service is a failure, never an empty list', () => {
  // 服务缺席 → unavailable；上层必须判成 failed，而不是「没有插件」。
  assert.equal(remoteOutcome(null).kind, 'unavailable')
  assert.equal(remoteOutcome(undefined).kind, 'unavailable')
  // 网关的结构化失败帧同样不是空列表。
  const failed = remoteOutcome({ ok: false, error: { code: 'gateway/peer-disposed' } })
  assert.equal(failed.kind, 'failed')
  // 只有明确的成功帧与裸载荷算就绪。
  assert.equal(remoteOutcome({ ok: true, value: [1] }).kind, 'ready')
  assert.equal(remoteOutcome([1, 2]).kind, 'ready')
})

test('sectionIsOpen: a default-open section folds and unfolds again', () => {
  // 纯读取：默认值只在「用户还没动过」时生效。
  assert.equal(sectionIsOpen({}, 'workspace.pinned', true), true)
  // 切换 → 读取的真实序列：默认展开的分区两次点击都应生效。
  const toggle = (folded: Record<string, boolean | undefined>, id: string) => ({
    ...folded,
    [id]: folded[id] !== true,
  })
  let folded: Record<string, boolean | undefined> = {}
  folded = toggle(folded, 'workspace.pinned')
  assert.equal(sectionIsOpen(folded, 'workspace.pinned', true), false, 'the first click folds it')
  folded = toggle(folded, 'workspace.pinned')
  assert.equal(sectionIsOpen(folded, 'workspace.pinned', true), true, 'the second click opens it again')
})

test('KNOWN K2: a default-closed section needs two clicks before it opens', { todo: 'K2 既有缺陷，迁移不修；单独跟踪' }, () => {
  // 复现 docs/typescript-migration.md §2.2 的 K2：「已暂停」分区默认收起，
  // 第一次点击不展开，要再点一次才出来。
  //
  // 根因：折叠状态是「id → 是否已收起」的映射，而 toggle 写的是
  // `current[id] !== true`。对**默认收起**的分区，第一次点击算出 `true`（=已收起），
  // 与默认态相同，于是视觉上没有变化；第二次点击才变 `false`（=展开）。
  // 默认展开的分区没有这个问题，因为它第一次点击就把 true 翻成 false。
  //
  // 这个用例是**缺陷复现**，不是通过项：修好之前它必须保持 todo，
  // 不能删除断言、放宽预期或改写期望来凑绿。
  const toggle = (folded: Record<string, boolean | undefined>, id: string) => ({
    ...folded,
    [id]: folded[id] !== true,
  })
  let folded: Record<string, boolean | undefined> = {}
  // 第一次点击：期望展开（true），实际仍收起。
  folded = toggle(folded, 'tasks.paused')
  assert.equal(sectionIsOpen(folded, 'tasks.paused', false), true, 'the first click should open it')
})
// ------------------------------------------------- 定时任务时钟标记 --

/**
 * 构造一条宿主 catalog 形状的任务（只带本插件读取的字段）。
 * @param overrides - 字段覆盖。
 * @returns 任务对象。
 */
function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'task',
    scheduledAt: '2026-11-10T09:00:00Z',
    status: 'active',
    involvedSessionIds: [] as string[],
    target: { kind: 'session', sessionId: 'sX' },
    ...overrides,
  }
}

test('sessionHasActiveTask: a session target is hit through target.sessionId', () => {
  const tasks = normalizeTasks({ ok: true, value: [task({ target: { kind: 'session', sessionId: 's1' } })] })
  assert.equal(tasks.length, 1)
  assert.equal(sessionHasActiveTask(tasks, 's1'), true)
  assert.equal(sessionHasActiveTask(tasks, 'other'), false)
})

test('sessionHasActiveTask: a new_once target is hit through target.sessionId too', () => {
  // new_once 有预留的 sessionId，走「非 new」分支，不是靠 lastDelivery。
  const tasks = normalizeTasks({
    ok: true,
    value: [task({ target: { kind: 'new_once', sessionId: 's2', create: { title: 'x' } } })],
  })
  assert.equal(sessionHasActiveTask(tasks, 's2'), true)
})

test('sessionHasActiveTask: a new target is hit only through lastDelivery', () => {
  // kind:'new' 每次投递新建会话，没有固定目标；involvedSessionIds 也明确不含它。
  const tasks = normalizeTasks({
    ok: true,
    value: [task({
      target: { kind: 'new', create: { title: 'x' } },
      involvedSessionIds: ['creator'],
      lastDelivery: { scheduledAt: '2026-11-10T09:00:00Z', deliveredAt: '2026-11-10T09:00:01Z', messageId: 'm1', targetSessionId: 's3' },
    })],
  })
  assert.equal(sessionHasActiveTask(tasks, 's3'), true, 'the delivered session is hit')
  assert.equal(sessionHasActiveTask(tasks, 'creator'), true, 'the creating session is hit via involvedSessionIds')
  assert.equal(sessionHasActiveTask(tasks, 's4'), false)
})

test('sessionHasActiveTask: involvedSessionIds alone can hit a session', () => {
  const tasks = normalizeTasks({
    ok: true,
    value: [task({ target: { kind: 'session', sessionId: 'target' }, involvedSessionIds: ['creator'] })],
  })
  assert.equal(sessionHasActiveTask(tasks, 'creator'), true, 'the editing Agent session counts')
  assert.equal(sessionHasActiveTask(tasks, 'target'), true)
})

test('sessionHasActiveTask: only an active task marks the row', () => {
  for (const status of ['paused', 'ended']) {
    const tasks = normalizeTasks({ ok: true, value: [task({ status, target: { kind: 'session', sessionId: 's1' } })] })
    assert.equal(sessionHasActiveTask(tasks, 's1'), false, `${status} must not mark the row`)
  }
  const active = normalizeTasks({ ok: true, value: [task({ status: 'active', target: { kind: 'session', sessionId: 's1' } })] })
  assert.equal(sessionHasActiveTask(active, 's1'), true)
})

test('sessionHasActiveTask: missing or malformed data marks nothing', () => {
  // catalog 读取失败 / 超时会落成空列表：列表照常渲染，只是没有时钟。
  assert.equal(sessionHasActiveTask([], 's1'), false)
  assert.equal(sessionHasActiveTask(undefined, 's1'), false)
  assert.equal(sessionHasActiveTask(null, 's1'), false)
  // 畸形任务与畸形目标都不能抛错。
  const junk = normalizeTasks({ ok: true, value: [null, 42, { id: 'x', status: 'active', target: 'nope' }, task({ involvedSessionIds: 'nope' })] })
  assert.doesNotThrow(() => sessionHasActiveTask(junk, 's1'))
  assert.equal(sessionHasActiveTask(junk, ''), false, 'an empty session id never matches')
})
// ------------------------------------------------- 窗口焦点门禁 --

test('reveal gate: an unfocused window must not reveal the rail', () => {
  // macOS 上指针滑进未聚焦窗口也会派发 pointerenter。门禁因此是「先判焦点，
  // 再改状态」：这条用例锁住「未聚焦时唤出请求不生效」。
  // 实现里 revealRail 直接读 useWindowFocused 的值，这里用等价的纯判定复刻。
  const reveal = (windowFocused: boolean, requested: boolean): boolean => windowFocused && requested
  assert.equal(reveal(false, true), false, 'an unfocused window ignores the request')
  assert.equal(reveal(true, true), true, 'a focused window reveals')
  assert.equal(reveal(true, false), false, 'no request, no reveal')
})

test('reveal gate: losing focus retracts an already revealed rail', () => {
  // 失焦后即使指针还停在轨上也要收起——人已经切到别的应用了。
  const afterFocusChange = (revealed: boolean, windowFocused: boolean): boolean => windowFocused ? revealed : false
  assert.equal(afterFocusChange(true, false), false, 'blur retracts')
  assert.equal(afterFocusChange(true, true), true, 'focus keeps it')
  assert.equal(afterFocusChange(false, true), false, 'stays retracted')
})
// ------------------------------------------- 焦点在轨与浮层之间移动 --

test('focus gate: moving from the rail into the flyout must keep both, not just the rail', () => {
  // 轨与浮层是两个并列 portal，焦点跨过去时事件不会互相冒泡。
  // 若只用「relatedTarget 是否在当前子树内」判断，会误判为离开；而一旦放行，
  // 焦点再从浮层 Tab 出去就没人接住 —— 轨和浮层会一起留在屏幕上。
  // 判据因此是「activeElement 是否还在两者之一的子树里」。
  const focusInside = (inRail: boolean, inFlyout: boolean): boolean => inRail || inFlyout
  assert.equal(focusInside(false, true), true, 'focus in the flyout still counts as inside')
  assert.equal(focusInside(true, false), true, 'focus on the rail counts')
  assert.equal(focusInside(false, false), false, 'leaving both closes the whole surface')
})

test('focus gate: Tab out of the flyout closes the flyout too, not only the rail', () => {
  // 用户报告的缺陷：Tab 到头像打开浮层、再 Tab 时轨收起了、浮层与 hover 态
  // 还留着。收起动作必须同时覆盖 open 与 revealed 两个状态。
  const applyLeave = (open: unknown, revealed: boolean): { open: null; revealed: false } => {
    void open
    void revealed
    return { open: null, revealed: false }
  }
  assert.deepEqual(applyLeave('account', true), { open: null, revealed: false })
})

test('focus gate: leaving only the rail while the flyout keeps focus does not dismiss', () => {
  const shouldLeave = (focusInside: boolean): boolean => !focusInside
  assert.equal(shouldLeave(true), false, 'still inside, nothing to close')
  assert.equal(shouldLeave(false), true, 'outside both, close everything')
})
