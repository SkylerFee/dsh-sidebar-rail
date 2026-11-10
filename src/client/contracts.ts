/**
 * 组件契约：宿主通过标准 props / 注入面交给图标轨的全部输入。
 *
 * 契约集中在这里，让组件之间以「数据 + 回调」相连，而不是传递整个宿主 Context。
 * 字段来源都在注释里标明，运行期仍需收窄（宿主版本可能比这里的描述旧）。
 */
import type { Translate } from './locales.ts'
import type {
  AccountSeatWithExtras,
  SessionListStateLike,
  SessionStatusSnapshotLike,
  WorkspaceViewLike,
} from './model/types.ts'
import type { ObservableSource } from './host-adapter.ts'
import type { PanelEntry } from './host-adapter.ts'

/** 一个标准 selector hook：给定选择器，返回选中的切片。 */
export type SnapshotSelectorHook<T> = <Slice>(select: (state: T) => Slice) => Slice

/** 面板信息快照（`usePanelInfo`）：主视图当前选中的面板。 */
export interface PanelInfoLike {
  readonly activePanelId?: string | null | undefined
}

/** 图标轨收到的宿主注入面：导航动作与远程读取。 */
export interface RailInjectFace {
  /** 展开或折叠宿主侧栏。 */
  toggleSidebar(): void
  /** 切换到某个主面板。 */
  selectPanel(id: string): void
  /** 打开一个工作区。 */
  openWorkspace(workspaceId: string): unknown
  /** 打开一个已有会话（宿主同步抛错时不被吞掉）。 */
  openSession(sessionId: string): void
  /** 在某个工作区新建会话。 */
  startSession(workspaceId: string): void
  /** 调起目录选择器。 */
  pickDirectory(): Promise<unknown>
  /** 按绝对路径登记工作区。 */
  createWorkspace(path: string): Promise<unknown> | unknown
  /** 面板条目快照源。 */
  panels: ObservableSource<readonly PanelEntry[]>
  /** locale 快照源。 */
  locale: ObservableSource<{ readonly active: string }>
  /** 读取定时任务目录；服务缺席时 resolve null。 */
  scheduleCatalog(): Promise<unknown>
  /** 读取 bundle 列表；服务缺席时 resolve null。 */
  pluginInventory(): Promise<unknown>
  /** 读取账号座位（登录态、头像、余额与链接）。 */
  accountSeat(): Promise<AccountSeatWithExtras>
  /** 宿主未注入翻译时的兜底文案。 */
  fallbackText: string
}

/**
 * 图标轨的全部 props。
 *
 * 标准 props（`useSessions` / `useWorkspaces` / `usePanelInfo` /
 * `useSessionStatus`）由宿主注入，缺失时组件退化成常量读取而不是抛错；
 * 其余字段来自本插件的 `inject` 面。
 */
export interface RailColumnProps extends RailInjectFace {
  /** 标准 hook：会话列表状态。 */
  readonly useSessions?: SnapshotSelectorHook<SessionListStateLike> | undefined
  /** 标准 hook：工作区列表状态。 */
  readonly useWorkspaces?: SnapshotSelectorHook<{
    readonly items: readonly WorkspaceViewLike[]
    readonly archivedSessionIds: readonly string[]
  }> | undefined
  /** 标准 hook：主面板信息。 */
  readonly usePanelInfo?: SnapshotSelectorHook<PanelInfoLike> | undefined
  /** 标准 hook：每会话的 UI 状态（可选）。 */
  readonly useSessionStatus?: SnapshotSelectorHook<SessionStatusSnapshotLike> | undefined
  /** 翻译函数（`locale:` 座位注入）。 */
  readonly t?: Translate | undefined
}

/** 面板条目源别名，避免组件层重复写泛型。 */
export type PanelsFace = ObservableSource<readonly PanelEntry[]>
