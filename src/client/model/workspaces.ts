/**
 * 工作区、项目成员与最近会话的纯模型。
 *
 * 两种列表共享宿主 `ui-workspace/tree.ts` 的 `sessionVisible` 前两条规则
 * （**子代理会话不可见**、**空白会话只留当前那个**），区别只在归档与排序：
 *   - 项目成员（`projectSessionRows`）：归档照列并标注，按宿主 `sessionIds` 顺序；
 *   - 最近会话（`deriveSections`）：排除归档，按更新时间倒序。
 *
 * 状态标记同理同源：两者都经 `sessionStatusOf` 与 `statusEntryReader`，
 * `idle` 之外的状态在哪个列表里读到的都一样。
 *
 * 条数截断**不在模型层**：两处都返回全部可见行，分页由渲染层的水位决定
 * （`watermarkSlice` / `requiredWatermark`，spec-0.5.1 §4）。
 */
import { PAGE_SIZE_AUTO_MAX, STATUS_MARK_RANK } from './constants.ts'
import { relativeTime, sessionStatusOf, shortPath } from './formatting.ts'
import type {
  ProjectSessionRow,
  RailSections,
  RecentSessionRow,
  SessionById,
  SessionId,
  SessionListStateLike,
  SessionStatusLike,
  SessionStatusSnapshotLike,
  SessionMark,
  SessionSummaryLike,
  WorkspaceRow,
  WorkspaceViewLike,
} from './types.ts'

/**
 * 把宿主 `useSessionStatus` 的快照包装成「按 id 取状态条目」。
 *
 * `useSessionStatus` 给出 `ReadonlyMap`；为容忍宿主形状变化，普通对象也接受，
 * 于是畸形快照退化成「没有标记」而不是在渲染期抛错。项目展开列表与最近会话区
 * 共用这一个读取器，两个列表对同一个会话才会给出相同状态。
 * @param statuses - 宿主状态快照，或任何取而代之的形状。
 * @returns 按会话 id 取条目；快照不可用时恒返回 undefined。
 */
function statusEntryReader(
  statuses: SessionStatusSnapshotLike | null | undefined,
): (id: SessionId) => SessionStatusLike | null | undefined {
  return (id) => {
    if (statuses === null || statuses === undefined || typeof statuses !== 'object') return undefined
    if (statuses instanceof Map) return statuses.get(id)
    return (statuses as Readonly<Record<string, SessionStatusLike | null | undefined>>)[id]
  }
}

/**
 * 构造项目展开后要显示的会话行。
 *
 * 策略**刻意与「最近会话」区相反**：这份列表回答「这个项目里有什么」，所以
 * 归档会话照样列出，只用标记位让渲染层标注；顺序沿用宿主 `sessionIds` 的成员
 * 顺序，绝不按时间重排。
 *
 * **空白会话照抄宿主可见性规则**（spec-0.5.1 §3，宿主 `ui-workspace/tree.ts`
 * 的 `sessionVisible`）：只保留主视图当前显示的那一个空白会话，其余空白会话
 * 不产出行。这是「不渲染」而不是「删数据」——会话仍在宿主 registry 里，切换当前
 * 会话后会重新出现。判定用调用方已算好的 `shownSessionId`，不新增判据。
 *
 * 条数不在这里截断：分页交给渲染层的水位，「显示更多」才有意义。
 *
 * **子代理子会话必须过滤**，与宿主 `sessionVisible` 的第一条规则一致。早先这里
 * 假设「子代理会话根本不进 `sessionIds`」，那是错的：子代理 header 带着父会话的
 * `cwd` 且标 `origin: 'subagent'`，而工作区启动回填按 canonical `cwd` 归组所有持久化
 * header 写进 `sessionIds`、不看 `origin`，于是它们确实会成为工作区成员。宿主
 * `tree.ts` 因此对成员也做 `origin === 'subagent'` 过滤，插件必须照做。
 * （注意：`fork` 命令产生的是**普通会话**，meta 里没有 `origin: 'subagent'`，与这条无关。）
 *
 * 快照里缺失的成员**直接丢弃，不产出任何行**：`sessionIds` 来自工作区
 * registry，`byId` 来自会话快照，重命名或删除的瞬间两者可能差一帧。旧行为在这里
 * 补一行 `title: id` 的占位，结果是项目下冒出一个与项目同名的「幽灵会话」——
 * 点开没有任何内容。宁可少一帧的会话行，也不产出点不开的假节点；项目确实没有
 * 会话时由渲染层显示空态（`empty.projectSessions`），而不是任何占位行。
 *
 * 丢弃时记一行调试日志（只有条数，不含标题、路径或 id）。
 * @param sessionIds - `WorkspaceView.sessionIds`，宿主顺序。
 * @param byId - `useSessions` 提供的会话摘要，按 id 索引。
 * @param language - 当前 locale id，用于相对时间。
 * @param archivedIds - 归档会话 id，只用于打标记。
 * @param shownSessionId - 主视图正在显示的会话；用于打标记，并决定哪个空白会话保留。
 * @param statuses - `useSessionStatus` 的快照（以 SessionId 为键）；宿主未注入时缺席，
 *   此时退回 `SessionSummary.running`，与最近会话区同一兜底。
 * @returns 行数组：不排序，除子代理、非当前的空白会话外不过滤；缺摘要的成员被丢弃，
 *   因此长度可能小于传入的成员数（空项目返回零行，由渲染层显示空态）。
 */
export function projectSessionRows(
  sessionIds: readonly SessionId[] | null | undefined,
  byId: SessionById | null | undefined,
  language: string | null | undefined,
  archivedIds?: readonly SessionId[] | null | undefined,
  shownSessionId?: SessionId | undefined,
  statuses?: SessionStatusSnapshotLike | null | undefined,
): ProjectSessionRow[] {
  if (!Array.isArray(sessionIds)) return []
  const summaries = byId !== null && byId !== undefined && typeof byId === 'object' ? byId : {}
  const archived = new Set<SessionId>(Array.isArray(archivedIds) ? archivedIds : [])
  // 状态快照的读取与「最近会话」共用同一个形状容忍函数（见 statusEntryReader）。
  const statusOf = statusEntryReader(statuses)
  const rows: ProjectSessionRow[] = []
  let total = 0
  let missing = 0
  for (const raw of sessionIds) {
    if (raw === null || raw === undefined) continue
    total += 1
    const id = String(raw)
    const entry = summaries[id]
    // 缺摘要的成员没有任何可渲染的内容，产出占位行就是那个「幽灵会话」。
    if (entry === null || entry === undefined || typeof entry !== 'object') {
      missing += 1
      continue
    }
    // 宿主规则一：子代理子会话一律不可见。
    // 宿主 ui-workspace/tree.ts 的 sessionVisible 第一行就是
    // `if (session.origin === 'subagent') return false`，且它对**工作区成员**同样生效：
    // 工作区启动回填按 cwd 归组所有持久化 header 写进 sessionIds，不看 origin，
    // 子代理子会话（继承父 cwd）因此会成为成员。此前这里漏了这条。
    if (entry.origin === 'subagent') continue
    // 宿主规则二：空白会话里只有当前那一个可见（spec-0.5.1 §3）。
    if (entry.blank === true && id !== shownSessionId) continue
    rows.push({
      id,
      title: entryDisplayTitle(entry, id),
      meta: relativeTime(entry.updatedAt, language),
      archived: archived.has(id),
      current: id === shownSessionId,
      // 与最近会话行同一判定：宿主状态快照优先，缺席时退回 summary.running。
      status: sessionStatusOf(entry, statusOf(id)),
      // 走到这里的空白行只可能是「当前那一个」。标记出来，水位函数才会让它
      // 恒显示且不占名额（宿主 watermarkRows 的 blank 分支）。
      blank: entry.blank === true,
    })
  }
  if (missing > 0) {
    // 只报条数：标题、路径与 id 都可能敏感，且这行日志的用途只是让
    // 「项目里少了一条会话」有迹可循（CODING_STANDARDS §6）。
    console.info('[dsh-sidebar-rail] project sessions: %d of %d members had no summary', missing, total)
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

/** 水位列表里一行必须携带的最小面；`ProjectSessionRow` 与 `RecentSessionRow` 都满足。 */
export interface WatermarkRow {
  readonly id: SessionId
}

/**
 * 判断一行是不是空白会话。
 *
 * 两个行构造器都会如实写出 `blank`（`ProjectSessionRow.blank` /
 * `RecentSessionRow.blank`），所以本判定在真实渲染路径上会命中；同时也接受宿主
 * 形状的行，因此按结构化字段判断而不是依赖某个具体类型。
 * @param row - 待判定的行。
 * @returns 是否为空白会话。
 */
function isBlankRow(row: unknown): boolean {
  return row !== null && typeof row === 'object' && (row as { blank?: unknown }).blank === true
}

/**
 * 按水位切出要渲染的行，并算出被隐藏的条数。
 *
 * 逐字复刻宿主 `WorkspaceBrowser.tsx` 的 `watermarkRows`：空白会话**恒显示且不占
 * 名额**，其余会话按顺序填满水位，超出部分隐藏。调用方按「`hiddenCount` > 0」决定
 * 是否渲染「显示更多」按钮（= 有剩余才渲染，不是禁用）。
 * @param rows - 该列表的全部可见行（最近会话行或项目会话行）。
 * @param watermark - 当前有效水位（见 `useFlyout` 的 `effectiveWatermark`）。
 * @returns `rows` 为要渲染的行，`hiddenCount` 为被水位挡住的行数。
 */
export function watermarkSlice<T extends WatermarkRow>(
  rows: readonly T[] | null | undefined,
  watermark: number,
): { readonly rows: readonly T[]; readonly hiddenCount: number } {
  const list = Array.isArray(rows) ? rows : []
  const limit = Number.isFinite(watermark) ? Math.max(0, Math.round(watermark)) : 0
  const visible: T[] = []
  // 只数被水位挡住的**非空白**行：畸形项既不渲染也不该算进「还有更多」。
  let used = 0
  let hidden = 0
  for (const row of list) {
    if (row === null || row === undefined || typeof row !== 'object') continue
    if (isBlankRow(row)) {
      visible.push(row)
      continue
    }
    used += 1
    if (used <= limit) visible.push(row)
    else hidden += 1
  }
  return { rows: visible, hiddenCount: hidden }
}

/**
 * 求「必须显示到第几条」才能覆盖所有需要引起注意的会话。
 *
 * 复刻宿主 `requiredWatermark`：按顺序数非空白会话（空白会话不占名额），最后
 * 一条「值得注意」的会话决定水位下限。值得注意 = 调用方的 `isAttention` 判定为真，
 * 或该行就是主视图当前的会话；且只在水位上限（`autoMax`）之内生效——再往后
 * 只能靠用户点「显示更多」。
 *
 * **与宿主的一处差异（有意）**：宿主还看 `runningSubagentCount`（运行中的子代理），
 * 那需要 `projectionsBySession.subagentCatalog`；PRD 把子代理投影列为非目标，
 * 本插件拿不到该字段，因此自动提升只考虑行自身的状态（`running` / 待交互 /
 * 未读完成 / 当前会话）。代价是「某个会话只因为子代理在跑而排在深水位」时不会自动
 * 展开，用户仍可用「显示更多」看到它。
 * @param rows - 该列表的全部可见行（同上）。
 * @param currentId - 主视图当前会话 id；命中它的那一行始终值得注意。
 * @param isAttention - 行级「需要引起注意」判定（如 `recentRowNeedsAttention`）。
 * @param autoMax - 自动提升上限，默认 `PAGE_SIZE_AUTO_MAX`。
 * @returns 需要显示到第几条（1-based）；没有任何值得注意的行时返回 0。
 */
export function requiredWatermark<T extends WatermarkRow>(
  rows: readonly T[] | null | undefined,
  currentId: SessionId | undefined,
  isAttention?: ((row: T) => boolean) | null | undefined,
  autoMax: number = PAGE_SIZE_AUTO_MAX,
): number {
  const list = Array.isArray(rows) ? rows : []
  const limit = Number.isFinite(autoMax) ? Math.max(0, Math.round(autoMax)) : PAGE_SIZE_AUTO_MAX
  let index = 0
  let required = 0
  for (const row of list) {
    if (row === null || row === undefined || typeof row !== 'object') continue
    // 空白会话恒显示，不占水位名额，也不贡献水位。
    if (isBlankRow(row)) continue
    index += 1
    // 超出自动上限之后没有任何行能再抬高水位。
    if (index > limit) break
    const wanted = (typeof isAttention === 'function' && isAttention(row) === true)
      || (currentId !== undefined && row.id === currentId)
    if (wanted) required = index
  }
  return required
}

/**
 * 最近会话行是否需要引起注意（用于自动水位）。
 * @param row - 一条最近会话行。
 * @returns 正在高亮、或有任何状态标记（运行中 / 待交互 / 未读完成）时为 true。
 */
export function recentRowNeedsAttention(row: RecentSessionRow): boolean {
  return row.active === true || row.status !== 'idle'
}

/**
 * 项目会话行是否需要引起注意（用于自动水位）。
 *
 * 与最近会话区、以及宿主 `WorkspaceBrowser#requiredWatermark` 的判定一致：
 * 运行中 / 有待操作 / 已完成未读 / 当前会话，四种任一即可。宿主对**每个列表**
 * 都用同一套判定，所以项目列表没有理由更严格——只认 `current` 时，深水位上
 * 运行中的会话会被「显示更多」挡住，行首的状态点也就没人看得到。
 *
 * **与宿主的一处差异（有意）**：宿主还看 `runningSubagentCount`，那需要
 * `projectionsBySession.subagentCatalog`；PRD 把子代理投影列为非目标。
 * @param row - 一条项目会话行。
 * @returns 该行带任何状态标记、或就是主视图当前会话时为 true。
 */
export function projectRowNeedsAttention(row: ProjectSessionRow): boolean {
  return row.current === true || row.status !== 'idle'
}

/**
 * 求一个项目在行上应显示的状态标记：取其**最值得注意**的那个会话。
 *
 * 宿主在项目层级没有任何状态聚合——`GroupNode` 只有 `containsCurrent`，
 * 项目行也不画状态点——所以这是本插件补的能力，风格上仍与宿主一致：
 * 只用宿主已有的四种标记，不引入新的视觉语言。
 *
 * 取值规则：**沿用会话级同一优先级**（待操作 > 运行中 > 未读完成 > 空闲）。
 * 取「最高」而不是「任意一个」是刻意的——「需要你动手」比「正在跑」更值得
 * 占用项目行那一格，否则一个待审核的项目会被同项目里随便哪个运行中的会话盖住。
 *
 * 归档会话不参与：它在项目列表里照常列出，但宿主已将其视为不活跃；让一条归档的
 * 运行中会话点亮整个项目，读起来像这个项目还在干活。
 * @param rows - 该项目已归一化的会话行。
 * @returns 最高优先级标记；无子会话或全部空闲时为 `idle`（渲染层画成空）。
 */
export function projectStatusOf(
  rows: readonly ProjectSessionRow[] | null | undefined,
): SessionMark {
  // 不用 Array.isArray：它把 readonly 数组收窄成 any[]，反而丢掉元素的类型。
  if (!Array.isArray(rows)) return 'idle'
  let best: SessionMark = 'idle'
  for (const row of rows as readonly ProjectSessionRow[]) {
    if (row === null || row === undefined || typeof row !== 'object') continue
    if (row.archived === true) continue
    if (STATUS_MARK_RANK[row.status] > STATUS_MARK_RANK[best]) best = row.status
  }
  return best
}

/**
 * 把工作区拆成置顶区与普通区，并收集最近会话。
 * @param items - `WorkspaceView[]`。
 * @param sessions - SessionListState。
 * @param archivedIds - 归档会话 id。
 * @param pinnedIds - 本地置顶的工作区 id，最近的在前。
 * @param language - 当前 locale id。
 * @param panelCovering - 非会话面板是否盖住了会话区。
 * @param statuses - `useSessionStatus` 的快照（以 SessionId 为键的 Map）；
 *   宿主未注入该 hook 时缺席。
 * @returns 置顶行、普通行与最近会话行。每条最近行都带 `status`，
 *   让渲染层画出宿主的状态标记。最近行**不截条数**：全部返回，分页由渲染层的
 *   水位决定（spec-0.5.1 §4）。
 */
export function deriveSections(
  items: readonly WorkspaceViewLike[] | null | undefined,
  sessions: SessionListStateLike | null | undefined,
  archivedIds: readonly SessionId[] | null | undefined,
  pinnedIds?: readonly string[] | null | undefined,
  language?: string | null | undefined,
  panelCovering?: boolean,
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
  const statusOf = statusEntryReader(statuses)
  const recentRows: RecentSessionRow[] = []
  for (const entry of Object.values(byId)) {
    if (entry === null || entry === undefined || typeof entry !== 'object') continue
    if (entry.origin === 'subagent') continue
    // 宿主规则：空白会话里只有当前那一个可见（spec-0.5.1 §3）。
    // 旧实现把所有 blank 都跳过，把当前那个也一起藏了。
    if (entry.blank === true && entry.id !== shownSessionId) continue
    if (archived.has(entry.id)) continue
    recentRows.push({
      id: entry.id,
      title: entryDisplayTitle(entry, entry.id),
      meta: relativeTime(entry.updatedAt, language),
      updatedAt: typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
      active: entry.id === shownSessionId,
      // 渲染层据此画状态标记；`idle` 什么都不画。
      status: sessionStatusOf(entry, statusOf(entry.id)),
      // 留下的是非当前空白之外的会话；这里如实标出「当前那个空白会话」，
      // 水位函数才会让它恒显示且不占名额。
      blank: entry.blank === true,
    })
  }
  recentRows.sort((a, b) => b.updatedAt - a.updatedAt)
  return { pinnedRows, normalRows, recentRows }
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
