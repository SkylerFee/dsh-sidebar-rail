/**
 * 偏好读写与共享快照。
 *
 * 两个设置入口（插件详情页与图标轨浮层）必须共享同一个 `recentCount`：此前各自
 * 持有一个 `useState`、只在挂载时读一次，于是在一处改成 8、在另一处按「+」
 * 会把 7 写回存储。模块级 store 同时修掉「读到旧值」与「覆盖别人的写入」。
 *
 * 存储只保存 `pinnedWorkspaceIds` 与 `recentCount`（键 `dsh.sidebar-rail.v1`）；
 * 分区与项目展开状态一律不落盘。
 */
import { STORE_KEY } from './model/constants.ts'
import { readRecentCount } from './model/formatting.ts'

/** 持久化的插件状态；两个字段都可缺席。 */
export interface StoredRailState {
  readonly pinnedWorkspaceIds?: readonly string[] | undefined
  readonly recentCount?: unknown
}

/** 偏好快照的订阅者。 */
type Listener = () => void

/** 当前 `recentCount`，或首次读取前为 undefined。 */
let recentCountSnapshot: number | undefined
/** 监听 `recentCount` 变化的所有界面。 */
const recentCountListeners = new Set<Listener>()

/**
 * 读取持久化的图标轨状态。
 * @returns 解析后的对象；缺失或不可读时返回空对象。
 */
export function readStore(): StoredRailState {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? (parsed as StoredRailState) : {}
  } catch {
    return {}
  }
}

/**
 * 把一个补丁合并进持久化的图标轨状态。
 * @param patch - 要合并的部分状态。
 * @returns 无。存储失败只损失持久化，不影响渲染。
 */
export function writeStore(patch: Partial<StoredRailState>): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...readStore(), ...patch }))
  } catch {
    // 被禁用的存储后端绝不能打断渲染。
  }
}

/**
 * 读取持久化的 `recentCount`，并夹取存储里的任何值。
 * @returns MIN_RECENT_COUNT..MAX_RECENT_COUNT 之间的整数。
 */
export function readRecentCountFromStore(): number {
  return readRecentCount(readStore().recentCount)
}

/**
 * 把新的 `recentCount` 发布给每个界面并写入存储。
 *
 * 合并前会重新读一次存储，这样并发写入者不会被本界面内存里的旧值覆盖。
 * @param next - 请求的条数；写入前先夹取。
 * @returns 实际发布的夹取后的值。
 */
export function setRecentCount(next: unknown): number {
  const value = readRecentCount(next)
  recentCountSnapshot = value
  writeStore({ recentCount: value })
  for (const listener of recentCountListeners) listener()
  return value
}

/**
 * 为 `useSyncExternalStore` 订阅 `recentCount`。
 * @param listener - 每次发布后调用。
 * @returns 取消订阅函数。
 */
export function subscribeRecentCount(listener: Listener): () => void {
  recentCountListeners.add(listener)
  return () => {
    recentCountListeners.delete(listener)
  }
}

/**
 * 读取当前 `recentCount` 快照。
 *
 * 首次调用会从存储物化，于是同一会话里挂载的两个界面立刻一致。发布之后内存
 * 快照即权威：存储只能经由本模块改变。
 * @returns MIN_RECENT_COUNT..MAX_RECENT_COUNT 之间的整数。
 */
export function getRecentCountSnapshot(): number {
  if (recentCountSnapshot === undefined) recentCountSnapshot = readRecentCountFromStore()
  return recentCountSnapshot
}
