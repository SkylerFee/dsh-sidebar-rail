/**
 * 折叠导航轨：四个入口、一个账号座位、同一时间只有一个悬停浮层。
 *
 * 展开态把整个列交给宿主，宿主拥有展开后的侧栏（搜索、视图选项、设置）。
 * 本文件只做编排：纯逻辑在 `model/*`，交互状态在 `hooks/*`，宿主调用在
 * `host-adapter.ts`。图标轨本体与浮层都 portal 到 `document.body`，
 * 因为宿主的零宽、`overflow: hidden` 折叠列会裁掉任何内部定位。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { h } from '../jsx.ts'
import type { RailColumnProps } from '../contracts.ts'
import { useFlyout } from '../hooks/use-flyout.ts'
import type { FlyoutKind } from '../hooks/use-flyout.ts'
import { readFrameTopClearance, useWindowFocused } from '../hooks/use-rail-visibility.ts'
import { useFlyoutList } from '../hooks/use-remote-list.ts'
import { makeFlyoutShell } from './flyout-shell.tsx'
import {
  AccountFlyout,
  MoreFlyout,
  PluginsFlyout,
  TasksFlyout,
  WorkspaceFlyout,
} from './flyouts.tsx'
import { RailSurface } from './RailSurface.tsx'
import {
  RAIL_HOTZONE_WIDTH,
  RAIL_REVEAL_WIDTH,
  REMOTE_TIMEOUT_MS,
  RETRACT_DELAY_MS,
} from '../model/constants.ts'
import { keepsRailRevealed, pointerInHotzone } from '../model/geometry.ts'
import {
  groupPluginsByState,
  groupTasksByStatus,
  normalizePlugins,
  normalizeTasks,
  pickedDirectory,
  sessionHasActiveTask,
} from '../model/remote.ts'
import {
  currentSessionId,
  deriveSections,
  projectSessionRows,
} from '../model/workspaces.ts'
import { rawKeyTranslator } from '../locales.ts'
import { writeStore } from '../preferences.ts'
import type {
  AccountSeat,
  AccountSeatWithExtras,
  ProjectSessionRow,
  SessionListStateLike,
  SessionStatusSnapshotLike,
  WorkspaceRow,
  WorkspaceViewLike,
} from '../model/types.ts'

/** 会话列表在宿主 hook 缺席时的替身，让缺一个 props 不至于空白整列。 */
const EMPTY_SESSIONS: SessionListStateLike = { ids: [], byId: {}, phase: 'empty', projectionsBySession: {} }

/** 工作区列表在宿主 hook 缺席时的替身。 */
const EMPTY_WORKSPACES: { readonly items: readonly WorkspaceViewLike[]; readonly archivedSessionIds: readonly string[] } = {
  items: [],
  archivedSessionIds: [],
}

/** 主面板信息在宿主 hook 缺席时的替身。 */
const EMPTY_PANEL_INFO = { activePanelId: null }

/**
 * 挑一个标准 selector hook，缺失时退化成常量读取。
 * @param candidate - 框架注入的 hook（若存在）。
 * @param fallbackValue - 替身 hook 返回的值。
 * @returns 同调用形状的 selector hook。
 */
function selectorHook<T>(
  candidate: ((select: (state: T) => unknown) => unknown) | undefined,
  fallbackValue: T,
): (select: (state: T) => unknown) => unknown {
  if (typeof candidate === 'function') return candidate
  return (select) => (typeof select === 'function' ? select(fallbackValue) : fallbackValue)
}

/**
 * 折叠导航轨。
 * @param props - 标准 hooks、注入面与翻译函数。
 * @returns portal 渲染出来的图标轨元素。
 */
export function RailColumn(props: RailColumnProps): ReactNode {
  const t = typeof props.t === 'function' ? props.t : rawKeyTranslator
  const {
    toggleSidebar,
    selectPanel,
    // openWorkspace 仍由注入面提供（宿主契约完整），但当前 UI 不消费它：
    // 点击项目行是展开成员列表，导航走 openSession / startSession。
    openSession,
    startSession,
    pickDirectory,
    createWorkspace,
    panels,
    locale,
    scheduleCatalog,
    pluginInventory,
  } = props

  // 标准 hooks 是读取列表状态的受许方式；各自退化成常量读取，
  // 于是少一个 props 也不会让整列变空白。
  const readSessions = selectorHook<SessionListStateLike>(
    props.useSessions as ((select: (state: SessionListStateLike) => unknown) => unknown) | undefined,
    EMPTY_SESSIONS,
  ) as (select: (state: SessionListStateLike) => unknown) => unknown
  const readWorkspaces = selectorHook(
    props.useWorkspaces as ((select: (state: typeof EMPTY_WORKSPACES) => unknown) => unknown) | undefined,
    EMPTY_WORKSPACES,
  ) as (select: (state: typeof EMPTY_WORKSPACES) => unknown) => unknown
  const readPanelInfo = selectorHook(
    props.usePanelInfo as ((select: (state: typeof EMPTY_PANEL_INFO) => unknown) => unknown) | undefined,
    EMPTY_PANEL_INFO,
  ) as (select: (state: typeof EMPTY_PANEL_INFO) => unknown) => unknown
  const readStatuses = selectorHook(
    props.useSessionStatus as ((select: (state: SessionStatusSnapshotLike | undefined) => unknown) => unknown) | undefined,
    undefined,
  ) as (select: (state: SessionStatusSnapshotLike | undefined) => unknown) => unknown

  const sessions = readSessions((state) => state) as SessionListStateLike
  const workspaceItems = readWorkspaces((state) => state.items) as readonly WorkspaceViewLike[]
  const archivedIds = readWorkspaces((state) => state.archivedSessionIds) as readonly string[]
  const activePanelId = readPanelInfo((info) => info.activePanelId) as string | null | undefined
  // 非会话面板（插件页、定时任务页…）占据主区并盖住会话，宿主那时会清掉自己的
  // 会话高亮。`conversation` 本身也是一个注册的主面板（ui-conversation 声明
  // `key: 'conversation'`），所以 activePanelId 非空**并不**意味着会话被盖住
  // ——只有别的主面板 id 才算。仅与 null 比较会在会话可见时也隐藏高亮。
  const panelCovering = activePanelId !== null && activePanelId !== undefined && activePanelId !== 'conversation'
  // 宿主拥有的每会话 UI 状态；可选——没有该 props 时行只用 SessionSummary.running。
  const statuses = readStatuses((snapshot) => snapshot) as SessionStatusSnapshotLike | undefined

  // 账号座位：每个挂载只读一次；缺席或失败的读取只留下中性兜底字符。
  const [accountSeat, setAccountSeat] = useState<AccountSeat & Partial<AccountSeatWithExtras>>({
    kind: 'unknown',
    avatarUrl: undefined,
  })
  // 面板条目与语言是两个可订阅快照；`useObservable` 让 react 与它们同步。
  const panelEntries = useObservable(panels, (entries) => entries)
  const language = useObservable(locale, (snapshot) => snapshot.active)

  const [pins, setPins] = useState<readonly string[]>(() => {
    const stored = readStorePins()
    return Array.isArray(stored) ? stored.map(String) : []
  })
  const flyout = useFlyout()
  const {
    open,
    anchor,
    foldedSections,
    expandedProjects,
    projectAction,
    panelRef,
    triggerRef,
    toggleSection,
    toggleProject,
    setProjectAction,
    scheduleOpen,
    cancelClose,
    scheduleClose,
    dismiss,
    retract,
    focusFlyout,
    effectiveWatermark,
    raiseWatermark,
    noteWatermark,
  } = flyout

  // 图标轨保持滑出，直到指针到达左缘、或有人用键盘聚焦它。
  const [revealed, setRevealed] = useState(false)
  /**
   * 本窗口是否持有焦点。
   *
   * macOS 上指针滑进**未聚焦**的窗口也会派发 pointerenter，因此只看指针
   * 位置会让轨在别的应用里被扫出来。唤出与保持都需要这一条为前提。
   */
  const windowFocused = useWindowFocused()
  /**
   * 轨根元素的 ref。
   *
   * 与 `panelRef` 一起用来反查「焦点是否还在轨/浮层里」——两者是并列的
   * portal，事件不会互相冒泡，只能主动查 `document.activeElement`。
   */
  const railRootRef = useRef<HTMLDivElement | null>(null)
  const retractTimer = useRef<number | undefined>(undefined)

  /**
   * 指针回到轨上时取消待收起的动作。
   */
  const cancelRetract = useCallback(() => {
    if (retractTimer.current !== undefined) {
      window.clearTimeout(retractTimer.current)
      retractTimer.current = undefined
    }
  }, [])

  /**
   * 稍后收起，于是只是掠过边缘的指针不会让它闪一下。
   */
  const scheduleRetract = useCallback(() => {
    cancelRetract()
    retractTimer.current = window.setTimeout(() => {
      setRevealed(false)
    }, RETRACT_DELAY_MS)
  }, [cancelRetract])

  useEffect(() => cancelRetract, [cancelRetract])

  /**
   * 唤出图标轨（键盘路径）。
   *
   * 指针路径**不经过这里**：它由下面的 pointermove 连续判定驱动。原因见
   * {@link pointerInHotzone} 的文档——窗口边缘跨屏时，pointerenter 的坐标
   * 会被钳进视口，连坐标门禁都拦不住，只有连续移动的坐标才可信。
   *
   * 键盘路径没有指针事件，因此不做坐标判定，只要求窗口持有焦点。
   */
  const revealRailFromKeyboard = useCallback(() => {
    if (!windowFocused) return
    setRevealed(true)
  }, [windowFocused])

  // 窗口失去焦点时立刻收起：留在屏幕上的轨属于「我刚才在用」，不是现在。
  // 指针可能仍停在轨上，但那时人已经切到别的应用了。
  useEffect(() => {
    if (windowFocused) return
    setRevealed(false)
  }, [windowFocused])

  /**
   * 焦点是否仍落在「轨 + 当前浮层」这个整体之内。
   *
   * 轨与浮层是**两个各自独立的 portal**（都挂到 document.body），所以
   * 它们之间不会互相冒泡 focus/blur：焦点从轨走进浮层时，轨只看到自己
   * 失去焦点，浮层也不会通知轨自己收到了焦点。只用 rail-float 的
   * onBlurCapture 判断，会出现「焦点 Tab 进浮层后继续 Tab 走到页面别处，
   * 轨和浮层却都还留着」——因为离开轨那一下被 `open !== null` 放行了，
   * 之后没有任何人再接住。
   *
   * 因此判据改成「焦点是否还在两者之一的子树里」，用 document.activeElement
   * 反查，不再依赖冒泡。
   * @returns 焦点仍在轨或浮层内时为 true。
   */
  const focusInsideRailOrFlyout = useCallback((): boolean => {
    if (typeof document === 'undefined') return false
    const active = document.activeElement
    if (active === null) return false
    const rail = railRootRef.current
    if (rail !== null && rail.contains(active)) return true
    const panel = panelRef.current
    return panel !== null && panel.contains(active)
  }, [panelRef])

  /**
   * 让图标轨可见性与指针位置保持同步。
   *
   * 用 window 级监听而不是元素事件：唤出条与滑动的图标轨互相重叠，两者任一
   * 收到 `pointerleave` 时对方正好接手命中目标。改由位置决定——在轨宽之内
   * 就保持展开，越过窗口左缘之外就收起——且已打开的浮层永远优先，让指针可以
   * 走到它上面。
   */
  useEffect(() => {
    /**
     * 指针移动时同步图标轨的显隐。
     *
     * **唤出与保持共用这一条判据，且都以 pointermove 的坐标为唯一依据。**
     * 不能用 pointerenter 唤出：窗口边缘跨屏时（DSH 右边框贴屏幕右缘、右侧
     * 还有一块屏），指针移出窗口会派发一次带 `relatedTarget = null` 的
     * `pointerover`，React 把它合成成「进入了热区」，而那条事件带的
     * `clientX` 会被钳进视口、恰好落在热区范围内——连坐标门禁都拦不住。
     * 连续移动的坐标才可信。
     * @param event - 指针移动事件。
     */
    const onMove = (event: PointerEvent): void => {
      if (!revealed) {
        // 未展开：只做唤出。
        if (!windowFocused) return
        // 触屏没有「悬停」这个持续状态，不参与唤出。
        if (event.pointerType === 'touch') return
        if (!pointerInHotzone(event.clientX, RAIL_HOTZONE_WIDTH)) return
        setRevealed(true)
        return
      }
      // 已展开：只做保持/收起。
      if (open !== null) return
      const railWidth = RAIL_REVEAL_WIDTH
      const target = event.target
      const inFlyout = panelRef.current !== null
        && target instanceof Node
        && panelRef.current.contains(target)
      if (inFlyout) return
      if (keepsRailRevealed(event.clientX, railWidth)) return
      setRevealed(false)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
    }
  }, [revealed, open, panelRef, windowFocused])

  // 账号座位每个挂载只读一次。按 PRD 的非目标，它不订阅 account/watch，
  // 因此插件挂载期间登录或退出都会让座位保持原样；宿主自己的账号页是权威视图。
  // 跳过订阅也让插件少一个必须拆除的长生命周期监听器。
  const avatarAsked = useRef(false)
  useEffect(() => {
    if (avatarAsked.current) return undefined
    avatarAsked.current = true
    let live = true
    Promise.resolve()
      .then(() => props.accountSeat())
      .then((seat) => {
        if (live && seat !== null && typeof seat === 'object') setAccountSeat(seat)
      })
      .catch(() => {
        // 兜底字符就是失败态。
      })
    return () => {
      live = false
    }
  }, [props])

  // 任务与插件的懒加载远程读取：每次浮层打开只跑一次，切走后旧答案不算数。
  // 任务列表在两个浮层里都要用：任务浮层画分区，工作区浮层给会话行标定时任务
  // 时钟（spec-0.5.1 §5）。共用同一份状态，因此只加载一次。
  const taskList = useFlyoutList({
    open,
    when: ['tasks', 'workspace'],
    load: scheduleCatalog,
    normalize: normalizeTasks,
    label: 'tasks',
  })
  const pluginList = useFlyoutList({
    open,
    when: 'plugins',
    load: pluginInventory,
    normalize: normalizePlugins,
    label: 'plugins',
  })

  /**
   * 切换一个工作区的置顶并持久化新的顺序。
   * @param workspaceId - 工作区 id。
   */
  const togglePin = useCallback((workspaceId: string) => {
    setPins((current) => {
      const next = current.includes(workspaceId)
        ? current.filter((id) => id !== workspaceId)
        : [workspaceId, ...current]
      writeStore({ pinnedWorkspaceIds: next })
      return next
    })
  }, [])

  /**
   * 选一个目录并登记为项目，停在浮层里。
   *
   * 三种结局（spec §4.5.3）：选中的目录被登记且浮层留着（不导航、不新建会话）；
   * 取消则静默返回；失败在项目分区里显示，不让人干猜。宿主侧本身幂等——
   * 它的 `create` 会解析已有的工作区而不是重复创建——所以选一个已登记的目录
   * 只是重新列出它，不算失败。
   *
   * `pickDirectory` 在挂载的后端服务内嵌浏览器（而非原生选择器）时会拒绝
   * （ADR-0005），这正是失败态必须是一等分支而不是兜底日志的原因。
   */
  const addProject = useCallback(() => {
    setProjectAction({ phase: 'busy' })
    // AGENTS.md 硬约束 8：可选 Host 调用绝不能把界面留在永久加载态。原生选择器
    // 可能挂起（它是经 Remote 到达的系统对话框），而 `create` 是 RPC，因此整条
    // 序列与列表加载器一样，和同一个预算赛跑。
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      console.warn('[dsh-sidebar-rail] add project timed out')
      setProjectAction({ phase: 'failed', message: t('state.addProjectFailed') })
    }, REMOTE_TIMEOUT_MS)
    /**
     * 标记整条序列结束，让超时不再触发。
     * @param next - 最终状态。
     */
    const finish = (next: { phase: 'idle' } | { phase: 'failed'; message: string }): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      setProjectAction(next)
    }
    // 三态必须分开（spec §4.5.3，K1）：host 的 pickDirectory 在**用户取消时
    // resolve 出 null**，只有真失败才 reject。所以判定依据是 resolve 出来的值，
    // 不是「有没有拒绝」；成功值也绝不能在中间某一跳被丢掉——迁移前的
    // `.then((_picked) => undefined, ...)` 正是「添加项目永远走取消分支」的根因。
    Promise.resolve()
      // 没有 pick 动词的宿主不能被读成「用户取消了」：那会把原因静默吞掉。
      // 抛出去，由外层 catch 报成失败。
      .then(() => {
        if (typeof pickDirectory !== 'function') throw new Error('directory picker unavailable')
        return pickDirectory()
      })
      // 成功值原样交给归一化函数：null / 相对路径 / 畸形值都在那里收敛。
      .then((picked) => pickedDirectory(picked))
      .then((outcome) => {
        if (outcome.kind === 'cancelled') {
          // 取消是静默结局：不报错、不留 loading。
          finish({ phase: 'idle' })
          return undefined
        }
        if (outcome.kind === 'failed') {
          console.warn('[dsh-sidebar-rail] directory pick failed:', outcome.message)
          finish({ phase: 'failed', message: t('state.addProjectFailed') })
          return undefined
        }
        if (typeof createWorkspace !== 'function') {
          finish({ phase: 'failed', message: t('state.addProjectUnavailable') })
          return undefined
        }
        // 登记失败与选择失败分开处理：这里已经是「选到了路径但登记不上」。
        // 宿主 create 是幂等的，选一个已登记的目录会成功返回而不是报错。
        return Promise.resolve(createWorkspace(outcome.path)).then(
          () => {
            finish({ phase: 'idle' })
          },
          (error: unknown) => {
            console.warn('[dsh-sidebar-rail] add project failed', error)
            finish({ phase: 'failed', message: t('state.addProjectFailed') })
          },
        )
      })
      .catch((error: unknown) => {
        // 选择器本身拒绝了（如挂载的后端服务内嵌浏览器，ADR-0005）。
        console.warn('[dsh-sidebar-rail] directory pick failed', error)
        finish({ phase: 'failed', message: t('state.addProjectFailed') })
      })
    // `t` 刻意不作为依赖：宿主每次渲染都会给一个新的翻译函数，
    // 列进依赖会让这个回调每次重建却毫无收益。它只把键映射到当前语言的文案，
    // 因此过期的闭包仍读到正确的文案。
  }, [pickDirectory, createWorkspace, setProjectAction, t])

  /**
   * 在一个项目里新建会话，然后离开浮层。
   *
   * `startSession` 是宿主自己的公开动词，接受工作区 id；它返回 void，所以这里
   * 没有 id 可操作——宿主自己会切换主视图。未知 id 会同步抛错，而它启动的导航
   * 内部是 Promise，因此这里两层都要兜住：失败不能把图标轨一起带下去。
   * @param workspaceId - 要在其中创建会话的项目。
   */
  const startSessionInProject = useCallback((workspaceId: string) => {
    retract()
    try {
      Promise.resolve(startSession(workspaceId)).catch((error: unknown) => {
        console.warn('[dsh-sidebar-rail] start session failed', error)
      })
    } catch (error) {
      console.warn('[dsh-sidebar-rail] start session failed', error)
    }
  }, [startSession, retract])

  /**
   * 显示一个已有会话并关闭浮层。
   *
   * `SessionTarget` 是 `SessionId | SubagentAddress`——一个裸 id，而不是这里
   * 以前传的 `{ kind, sessionId }` 对象。宿主把那个对象读成「没有指定会话」，
   * 于是退回打开一个新会话，这正是点击最近会话却新建了一个的原因。
   * @param sessionId - 会话 id。
   */
  const openSessionFromRail = useCallback((sessionId: string) => {
    retract()
    try {
      // 同步：宿主在返回前就会对未知 id 抛错，因此 Promise 级 catch 永远看不到它。
      openSession(sessionId)
    } catch (error) {
      console.warn('[dsh-sidebar-rail] open session failed', error)
    }
  }, [openSession, retract])

  /** 浮层外壳：定位与固定高度。Escape 刻意不绑定开关（见 flyout-shell 的注释）。 */
  const shell = makeFlyoutShell({
    title: '',
    body: null,
    anchor,
    viewportHeight: window.innerHeight,
    topClearance: readFrameTopClearance(),
    onPointerEnter: cancelClose,
    onPointerLeave: scheduleClose,
    panelRef,
    onFocusLeave: focusInsideRailOrFlyout,
    onFocusLost: () => {
      // 焦点彻底离开「轨 + 浮层」：收起轨并关掉浮层，两件事一起做。
      setRevealed(false)
      dismiss()
    },
  })

  // 派生分区：置顶、普通、最近会话。两种列表策略不同，见 workspaces.ts。
  const sections = useMemo(
    () => deriveSections(workspaceItems, sessions, archivedIds, pins, language, panelCovering, statuses),
    [workspaceItems, sessions, archivedIds, pins, language, panelCovering, statuses],
  )
  // 主视图正在显示的会话，供展开的项目列表使用。读与最近会话区同一个辅助函数，
  // 于是两处标同一行。
  const shownSessionId = useMemo(
    () => currentSessionId(sessions, panelCovering),
    [sessions, panelCovering],
  )
  const byId = sessions.byId ?? {}
  // 任务与插件行从归一化步骤到达时是扁平的；浮层在渲染时拆分，
  // 于是发一次远程读取就喂了每个分区。
  const taskGroups = useMemo(() => groupTasksByStatus(taskList.rows), [taskList.rows])
  const pluginGroups = useMemo(() => groupPluginsByState(pluginList.rows), [pluginList.rows])

  /**
   * 为一个工作区行取项目成员行。
   * @param row - 工作区行。
   * @returns 该项目下的会话行。
   */
  const rowsForProject = useCallback((row: WorkspaceRow): readonly ProjectSessionRow[] =>
    projectSessionRows(row.sessionIds, byId, language, archivedIds, shownSessionId),
  [byId, language, archivedIds, shownSessionId])

  /**
   * 某个会话是否有活跃的定时任务，供行首的时钟标记判定。
   *
   * 读的是工作区浮层也会加载的那份任务列表；读取失败或超时时列表为空，
   * 于是所有行都返回 false——时钟不出现，但会话列表照常渲染。
   */
  const hasActiveTask = useCallback(
    (sessionId: string) => sessionHasActiveTask(taskList.rows, sessionId),
    [taskList.rows],
  )

  /** 关闭浮层并回到展开的宿主侧栏。 */
  const expandSidebar = useCallback(() => {
    retract()
    toggleSidebar()
  }, [retract, toggleSidebar])

  /** 打到某个主面板并关闭浮层。 */
  const openMainPanel = useCallback((id: string) => {
    retract()
    selectPanel(id)
  }, [retract, selectPanel])

  /**
   * 只渲染当前打开的那个浮层。
   * @returns 浮层元素；没有打开时返回 null。
   */
  const renderFlyout = (): ReactNode => {
    if (open === 'workspace') {
      return h(WorkspaceFlyout, {
        t,
        toggleSection,
        foldedSections,
        sections,
        expandedProjects,
        toggleProject,
        togglePin,
        openSession: openSessionFromRail,
        startSessionInProject,
        addProject,
        projectAction,
        projectSessionRows: rowsForProject,
        effectiveWatermark,
        raiseWatermark,
        noteWatermark,
        currentSessionId: shownSessionId,
        hasActiveTask,
        shell,
      })
    }
    if (open === 'tasks') {
      return h(TasksFlyout, {
        t,
        toggleSection,
        foldedSections,
        groups: taskGroups,
        phase: taskList.phase,
        openPanel: () => openMainPanel('schedules'),
        shell,
      })
    }
    if (open === 'plugins') {
      return h(PluginsFlyout, {
        t,
        toggleSection,
        foldedSections,
        groups: pluginGroups,
        phase: pluginList.phase,
        openPanel: () => openMainPanel('plugins'),
        shell,
      })
    }
    if (open === 'more') {
      return h(MoreFlyout, {
        t,
        panels: panelEntries,
        onExpand: expandSidebar,
        onSelectPanel: openMainPanel,
        shell,
      })
    }
    if (open === 'account') {
      return h(AccountFlyout, {
        t,
        seat: accountSeat,
        onExpand: expandSidebar,
        shell,
      })
    }
    return null
  }

  /** 当前打开的浮层元素。 */
  const flyoutNode = renderFlyout()

  return h(RailSurface, {
    t,
    open,
    activePanelId,
    accountSeat,
    revealed,
    onScheduleOpen: scheduleOpen,
    onCancelClose: cancelClose,
    onScheduleClose: scheduleClose,
    onRetract: retract,
    onToggleSidebar: toggleSidebar,
    onSelectPanel: (id: string) => {
      retract()
      selectPanel(id)
    },
    onTriggerRef: (_kind: FlyoutKind, node: HTMLButtonElement | null) => {
      triggerRef.current = node
    },
    onFocusFlyout: focusFlyout,
    onReveal: revealRailFromKeyboard,
    onCancelRetract: cancelRetract,
    onScheduleRetract: scheduleRetract,
    onBlurCollapse: () => {
      setRevealed(false)
    },
    onFocusLeave: focusInsideRailOrFlyout,
    railRootRef,
    onDismissFlyout: dismiss,
    flyout: flyoutNode,
  })
}

/**
 * 用 `useSyncExternalStore` 订阅本插件自己的一个可观察快照。
 * @param source - 暴露 getSnapshot/subscribe 的对象。
 * @param selector - 把快照映射成被订阅的切片。
 * @returns 选中的切片。
 */
function useObservable<T, Slice>(
  source: { getSnapshot(): T; subscribe(listener: () => void): () => void },
  selector: (snapshot: T) => Slice,
): Slice {
  const read = useCallback(() => selector(source.getSnapshot()), [source, selector])
  return useSyncExternalStore(source.subscribe, read, read)
}

/**
 * 读取持久化的置顶工作区 id（独立函数，便于 hook 初始化器调用）。
 * @returns 存储里的置顶 id 数组，或 undefined。
 */
function readStorePins(): readonly string[] | undefined {
  const stored = readStoreField('pinnedWorkspaceIds')
  return Array.isArray(stored) ? stored.map(String) : undefined
}

import { readStore } from '../preferences.ts'

/**
 * 从持久化状态里取一个字段。
 * @param key - 字段名。
 * @returns 该字段的值。
 */
function readStoreField(key: 'pinnedWorkspaceIds'): unknown {
  return readStore()[key]
}