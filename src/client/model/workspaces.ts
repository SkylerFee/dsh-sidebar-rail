/**
 * 工作区、项目成员与最近会话的纯模型。
 *
 * 两种列表的策略**刻意不同**，迁移后仍保持原样：
 *   - 项目成员（`projectSessionRows`）：一条不筛，按宿主 `sessionIds` 顺序，不限条数；
 *   - 最近会话（`deriveSections`）：过滤子代理、空白、归档，按更新时间倒序，限量。
 */
import { relativeTime, sessionStatusOf, shortPath } from './formatting.ts'
import { readRecentCount } from './formatting.ts'
import type {
  ProjectSessionRow,
  RailSections,
  RecentSessionRow,
  SessionById,
  SessionId,
  SessionListStateLike,
  SessionStatusLike,
  SessionStatusSnapshotLike,
  SessionSummaryLike,
  WorkspaceRow,
  WorkspaceViewLike,
} from './types.ts'

/**
 * 构造项目展开后要显示的会话行。
 *
 * 策略**刻意与「最近会话」区相反**：这份列表回答「这个项目里有什么」，
 * 所以一条都不筛——归档或空白会话仍是该项目的会话，照列，只用标记位让渲染层标注。
 * 顺序沿用宿主 `sessionIds` 的成员顺序，绝不按时间重排，也不设条数上限。
 *
 * 子代理子会话不会出现在这里，但这是宿主的行为而非本函数过滤：宿主
 * `attachSession` 没有 subagent 调用点，那些会话根本不进 `sessionIds`。
 * 再按 `origin` 筛一遍，只会在宿主改变行为时误伤真实会话。
 *
 * 快照里缺失的成员仍会产出一行（标题退化为 id）：`sessionIds` 来自工作区
 * registry，`byId` 来自会话快照，重命名或删除的瞬间两者可能差一帧。
 * 丢掉该行会让一个会话从它自己的项目里凭空消失。
 * @param sessionIds - `WorkspaceView.sessionIds`，宿主顺序。
 * @param byId - `useSessions` 提供的会话摘要，按 id 索引。
 * @param language - 当前 locale id，用于相对时间。
 * @param archivedIds - 归档会话 id，只用于打标记。
 * @param shownSessionId - 主视图正在显示的会话，只用于打标记。
 * @returns 行数组，不排序、不过滤。
 */
export function projectSessionRows(
  sessionIds: readonly SessionId[] | null | undefined,
  byId: SessionById | null | undefined,
  language: string | null | undefined,
  archivedIds?: readonly SessionId[] | null | undefined,
  shownSessionId?: SessionId | undefined,
): ProjectSessionRow[] {
  if (!Array.isArray(sessionIds)) return []
  const summaries = byId !== null && byId !== undefined && typeof byId === 'object' ? byId : {}
  const archived = new Set<SessionId>(Array.isArray(archivedIds) ? archivedIds : [])
  const rows: ProjectSessionRow[] = []
  for (const raw of sessionIds) {
    if (raw === null || raw === undefined) continue
    const id = String(raw)
    const entry = summaries[id]
    if (entry === null || entry === undefined || typeof entry !== 'object') {
      rows.push({ id, title: id, meta: '', archived: archived.has(id), current: id === shownSessionId })
      continue
    }
    rows.push({
      id,
      title: entryDisplayTitle(entry, id),
      meta: relativeTime(entry.updatedAt, language),
      archived: archived.has(id),
      current: id === shownSessionId,
    })
  }
  return rows
}

/**
 * 求主视图正在显示的会话。
 *
 * 宿主的答案在 ui-workspace/tree.ts 与 ui-session（`publishMain`）里：扫描会话
 * 列表，找主视图保留的那条（`retainedBy.mainView > 0`）。读同一个标志才能让
 * 图标轨与宿主侧栏不出现分歧；没有 `activeSessionId` 道具可读。
 *
 * 已在 Desktop 0.2.2-rc.1 验证：会话打开时宿主自己的侧栏行并不高亮、
 * 该标志读到 0，于是图标轨也不显示高亮——同一来源、同一结果。如果日后宿主
 * 重新维护该计数，两个界面会一起亮起，这里不需要改。
 * @param sessions - `useSessions` 的 SessionListState。
 * @param panelCovering - 非会话面板是否盖住了会话区。
 * @returns 当前会话 id；没有会话显示时返回 undefined。
 */
export function currentSessionId(
  sessions: SessionListStateLike | null | undefined,
  panelCovering?: boolean,
): SessionId | undefined {
  // 别的面板盖住会话时宿主会清掉自己的高亮；跟着做，图标轨就不会声称
  // 一个没人展示的会话。
  if (panelCovering === true) return undefined
  const byId = sessions?.byId
  if (byId === null || byId === undefined || typeof byId !== 'object') return undefined
  for (const entry of Object.values(byId)) {
    if (entry === null || entry === undefined || typeof entry !== 'object') continue
    const retained = entry.retainedBy
    const mainView = retained === null || retained === undefined || typeof retained !== 'object'
      ? 0
      : retained.mainView
    if (typeof mainView === 'number' && Number.isFinite(mainView) && mainView > 0) return entry.id
  }
  return undefined
}

/**
 * 把工作区拆成置顶区与普通区，并收集最近会话。
 * @param items - `WorkspaceView[]`。
 * @param sessions - SessionListState。
 * @param archivedIds - 归档会话 id。
 * @param pinnedIds - 本地置顶的工作区 id，最近的在前。
 * @param language - 当前 locale id。
 * @param panelCovering - 非会话面板是否盖住了会话区。
 * @param recentCount - 请求的最近行数；会被 `readRecentCount` 夹取。
 * @param statuses - `useSessionStatus` 的快照（以 SessionId 为键的 Map）；
 *   宿主未注入该 hook 时缺席。
 * @returns 置顶行、普通行与最近会话行。每条最近行都带 `status`，
 *   让渲染层画出宿主的状态标记。
 */
export function deriveSections(
  items: readonly WorkspaceViewLike[] | null | undefined,
  sessions: SessionListStateLike | null | undefined,
  archivedIds: readonly SessionId[] | null | undefined,
  pinnedIds?: readonly string[] | null | undefined,
  language?: string | null | undefined,
  panelCovering?: boolean,
  recentCount?: unknown,
  statuses?: SessionStatusSnapshotLike | null | undefined,
): RailSections {
  const list = Array.isArray(items) ? items : []
  const pinnedRank = new Map<string, number>(
    (Array.isArray(pinnedIds) ? pinnedIds : []).map((id, index) => [String(id), index]),
  )
  const archived = new Set<SessionId>(Array.isArray(archivedIds) ? archivedIds : [])
  const pinnedRows: WorkspaceRow[] = []
  const normalRows: WorkspaceRow[] = []
  for (const item of list) {
    if (item === null || item === undefined) continue
    const row: WorkspaceRow = {
      id: item.workspaceId,
      // 浮层只显示工作区名：路径副标题会让每行变两行高，且重复了名称已经
      // 携带的信息。
      title: item.title ?? shortPath(item.path) ?? String(item.workspaceId),
      sessionIds: Array.isArray(item.sessionIds) ? item.sessionIds : [],
    }
    if (pinnedRank.has(row.id)) pinnedRows.push(row)
    else normalRows.push(row)
  }
  pinnedRows.sort((a, b) => (pinnedRank.get(a.id) ?? 0) - (pinnedRank.get(b.id) ?? 0))
  const shownSessionId = currentSessionId(sessions, panelCovering)
  const byId = sessions?.byId ?? {}
  // `useSessionStatus` 给出 ReadonlyMap；为容忍宿主形状变化，普通对象也接受，
  // 于是畸形快照退化成「没有标记」而不是在渲染期抛错。
  const statusOf = (id: SessionId) => {
    if (statuses === null || statuses === undefined || typeof statuses !== 'object') return undefined
    if (statuses instanceof Map) return statuses.get(id)
    return (statuses as Readonly<Record<string, SessionStatusLike | null | undefined>>)[id]
  }
  const recentRows: RecentSessionRow[] = []
  for (const entry of Object.values(byId)) {
    if (entry === null || entry === undefined || typeof entry !== 'object') continue
    if (entry.origin === 'subagent' || entry.blank === true) continue
    if (archived.has(entry.id)) continue
    recentRows.push({
      id: entry.id,
      title: entryDisplayTitle(entry, entry.id),
      meta: relativeTime(entry.updatedAt, language),
      updatedAt: typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
      active: entry.id === shownSessionId,
      // 渲染层据此画状态标记；`idle` 什么都不画。
      status: sessionStatusOf(entry, statusOf(entry.id)),
    })
  }
  recentRows.sort((a, b) => b.updatedAt - a.updatedAt)
  return { pinnedRows, normalRows, recentRows: recentRows.slice(0, readRecentCount(recentCount)) }
}

/**
 * 取一条会话摘要的展示标题，缺失时退化为 id。
 * @param entry - 会话摘要。
 * @param fallbackId - 标题缺失时使用的 id。
 * @returns 展示标题。
 */
function entryDisplayTitle(entry: SessionSummaryLike, fallbackId: SessionId): string {
  const title = entry.displayTitle ?? entry.title
  return typeof title === 'string' && title !== '' ? title : String(fallbackId)
}