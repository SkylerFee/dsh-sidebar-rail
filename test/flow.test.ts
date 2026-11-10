/**
 * 流程与生命周期测试：迁移后新增的模块边界需要能独立验证的那些行为。
 *
 * 覆盖 docs/typescript-migration.md §5.2 点名的风险：
 *   - `recentCount` 在轨与设置块之间共享，且写入不覆盖置顶数据；
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
  getRecentCountSnapshot,
  readExpandedProjectIds,
  readStore,
  setRecentCount,
  subscribeRecentCount,
  writeExpandedProjectIds,
  writeStore,
} from '../src/client/preferences.ts'
import {
  DEFAULT_RECENT_COUNT,
  MAX_RECENT_COUNT,
  MIN_RECENT_COUNT,
  RAIL_REVEAL_WIDTH,
  STORE_KEY,
} from '../src/client/model/constants.ts'
import { DEFAULT_FLYOUT_ANCHOR, flyoutAnchorFrom, sectionIsOpen } from '../src/client/model/geometry.ts'
import { readRecentCount } from '../src/client/model/formatting.ts'
import { pickedDirectory, remoteOutcome } from '../src/client/model/remote.ts'

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

test('preferences: recentCount is shared between the rail and the settings block', () => {
  installStorage()
  // 两个界面各订阅一次：任一次发布都必须通知到两边。
  const railSeen: number[] = []
  const settingsSeen: number[] = []
  const offRail = subscribeRecentCount(() => railSeen.push(getRecentCountSnapshot()))
  const offSettings = subscribeRecentCount(() => settingsSeen.push(getRecentCountSnapshot()))
  try {
    setRecentCount(8)
    assert.deepEqual(railSeen, [8], 'the rail surface sees the new value')
    assert.deepEqual(settingsSeen, [8], 'the settings surface sees the same value')
    assert.equal(getRecentCountSnapshot(), 8, 'both surfaces read one snapshot')
  } finally {
    offRail()
    offSettings()
  }
})

test('preferences: setRecentCount clamps and never drops the pinned list', () => {
  const { data } = installStorage({
    [STORE_KEY]: JSON.stringify({ pinnedWorkspaceIds: ['ws1', 'ws2'], recentCount: 3 }),
  })
  // 夹取到合法范围，且合并写入——置顶列表必须原样保留。
  assert.equal(setRecentCount(999), MAX_RECENT_COUNT)
  assert.equal(setRecentCount(0), MIN_RECENT_COUNT)
  const stored = JSON.parse(data.get(STORE_KEY) ?? '{}') as { pinnedWorkspaceIds: string[]; recentCount: number }
  assert.deepEqual(stored.pinnedWorkspaceIds, ['ws1', 'ws2'], 'the pinned list survives a recentCount write')
  assert.equal(stored.recentCount, MIN_RECENT_COUNT)
})

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

test('preferences: writing expandedProjectIds never drops pins or recentCount', () => {
  const { data } = installStorage({
    [STORE_KEY]: JSON.stringify({ pinnedWorkspaceIds: ['ws1', 'ws2'], recentCount: 7 }),
  })
  writeExpandedProjectIds(['ws3'])
  const stored = JSON.parse(data.get(STORE_KEY) ?? '{}') as {
    pinnedWorkspaceIds: string[]
    recentCount: number
    expandedProjectIds: string[]
  }
  assert.deepEqual(stored.expandedProjectIds, ['ws3'])
  assert.deepEqual(stored.pinnedWorkspaceIds, ['ws1', 'ws2'], 'pins survive an expandedProjectIds write')
  assert.equal(stored.recentCount, 7, 'the recent count survives too')
  // 反方向：写 recentCount 也不能抹掉展开列表。
  setRecentCount(3)
  assert.deepEqual(readExpandedProjectIds(), ['ws3'], 'the expanded list survives a recentCount write')
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
  assert.doesNotThrow(() => writeStore({ recentCount: 4 }))
})

test('preferences: a cleared preference falls back to the default, not to one row', () => {
  // 空白字符串是「未设置」：Number('') 为 0 会被误夹到 1，于是一次清空偏好
  // 会静默变成「只显示一条」。
  assert.equal(readRecentCount('   '), DEFAULT_RECENT_COUNT)
  assert.equal(readRecentCount(''), DEFAULT_RECENT_COUNT)
  assert.equal(readRecentCount(null), DEFAULT_RECENT_COUNT)
  assert.equal(readRecentCount(undefined), DEFAULT_RECENT_COUNT)
  assert.equal(readRecentCount('junk'), DEFAULT_RECENT_COUNT)
  // 越界与浮点仍然夹进范围。
  assert.equal(readRecentCount(0), MIN_RECENT_COUNT)
  assert.equal(readRecentCount(999), MAX_RECENT_COUNT)
  assert.equal(readRecentCount('3.6'), 4)
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