/**
 * 偏好读写（置顶项目与展开项目）。
 *
 * 存储只保存 `pinnedWorkspaceIds` 与 `expandedProjectIds`（键
 * `dsh.sidebar-rail.v1`）；**分区收起状态与列表水位都不落盘**
 * （spec-0.5.0 §4.2、spec-0.5.1 §4）。
 *
 * 每次写入都是「先重读、再合并」，因此一个字段的写入不会覆盖另一个字段。
 * 0.5.1 移除了可调的 `recentCount` 偏好——它已整项删除，合并语义现在只服务
 * 上面两个字段，但「不互相覆盖」这条性质必须继续成立。
 */
import { STORE_KEY } from './model/constants.ts'

/**
 * 持久化的插件状态。
 *
 * 字段都可缺席：旧版本写入的对象可能还带着已废弃的 `recentCount`。读路径
 * **不清理**未知字段（读不写盘），所以老存储里的 `recentCount` 会原样留着，
 * 却再没有任何代码读它。
 */
export interface StoredRailState {
  readonly pinnedWorkspaceIds?: readonly string[] | undefined
  /** 展开中的项目（工作区 id 数组）；0.5.0 起与置顶字段共用同一个键。 */
  readonly expandedProjectIds?: readonly string[] | undefined
}

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
 *
 * 「先重读、再合并」是这里唯一的写入口：调用方只交自己要改的字段，其余字段
 * （置顶、展开项目，以及旧版本遗留的未知字段）原样保留。
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
 * 读取持久化的展开项目 id 列表，忽略非字符串项。
 *
 * 存储是手可编辑的明文 JSON，任何畸形值（数字、null、嵌套对象、非数组）都必须
 * 在这里被吸收，绝不能漏到渲染层当键用。失效的工作区 id（项目已被删除）**原样
 * 返回、不写回清理**：读路径不产生写盘，这类 id 只是在 UI 上不产生效果
 * （spec-0.5.0 §4.2 决策 2）。
 * @returns 只含非空字符串的数组（保持存储顺序），缺失或不可读时返回空数组。
 */
export function readExpandedProjectIds(): readonly string[] {
  const stored = readStore().expandedProjectIds
  if (!Array.isArray(stored)) return []
  const out: string[] = []
  for (const entry of stored) {
    if (typeof entry === 'string' && entry !== '') out.push(entry)
  }
  return out
}

/**
 * 写入展开中的项目 id 列表（合并语义）。
 *
 * 走 `writeStore` 的「先重读、再合并」，因此不会覆盖 `pinnedWorkspaceIds`。
 * 传入空数组即清空该字段，其他字段仍保留。
 * @param ids - 展开中的工作区 id；非字符串项被丢弃，重复项去重并保序。
 * @returns 无。存储失败只损失持久化，不影响渲染。
 */
export function writeExpandedProjectIds(ids: readonly string[] | null | undefined): void {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(ids) ? ids : []) {
    if (typeof entry !== 'string' || entry === '' || seen.has(entry)) continue
    seen.add(entry)
    unique.push(entry)
  }
  writeStore({ expandedProjectIds: unique })
}
