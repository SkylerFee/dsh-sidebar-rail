/**
 * 本插件读写的宿主数据形状。
 *
 * 宿主发布包（`@deepseek-ai/dsh-client-ui-xxx/client`）确实带 `lib/types`，但它们的
 * 类型依赖链里有尚未发布到 npm 的内部包（`@deepseek-ai/dsh-type-meta` 等），
 * 直接 import 会让本项目的 `tsc --noEmit` 无法在干净环境跑通。因此这里按宿主
 * **公开行为**声明本插件真正用到的字段，并在每个接口上注明来源文件；运行时仍然
 * 对跨边界输入做收窄（`unknown` 进来，逐层判定），类型只负责描述已知形状。
 *
 * 约束：模型层不得 import React 或 DOM，也不得 import 组件与入口。
 */

/** 会话 id（宿主 `SessionId` 的字符串形态）。 */
export type SessionId = string

/** 工作区 id（宿主 `WorkspaceId` 的字符串形态）。 */
export type WorkspaceId = string

/**
 * 宿主 `SessionSummary`（ui-session / api-session-controller 公开投影）里本插件读到的字段。
 *
 * - `displayTitle` / `title`：行标题；
 * - `updatedAt`：最近更新时间（epoch 毫秒），用于相对时间与排序；
 * - `running`：状态快照缺失时的兜底运行标志；
 * - `origin` / `blank`：最近会话区据此过滤子代理与空白会话；
 * - `retainedBy.mainView`：主视图当前保留该会话的次数，用于高亮。
 */
export interface SessionSummaryLike {
  /** 宿主对象携带本插件不用的更多字段；索引签名让跨边界替身不必逐字段声明。 */
  readonly [extra: string]: unknown
  readonly id: SessionId
  readonly title?: string | null | undefined
  readonly displayTitle?: string | null | undefined
  readonly updatedAt?: number | undefined
  readonly running?: boolean | undefined
  readonly origin?: string | undefined
  readonly blank?: boolean | undefined
  readonly retainedBy?: { readonly mainView?: number | undefined } | null | undefined
}

/** 按 id 索引的会话摘要表；容忍宿主快照里出现的空洞与畸形值。 */
export type SessionById = Readonly<
  Record<string, SessionSummaryLike | null | undefined>
>

/**
 * 宿主 `SessionListState`（`useSessions` 的标准道具）里本插件读到的部分。
 *
 * 只读 `byId`；其余字段保留在替身里，让「hook 缺失」时的降级对象与宿主形状一致。
 */
export interface SessionListStateLike {
  readonly ids?: readonly SessionId[] | undefined
  readonly byId?: SessionById | null | undefined
  readonly phase?: string | undefined
  readonly projectionsBySession?: Readonly<Record<string, unknown>> | undefined
}

/**
 * 宿主 `WorkspaceView`（ui-workspace 公开投影）里本插件读到的字段。
 *
 * `sessionIds` 决定项目展开后的会话顺序，按宿主成员顺序原样使用。
 */
export interface WorkspaceViewLike {
  /** 同上：宿主工作区视图还有本插件不读取的字段。 */
  readonly [extra: string]: unknown
  readonly workspaceId: WorkspaceId
  readonly title?: string | null | undefined
  readonly path?: string | null | undefined
  readonly sessionIds?: readonly SessionId[] | undefined
}

/**
 * 宿主 `SessionStatus`（`useSessionStatus` 快照条目）里本插件读到的字段。
 *
 * `pendingInteraction.kind` 只认 `approval` / `plan-review` / `question`；
 * `running` 与 `completionUnread` 决定其余两种标记。
 */
export interface SessionStatusLike {
  /** 同上：宿主状态对象还有本插件不读取的字段。 */
  readonly [extra: string]: unknown
  readonly running?: boolean | undefined
  readonly completionUnread?: boolean | undefined
  readonly pendingInteraction?: { readonly kind?: string | undefined } | null | undefined
}

/**
 * `useSessionStatus` 的快照：宿主给的是 `ReadonlyMap`，测试与旧版本可能给普通对象。
 * 两种都接受，畸形值退化成「没有标记」。
 */
export type SessionStatusSnapshotLike =
  | ReadonlyMap<SessionId, SessionStatusLike>
  | Readonly<Record<string, SessionStatusLike | null | undefined>>

/** 会话行的状态标记；`idle` 由渲染层画成空。 */
export type SessionMark = 'warning' | 'ongoing' | 'done' | 'idle'

/** 一个工作区行（置顶区与普通区共用）。 */
export interface WorkspaceRow {
  readonly id: WorkspaceId
  readonly title: string
  readonly sessionIds: readonly SessionId[]
}

/** 项目展开后的一个会话行。 */
export interface ProjectSessionRow {
  readonly id: SessionId
  readonly title: string
  readonly meta: string
  readonly archived: boolean
  readonly current: boolean
  /**
   * 该行是否为空白会话。
   *
   * 只有「主视图当前的空白会话」会被保留下来（非当前的空白会话在
   * `projectSessionRows` 里就被过滤掉），因此这一位在本列表里最多命中一行。
   * 水位函数据此让它**恒显示且不占名额**（宿主 `watermarkRows` 的 blank 分支）。
   */
  readonly blank?: boolean | undefined
}

/** 最近会话区的一行。 */
export interface RecentSessionRow {
  readonly id: SessionId
  readonly title: string
  readonly meta: string
  readonly updatedAt: number
  readonly active: boolean
  readonly status: SessionMark
  /**
   * 该行是否为空白会话。
   *
   * 同 `ProjectSessionRow.blank`：只有当前那个空白会话会留下来，水位函数据此
   * 让它恒显示且不占名额，否则它会把水位顶高、让整列一次性全展开。
   */
  readonly blank?: boolean | undefined
}

/** `deriveSections` 的返回值。 */
export interface RailSections {
  readonly pinnedRows: readonly WorkspaceRow[]
  readonly normalRows: readonly WorkspaceRow[]
  readonly recentRows: readonly RecentSessionRow[]
}

/** 一条定时任务行（`normalizeTasks` 产出）。 */
export interface TaskRow {
  readonly id: string
  readonly title: string
  readonly meta: string
  readonly status: string
}

/** 任务行的三个分组；三个键恒存在，空分区仍要渲染标题与空态。 */
export interface TaskGroups {
  readonly active: readonly TaskRow[]
  readonly paused: readonly TaskRow[]
  readonly ended: readonly TaskRow[]
}

/** 一条插件行（`normalizePlugins` 产出）。 */
export interface PluginRow {
  readonly name: string
  readonly meta?: string | undefined
  readonly enabled: boolean
  readonly installed: boolean
}

/** 插件行的两个分组；两个键恒存在。 */
export interface PluginGroups {
  readonly enabled: readonly PluginRow[]
  readonly disabled: readonly PluginRow[]
}

/** 账号座位的三种形态。 */
export type AccountSeatKind = 'unknown' | 'signed-in' | 'signed-out'

/** 账号座位：登录态与可选头像。 */
export interface AccountSeat {
  readonly kind: AccountSeatKind
  readonly avatarUrl: string | undefined
}

/** 一行钱包余额。 */
export interface BalanceRow {
  readonly currency: 'USD' | 'CNY'
  readonly text: string
}

/** 钱包余额集合：普通钱包与赠金钱包。 */
export interface AccountBalances {
  readonly wallets: readonly BalanceRow[]
  readonly bonusWallets: readonly BalanceRow[]
}

/** 账号页的两个平台跳转目标；不可用时整条省略。 */
export interface AccountLinks {
  readonly usageUrl?: string | undefined
  readonly topUpUrl?: string | undefined
}

/** 账号座位加上只读附加信息（余额与链接）。 */
export interface AccountSeatWithExtras extends AccountSeat {
  readonly balances: AccountBalances
  readonly links: AccountLinks
}

/** 分区收起状态：分区 id → 是否已收起。 */
export type FoldedSections = Readonly<Record<string, boolean | undefined>>

/** 目录选择器的三种结局。 */
export type PickedDirectory =
  | { readonly kind: 'picked'; readonly path: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string }

/** 远程答案的三态分类：就绪、结构化失败、服务缺失。 */
export type RemoteOutcome =
  | { readonly kind: 'ready'; readonly value: unknown; readonly error: undefined }
  | { readonly kind: 'failed'; readonly value: undefined; readonly error: unknown }
  | { readonly kind: 'unavailable'; readonly value: undefined; readonly error: undefined }