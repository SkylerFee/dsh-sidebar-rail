/**
 * 浮层的打开/关闭/焦点/计时器与临时状态复位。
 *
 * 这一组行为原先散在 `RailColumn` 里：命中区不同、计时器互相取消、Escape
 * 回焦、关闭时清空折叠分区与展开项目。抽成钩子后，状态所有权只有一处。
 *
 * 状态归属（0.5.0 起）：
 *   - **展开的项目**落盘（`dsh.sidebar-rail.v1` 的 `expandedProjectIds`），
 *     重开浮层、甚至重启宿主后仍然展开；
 *   - **折叠的分区**仍只活在组件里，每次打开浮层都回到 spec 的默认态；
 *   - **锚点**用图标轨的固定几何，不读按钮的实时矩形（见 `scheduleOpen`）。
 */
import { useCallback, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { CLOSE_DELAY_MS, OPEN_DELAY_MS } from '../model/constants.ts'
import type { FoldedSections } from '../model/types.ts'
import { DEFAULT_FLYOUT_ANCHOR, flyoutAnchorFrom } from '../model/geometry.ts'
import type { FlyoutAnchor, TriggerRectLike } from '../model/geometry.ts'
import { readExpandedProjectIds, writeExpandedProjectIds } from '../preferences.ts'

/** 可打开的浮层 id。 */
export type FlyoutKind = 'workspace' | 'tasks' | 'plugins' | 'more' | 'account'

/**
 * 浮层默认锚点：拿不到按钮矩形时的兜底。
 *
 * 定义在模型层（`geometry.ts`），因为它由轨的固定几何决定，与 React 无关。
 */
export const DEFAULT_ANCHOR: FlyoutAnchor = DEFAULT_FLYOUT_ANCHOR

/** `useFlyout` 的返回值。 */
export interface FlyoutController {
  /** 当前打开的浮层；null 表示没有。 */
  readonly open: FlyoutKind | null
  /** 浮层锚点（图标按钮的视口位置）。 */
  readonly anchor: FlyoutAnchor
  /** 折叠的分区（按浮层命名空间化的 id）。 */
  readonly foldedSections: FoldedSections
  /** 展开的项目（按工作区 id）。 */
  readonly expandedProjects: Readonly<Record<string, boolean | undefined>>
  /** 添加项目动作的状态。 */
  readonly projectAction: ProjectActionState
  /** 浮层面板元素，供焦点移动与外部点击判断。 */
  readonly panelRef: MutableRefObject<HTMLDivElement | null>
  /** 打开浮层的图标按钮，供 Escape 回焦。 */
  readonly triggerRef: MutableRefObject<HTMLButtonElement | null>
  /** 收起或展开一个分区。 */
  toggleSection(id: string): void
  /** 展开或收起一个项目的会话列表。 */
  toggleProject(workspaceId: string): void
  /** 写入添加项目动作的状态。 */
  setProjectAction(next: ProjectActionState): void
  /** 悬停停留后打开某个浮层。 */
  scheduleOpen(kind: FlyoutKind, event: TriggerEventLike | undefined): void
  /** 指针进入浮层时取消待关闭。 */
  cancelClose(): void
  /** 指针离开后按宽限期关闭。 */
  scheduleClose(): void
  /** 关闭浮层但保留图标轨位置，并复位临时状态。 */
  dismiss(): void
  /** 关闭浮层并收起图标轨。 */
  retract(): void
  /** 把焦点从触发按钮移进浮层。 */
  focusFlyout(): void
  /** 清掉打开/关闭计时器。 */
  clearTimers(): void
}

/**
 * 触发事件在钩子里读取的最小面。
 *
 * 只取 `top` / `bottom`（垂直位置不受轨的水平滑动影响）；矩形里的 `right`
 * 刻意忽略，理由见 `flyoutAnchorFrom`。
 */
export interface TriggerEventLike {
  readonly currentTarget?: { getBoundingClientRect?: () => TriggerRectLike } | null
}

/** 添加项目动作的状态。 */
export type ProjectActionState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'busy' }
  | { readonly phase: 'failed'; readonly message: string }

/**
 * 把持久化的工作区 id 数组展开成组件用的映射。
 *
 * 渲染层只认 `expandedProjects[id] === true`，因此映射里只放 `true`；
 * 未出现的项目天然是收起态（`undefined`）。
 * @param ids - 展开中的工作区 id。
 * @returns 工作区 id → true 的只读映射。
 */
function expandedProjectsOf(ids: readonly string[]): Readonly<Record<string, boolean | undefined>> {
  const out: Record<string, boolean | undefined> = {}
  for (const id of ids) out[id] = true
  return out
}

/**
 * 图标轨浮层的交互状态机。
 *
 * 悬停打开、离开宽限关闭、Escape 回焦、关闭时清空分区折叠状态。
 *
 * 持久化边界（spec-0.5.0 §4.2）：**展开的项目**读写
 * `dsh.sidebar-rail.v1#expandedProjectIds`，跨浮层开关保留；**折叠的分区**是
 * 每次打开都重置的临时状态，不写盘。
 * @param appWindow - 可注入的 window（默认取全局，便于测试替身）。
 * @returns 浮层控制器。
 */
export function useFlyout(appWindow: Window = window): FlyoutController {
  const [open, setOpen] = useState<FlyoutKind | null>(null)
  const [anchor, setAnchor] = useState<FlyoutAnchor>(DEFAULT_ANCHOR)
  const [foldedSections, setFoldedSections] = useState<FoldedSections>({})
  // 展开的项目从存储物化；轨组件从不卸载，因此这份状态在会话内就是权威副本。
  const [expandedProjects, setExpandedProjects] = useState<Readonly<Record<string, boolean | undefined>>>(
    () => expandedProjectsOf(readExpandedProjectIds()),
  )
  // 与 state 同步的镜像：写入存储要走「先算新映射、再落盘」一步，而
  // setState 的更新函数里做副作用会在 StrictMode 下被调用两次。
  const expandedProjectsRef = useRef<Readonly<Record<string, boolean | undefined>>>(expandedProjects)
  const [projectAction, setProjectActionState] = useState<ProjectActionState>({ phase: 'idle' })
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  /**
   * 折叠或展开一个分区。
   *
   * 折叠只切换挂载的内容体；面板高度由壳体决定，因此面板不会改变尺寸（验收 B4）。
   * @param id - 分区 id，已按浮层命名空间化。
   */
  const toggleSection = useCallback((id: string) => {
    setFoldedSections((current) => ({ ...current, [id]: current[id] !== true }))
  }, [])

  /**
   * 展开或收起一个项目的会话列表，并把结果写回存储。
   *
   * 展开状态是**持久化**的（spec-0.5.0 §4.2）：收起时把 id 从映射里删掉而不是
   * 记 `false`，这样写盘的数组只含展开中的项目。写入走 `writeExpandedProjectIds`
   * 的合并语义，因此不会覆盖置顶列表与最近会话条数。多个项目可同时展开。
   * @param workspaceId - 工作区 id。
   */
  const toggleProject = useCallback((workspaceId: string) => {
    const current = expandedProjectsRef.current
    const next: Record<string, boolean | undefined> = { ...current }
    if (current[workspaceId] === true) delete next[workspaceId]
    else next[workspaceId] = true
    expandedProjectsRef.current = next
    setExpandedProjects(next)
    writeExpandedProjectIds(Object.keys(next).filter((id) => next[id] === true))
  }, [])

  /**
   * 写入添加项目动作的状态。
   * @param next - 新状态。
   */
  const setProjectAction = useCallback((next: ProjectActionState) => {
    setProjectActionState(next)
  }, [])

  /**
   * 清掉打开/关闭计时器。
   */
  const clearTimers = useCallback(() => {
    if (openTimer.current !== undefined) {
      appWindow.clearTimeout(openTimer.current)
      openTimer.current = undefined
    }
    if (closeTimer.current !== undefined) {
      appWindow.clearTimeout(closeTimer.current)
      closeTimer.current = undefined
    }
  }, [appWindow])

  /**
   * 为某个图标入口武装停留计时器。
   *
   * **锚点只用轨的固定几何，绝不读按钮的实时矩形来决定水平位置**
   * （spec-0.5.0 §4.5.1 决策 3）。原因：轨的露出动画是 `transform: translateX(-100%)`
   * → `translateX(0)` 的 160ms 过渡，而浮层在 120ms 后就打开。在事件发生时
   * （t=0）量到的矩形，左侧还在窗口外，`right` 因而偏小，浮层就被摆得偏左；
   * 即便改到计时器回调里再量，也仍是过渡中途的位置，结果依赖动画时序。
   * 锚点的语义本就是「轨在哪」，所以水平基准是常量：左缘 0、右缘
   * `RAIL_REVEAL_WIDTH`。同一修法也顺带覆盖「轨正在收回时打开浮层」。
   *
   * 垂直位置仍取自按钮矩形：它不受水平滑动影响，且保留它浮层才能与按钮对齐；
   * 拿不到矩形时退回 `DEFAULT_ANCHOR` 的垂直值。
   * @param kind - 要打开的浮层。
   * @param event - 触发事件（只借它的 top/bottom 做垂直对齐）。
   */
  const scheduleOpen = useCallback((kind: FlyoutKind, event: TriggerEventLike | undefined) => {
    const rect = event?.currentTarget?.getBoundingClientRect?.()
    clearTimers()
    openTimer.current = appWindow.setTimeout(() => {
      // 纯函数在模型层：水平基准是轨的固定几何，垂直位置才来自按钮矩形。
      setAnchor(flyoutAnchorFrom(rect))
      setOpen(kind)
    }, OPEN_DELAY_MS)
  }, [appWindow, clearTimers])

  /**
   * 指针移进浮层时取消待关闭。
   */
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== undefined) {
      appWindow.clearTimeout(closeTimer.current)
      closeTimer.current = undefined
    }
  }, [appWindow])

  /**
   * 把焦点从触发按钮移进已打开的浮层。
   *
   * 普通 Tab 会先走完图标再进浮层，而每个图标聚焦时又会打开自己的浮层，
   * 于是 Tab 会在焦点到达列表前把它替换掉。显式进入（触发按钮上的 Down/Right）
   * 才是让列表可达的方式，不必为图标轨另造一套 roving tabindex。
   */
  const focusFlyout = useCallback(() => {
    const panel = panelRef.current
    if (panel === null) return
    const first = panel.querySelector('button:not([data-dsr-skip-focus])')
    if (first instanceof HTMLElement) first.focus()
  }, [])

  /**
   * 关闭浮层，但把图标轨留在原处，并复位临时状态。
   *
   * 在图标之间悬停会触发这里：指针跨过每个图标的边界，若把它当成「交互结束」
   * 去收起图标轨，轨会从边缘条重新展开——在图标列最密的地方最容易触发的振荡。
   */
  const dismiss = useCallback(() => {
    setOpen(null)
    // 图标轨从不卸载，因此只靠组件状态会让折叠分区带进下一次打开。
    // spec 规定分区折叠每次打开都从默认值开始，所以关闭时复位；
    // **展开的项目不复位**——它在存储里，跨开关存活（spec-0.5.0 §4.2）。
    setFoldedSections({})
    setProjectActionState({ phase: 'idle' })
  }, [])

  /**
   * 关闭浮层并收起图标轨。
   *
   * 用在交互真正结束的地方：选中条目、导航离开或 Escape。这些路径上的收起不能
   * 依赖图标轨自己的 `pointerleave`——选中条目后指针停在浮层上（轨的右侧），
   * 不会再收到轨的事件。
   */
  const retract = useCallback(() => {
    setOpen(null)
    // 与 dismiss 同理：分区折叠必须忘掉，否则下次打开会续上别人的状态。
    // 项目展开相反——它是持久化偏好，必须留下来。
    setFoldedSections({})
    setProjectActionState({ phase: 'idle' })
  }, [])

  /**
   * 宽限期结束后关闭。
   */
  const scheduleClose = useCallback(() => {
    clearTimers()
    closeTimer.current = appWindow.setTimeout(() => dismiss(), CLOSE_DELAY_MS)
  }, [appWindow, clearTimers, dismiss])

  return {
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
    clearTimers,
  }
}
