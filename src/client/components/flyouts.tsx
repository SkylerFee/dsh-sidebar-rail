/**
 * 四类浮层的渲染体：工作区、定时任务、插件、账号，「更多」也在这里。
 *
 * 每个浮层只负责把自己那组已归一化的行画成分区；数据与回调都由
 * `RailColumn` 传入，组件本身不读宿主 Context。
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { h } from '../jsx.ts'
import type { FlyoutShell } from './flyout-shell.tsx'
import {
  ActionRow,
  Empty,
  FlyoutSection,
  ProjectRow,
  Row,
  Section,
  ShowMore,
} from './primitives.tsx'
import { RECENT_LIST_KEY } from '../model/constants.ts'
import {
  projectRowNeedsAttention,
  projectStatusOf,
  recentRowNeedsAttention,
  requiredWatermark,
  watermarkSlice,
} from '../model/workspaces.ts'
import { projectStatusLabelKey, statusLabelKey, type Translate } from '../locales.ts'
import type {
  AccountBalances,
  AccountLinks,
  AccountSeat,
  FoldedSections,
  PluginGroups,
  ProjectSessionRow,
  RailSections,
  TaskGroups,
  WorkspaceRow,
} from '../model/types.ts'

/** 浮层渲染器共用的入参。 */
export interface FlyoutCommonProps {
  /** 翻译函数。 */
  readonly t: Translate
  /** 收开一个分区。 */
  readonly toggleSection: (id: string) => void
  /** 分区收起状态（按浮层命名空间化的 id）。 */
  readonly foldedSections: FoldedSections
}

/**
 * 构造一个可折叠分区，并绑定它自己的折叠状态。
 *
 * id 按浮层命名空间化，于是两个面板可以各自拥有一个「recent」分区而不共享折叠状态。
 * @param props - 共享入参。
 * @param flyout - 分区属于哪个浮层。
 * @param name - 分区名，在该浮层内稳定。
 * @param title - 本地化标题。
 * @param defaultOpen - spec 规定的默认展开态。
 * @param children - 分区内容。
 * @param actions - 可选的标题右侧控件。
 * @returns 分区元素。
 */
export function buildSection(
  props: FlyoutCommonProps,
  flyout: string,
  name: string,
  title: string,
  defaultOpen: boolean,
  children: ReactNode,
  actions?: ReactNode,
): ReactNode {
  const id = `${flyout}.${name}`
  return h(FlyoutSection, {
    key: id,
    title,
    open: sectionIsOpenSafe(props.foldedSections, id, defaultOpen),
    onToggle: () => props.toggleSection(id),
    actions,
  }, children)
}

/** 工作区浮层的入参。 */
export interface WorkspaceFlyoutProps extends FlyoutCommonProps {
  readonly sections: RailSections
  readonly expandedProjects: Readonly<Record<string, boolean | undefined>>
  readonly toggleProject: (workspaceId: string) => void
  readonly togglePin: (workspaceId: string) => void
  readonly openSession: (sessionId: string) => void
  readonly startSessionInProject: (workspaceId: string) => void
  readonly addProject: () => void
  readonly projectAction: { readonly phase: string; readonly message?: string | undefined }
  readonly projectSessionRows: (row: WorkspaceRow) => readonly ProjectSessionRow[]
  /** 有效水位 = max(用户抬高值, 自动需求值, PAGE_SIZE)。 */
  readonly effectiveWatermark: (key: string, required?: number) => number
  /** 点「显示更多」：在当前有效水位上再 + PAGE_SIZE。 */
  readonly raiseWatermark: (key: string, required?: number) => void
  /** 把自动需求水位记进控制器，于是它只升不降。 */
  readonly noteWatermark: (key: string, required: number) => void
  /** 主视图正在显示的会话 id，供最近会话区的注意力判定。 */
  readonly currentSessionId: string | undefined
  /**
   * 某个会话是否有活跃的定时任务，供行首的时钟标记判定。
   *
   * 作为回调传入而不是每行自己去遍历任务数组：任务列表在工作区浮层里也加载了
   * （spec-0.5.1 §5），行只问「我这一条要不要标」。
   */
  readonly hasActiveTask: (sessionId: string) => boolean
  readonly shell: FlyoutShell
}

/**
 * 工作区浮层：置顶项目、其余项目、最近会话三个固定分区。
 *
 * 一个项目只会出现在前两个之一——`deriveSections` 已经分好区，渲染层只在各自
 * 分区里画各自列表。三个分区默认全展开，且任何一项都不持久化（spec 3.1）。
 *
 * 每个项目行就地展开成自己的会话列表。最近会话区与**每个项目**各自维护一份水位
 * （spec-0.5.1 §4）：基础显示 10 条，注意力行（运行中/待操作/未读/当前）自动突破
 * 水位显示，用户点「显示更多」再 +10。水位不落盘，浮层关闭即重置。
 */
export function WorkspaceFlyout(props: WorkspaceFlyoutProps): ReactNode {
  const { t, sections, expandedProjects, projectAction } = props

  /**
   * 一个项目行加上它展开后的会话列表。
   *
   * 分页按项目独立：`ProjectSessions` 内部用 `project:<workspaceId>` 作水位 key，
   * 两个项目同时展开时各抬各的水位。
   * @param row - `deriveSections` 给出的 `{ id, title, sessionIds }`。
   * @param pinned - 是否在置顶分区渲染。
   * @returns 项目行元素。
   */
  const projectRow = (row: WorkspaceRow, pinned: boolean): ReactNode => {
    const openProjects = expandedProjects[row.id] === true
    // 项目行的状态取旗下会话里最高的那个（宿主不聚合状态，这是本插件补的）。
    // 折叠时也要算：收起正是「不想展开、只想扫一眼有没有事」的场合。
    const rows = props.projectSessionRows(row)
    const status = projectStatusOf(rows)
    return h(ProjectRow, {
      key: `p-${row.id}`,
      title: row.title,
      open: openProjects,
      onToggleOpen: () => props.toggleProject(row.id),
      pinned,
      pinLabel: pinned ? t('pin.unpin') : t('pin.pin'),
      onTogglePin: () => props.togglePin(row.id),
      newSessionLabel: t('action.newSession'),
      onNewSession: () => props.startSessionInProject(row.id),
      status,
      // 用项目级文案：读屏应听到「旗下有会话运行中」，而不是「这个项目在运行中」。
      statusLabel: status === 'idle' ? undefined : t(projectStatusLabelKey(status)),
    }, openProjects
      ? h(ProjectSessions, {
        t,
        workspaceId: row.id,
        rows,
        currentSessionId: props.currentSessionId,
        openSession: props.openSession,
        effectiveWatermark: props.effectiveWatermark,
        raiseWatermark: props.raiseWatermark,
        noteWatermark: props.noteWatermark,
        hasActiveTask: props.hasActiveTask,
      })
      : null)
  }

  const pinned = sections.pinnedRows.length === 0
    ? h(Empty, null, t('empty.pinned'))
    : sections.pinnedRows.map((row) => projectRow(row, true))
  const projectsBusy = projectAction.phase === 'busy'
  const projectsFailed = projectAction.phase === 'failed'
  const projects = [
    projectsFailed
      ? h('div', { className: 'dsr-hint dsr-project-error', role: 'status' }, projectAction.message)
      : null,
    sections.normalRows.length === 0
      ? h(Empty, null, t('empty.workspaces'))
      : sections.normalRows.map((row) => projectRow(row, false)),
  ]
  // 放在项目分区标题里（spec 3.3）。busy 是真实状态而不是静默无操作：
  // 原生选择器会抢走焦点，按钮至少要显示点击已生效。
  const addProjectAction = h('button', {
    type: 'button',
    className: 'dsr-section-action',
    'aria-label': t('action.addProject'),
    title: t('action.addProject'),
    disabled: projectsBusy,
    onClick: props.addProject,
  }, projectsBusy ? t('state.picking') : t('action.addProject'))
  // 最近会话区的水位：注意力行（运行中/待操作/未读/当前）把水位顶上去，
  // 用户点「显示更多」再 +10。`noteWatermark` 在 effect 里折进 state，
  // 于是自动提升只升不降（宿主同款）；渲染期只做纯读的 `effectiveWatermark`。
  const recentRequired = requiredWatermark(sections.recentRows, props.currentSessionId, recentRowNeedsAttention)
  useEffect(() => {
    props.noteWatermark(RECENT_LIST_KEY, recentRequired)
  }, [props.noteWatermark, recentRequired])
  const recentVisible = watermarkSlice(
    sections.recentRows,
    props.effectiveWatermark(RECENT_LIST_KEY, recentRequired),
  )
  const recent = sections.recentRows.length === 0
    ? h(Empty, null, t('empty.recent'))
    : [
      ...recentVisible.rows.map((row) => h(Row, {
        key: `recent-${row.id}`,
        title: row.title,
        meta: row.meta,
        current: row.active === true,
        status: row.status,
        statusLabel: t(statusLabelKey(row.status)),
        scheduledTask: props.hasActiveTask(row.id),
        scheduledTaskLabel: t('row.scheduledTask'),
        onClick: () => props.openSession(row.id),
      })),
      recentVisible.hiddenCount > 0
        ? h(ShowMore, {
          key: 'recent-more',
          label: t('action.showMore'),
          onClick: () => props.raiseWatermark(RECENT_LIST_KEY, recentRequired),
        })
        : null,
    ]
  return props.shell(t('rail.workspace'), [
    buildSection(props, 'workspace', 'pinned', t('section.pinned'), true, pinned),
    buildSection(props, 'workspace', 'projects', t('section.workspaces'), true, projects, addProjectAction),
    buildSection(props, 'workspace', 'recent', t('section.recent'), true, recent),
  ], undefined, undefined, undefined, true)
}

/** 一个展开项目的会话列表的入参。 */
export interface ProjectSessionsProps {
  /** 翻译函数。 */
  readonly t: Translate
  /** 工作区 id，构成本列表的水位 key（`project:<id>`）。 */
  readonly workspaceId: string
  /** 该项目下的全部会话行（已由 `projectSessionRows` 归一化）。 */
  readonly rows: readonly ProjectSessionRow[]
  /** 主视图正在显示的会话 id，供注意力判定。 */
  readonly currentSessionId: string | undefined
  /** 打开一条会话。 */
  readonly openSession: (sessionId: string) => void
  /** 该会话是否有活跃的定时任务，供行首时钟判定。 */
  readonly hasActiveTask: (sessionId: string) => boolean
  /** 当前有效水位 = max(抬高值, required, PAGE_SIZE)。 */
  readonly effectiveWatermark: (key: string, required?: number) => number
  /** 「显示更多」：在当前有效水位上 + PAGE_SIZE。 */
  readonly raiseWatermark: (key: string, required?: number) => void
  /** 把自动需求水位折进控制器，于是它只升不降。 */
  readonly noteWatermark: (key: string, required: number) => void
}

/**
 * 一个项目展开后的会话列表：水位切片与「显示更多」。
 *
 * 独立成组件而不是写在 `projectRow` 的渲染回调里，因为「把自动需求记进控制器」
 * 需要 `useEffect`：在渲染期写状态会触发 React 的副作用警告，也会在
 * StrictMode 下重复执行。每个项目一个实例，于是水位天然按项目独立。
 * @param props - 该项目的全部会话行与水位的读取/抬高接口。
 * @returns 行元素列表，或空态。
 */
export function ProjectSessions(props: ProjectSessionsProps): ReactNode {
  const { t, workspaceId, rows } = props
  const key = `project:${workspaceId}`
  const required = requiredWatermark(rows, props.currentSessionId, projectRowNeedsAttention)
  useEffect(() => {
    props.noteWatermark(key, required)
  }, [props.noteWatermark, key, required])
  if (rows.length === 0) return h(Empty, null, t('empty.projectSessions'))
  const visible = watermarkSlice(rows, props.effectiveWatermark(key, required))
  return [
    ...visible.rows.map((entry) => {
      // 归档行与空白行的行尾留空：宿主 Rows.tsx 的槽位判定是
      // `!row.archived && !row.blank && showStatus`，理由是「已归档」标记本身
      // 已经说明该会话不活跃，行尾再点点反而是噪声。
      // 先算成一个值，status 与 statusLabel 就不会各说各话。
      const shownStatus = entry.archived || entry.blank === true ? undefined : entry.status
      return h(Row, {
        key: `ps-${workspaceId}-${entry.id}`,
        title: entry.title,
        // 归档行仍然列出但会标注，这样一条不再出现在最近会话区的会话
        // 不会被读成「不见了」。
        meta: [entry.meta, entry.archived ? t('status.archived') : ''].filter(Boolean).join(' · '),
        current: entry.current === true,
        // 状态点与最近会话区同源同判定：同一个会话在两个列表里不能有两个说法。
        status: shownStatus,
        statusLabel: shownStatus === undefined ? undefined : t(statusLabelKey(shownStatus)),
        // 时钟与状态点争行尾同一格（实际渲染在行尾，见 PRD A15 的既有勘误），
        // 宿主规则是「状态非 idle 时状态点优先」，该互斥已由 SessionMarkCell 实现。
        scheduledTask: props.hasActiveTask(entry.id),
        scheduledTaskLabel: t('row.scheduledTask'),
        onClick: () => props.openSession(entry.id),
      })
    }),
    visible.hiddenCount > 0
      ? h(ShowMore, {
        key: `ps-more-${workspaceId}`,
        label: t('action.showMore'),
        onClick: () => props.raiseWatermark(key, required),
      })
      : null,
  ]
}

/** 任务浮层的入参。 */
export interface TasksFlyoutProps extends FlyoutCommonProps {
  readonly groups: TaskGroups
  readonly phase: string
  readonly openPanel: () => void
  readonly shell: FlyoutShell
}

/**
 * 定时任务浮层：宿主生命周期状态映射出的三个分区。
 *
 * 只有「进行中」默认展开：已暂停与已结束是历史，三个全开的浮层会把仍在跑的
 * 埋没掉。
 */
export function TasksFlyout(props: TasksFlyoutProps): ReactNode {
  const { t, groups, phase } = props
  /**
   * 渲染一个任务分区的内容。
   *
   * 加载中或失败对整个浮层没有分区级含义，因此同一行文案放进每个分区，
   * 而不是重复取三次数；空分区保留标题并明说（spec 4）。
   * @param rows - 该分区的行。
   * @returns 分区内容。
   */
  const body = (rows: readonly { readonly id: string; readonly title: string; readonly meta: string }[]): ReactNode => {
    if (phase === 'loading') return h(Empty, null, t('state.loading'))
    if (phase === 'failed') return h(Empty, null, t('state.failed'))
    if (rows.length === 0) return h(Empty, null, t('empty.tasksStatus'))
    return rows.map((row) => h(Row, {
      key: `task-${row.id}`,
      title: row.title,
      meta: row.meta,
      onClick: props.openPanel,
    }))
  }
  return props.shell(t('rail.tasks'), [
    buildSection(props, 'tasks', 'active', t('section.activeTasks'), true, body(groups.active)),
    buildSection(props, 'tasks', 'paused', t('section.pausedTasks'), false, body(groups.paused)),
    buildSection(props, 'tasks', 'ended', t('section.endedTasks'), false, body(groups.ended)),
  ], h(ActionRow, { onClick: props.openPanel }, t('action.openPanel')), undefined, undefined, true)
}

/** 插件浮层的入参。 */
export interface PluginsFlyoutProps extends FlyoutCommonProps {
  readonly groups: PluginGroups
  readonly phase: string
  readonly openPanel: () => void
  readonly shell: FlyoutShell
}

/**
 * 插件浮层：「已启用」与「已安装但关闭」两个分区。
 *
 * 后者刻意排除「完全没安装的官方按需插件」——选一个会启动安装流程，而本界面
 * 不提供该流程（spec 5，ADR-0005）。也没有启用/停用开关：宿主的插件页拥有它，
 * 连同审批与重启处理。
 */
export function PluginsFlyout(props: PluginsFlyoutProps): ReactNode {
  const { t, groups, phase } = props
  /**
   * 渲染一个插件分区的内容。
   * @param rows - 该分区的行。
   * @returns 分区内容。
   */
  const body = (rows: readonly { readonly name: string; readonly meta?: string | undefined }[]): ReactNode => {
    if (phase === 'loading') return h(Empty, null, t('state.loading'))
    if (phase === 'failed') return h(Empty, null, t('state.failed'))
    if (rows.length === 0) return h(Empty, null, t('empty.pluginsState'))
    return rows.map((row) => h(Row, {
      key: `plugin-${row.name}`,
      title: row.name,
      meta: row.meta ?? '',
      onClick: props.openPanel,
    }))
  }
  return props.shell(t('rail.plugins'), [
    buildSection(props, 'plugins', 'enabled', t('section.enabledPlugins'), true, body(groups.enabled)),
    buildSection(props, 'plugins', 'disabled', t('section.disabledPlugins'), true, body(groups.disabled)),
  ], h(ActionRow, { onClick: props.openPanel }, t('action.openPanel')), undefined, undefined, true)
}

/** 「更多」浮层的入参。 */
export interface MoreFlyoutProps {
  readonly t: Translate
  readonly panels: readonly { readonly id: string; readonly label: string }[]
  readonly onExpand: () => void
  readonly onSelectPanel: (id: string) => void
  readonly shell: FlyoutShell
}

/**
 * 「更多」浮层：展开侧栏与其余主面板。
 *
 * 面板列表读宿主同一本账，因此列出的是真实导航条目；schedules 与 plugins
 * 已经有自己的图标入口，这里不重复。
 */
export function MoreFlyout(props: MoreFlyoutProps): ReactNode {
  const { t, panels } = props
  const extras = panels.filter((panel) => panel.id !== 'schedules' && panel.id !== 'plugins')
  return props.shell(t('rail.more'),
    h('div', null,
      h(ActionRow, { onClick: props.onExpand }, t('rail.expand')),
      extras.length === 0 ? null : h(Section, { title: t('section.panels') },
        extras.map((panel) => h(Row, {
          key: `panel-${panel.id}`,
          title: panel.label,
          onClick: () => props.onSelectPanel(panel.id),
        })))),
    h('div', { className: 'dsr-hint' }, t('account.hint')))
}

/** 账号浮层的入参。 */
export interface AccountFlyoutProps {
  readonly t: Translate
  readonly seat: AccountSeat & {
    readonly balances?: AccountBalances | undefined
    readonly links?: AccountLinks | undefined
  }
  readonly onExpand: () => void
  readonly shell: FlyoutShell
}

/**
 * 账号浮层：宿主账号菜单的只读镜像，加上它侧栏行不显示的余额。
 *
 * 退出登录与付款留在宿主自己的菜单里：本界面不得执行不可逆动作。
 */
export function AccountFlyout(props: AccountFlyoutProps): ReactNode {
  const { t, seat } = props
  const signedOut = seat.kind === 'signed-out'
  const balances: AccountBalances = seat.balances ?? { wallets: [], bonusWallets: [] }
  const links: AccountLinks = seat.links ?? {}
  /**
   * 一条带标签的余额行；列表为空时什么都不画。
   * @param label - 已翻译的标签。
   * @param wallets - 该组钱包。
   * @returns 余额行元素。
   */
  const balanceLine = (label: string, wallets: readonly { readonly currency: string; readonly text: string }[]): ReactNode =>
    (wallets.length === 0 ? null : h('div', { className: 'dsr-account-balance' },
      h('span', { className: 'dsr-account-balance-label' }, label),
      h('span', { className: 'dsr-account-balance-value' },
        wallets.map((wallet) => h('span', { key: wallet.currency }, wallet.text)))))
  return props.shell(t('rail.account'),
    h('div', null,
      signedOut
        ? h('div', { className: 'dsr-hint' }, t('account.signedOut'))
        : h('div', null,
          // 已登录但没有正余额：宿主也用同样的「不可用」措辞，而不是省掉该行，
          // 于是缺席不会被误读成零余额。
          balances.wallets.length === 0
            ? h('div', { className: 'dsr-hint' }, t('account.balanceUnavailable'))
            : balanceLine(t('account.balance'), balances.wallets),
          balanceLine(t('account.bonus'), balances.bonusWallets)),
      // 宿主账号区链接的平台目标。它们在新窗口打开：第三方客户端模块
      // 够不到桌面桥的内嵌页面。
      links.usageUrl === undefined && links.topUpUrl === undefined
        ? null
        : h('div', { className: 'dsr-account-links' },
          links.usageUrl === undefined ? null : h('a', {
            className: 'dsr-account-link',
            href: links.usageUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
          }, t('account.usage')),
          links.topUpUrl === undefined ? null : h('a', {
            className: 'dsr-account-link',
            href: links.topUpUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
          }, t('account.topUp'))),
      h('div', { className: 'dsr-hint' }, t('account.hint')),
      // 宿主拥有设置面板，且对第三方客户端模块没有公开「打开设置」的 API：
      // layout 只有 selectPanel/toggleSidebar，shortcuts 没有 dispatch，
      // 面板的 open() 在 sidebar.settings 作用域的 store 里，而那唯一一个
      // settings.launcher 格子被宿主自己的账号插件占着。所以诚实的入口是
      // 告诉人路径，并把本插件能替他做的那一步放在旁边。
      h('div', { className: 'dsr-hint' }, t('account.settingsPath')),
      h(ActionRow, { onClick: props.onExpand }, t('rail.expand'))),
    undefined, true)
}

import { sectionIsOpen } from '../model/geometry.ts'

/** 分区是否展开（薄包装，保持渲染层不直接 import 模型函数名）。 */
function sectionIsOpenSafe(folded: FoldedSections, id: string, defaultOpen: boolean): boolean {
  return sectionIsOpen(folded, id, defaultOpen)
}