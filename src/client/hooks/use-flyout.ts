/**
 * 浮层的打开/关闭/焦点/计时器与临时状态复位。
 *
 * 这一组行为原先散在 `RailColumn` 里：命中区不同、计时器互相取消、Escape
 * 回焦、关闭时清空折叠分区与展开项目。抽成钩子后，状态所有权只有一处。
 */
import { useCallback, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { CLOSE_DELAY_MS, OPEN_DELAY_MS } from '../model/constants.ts'
import type { FoldedSections } from '../model/types.ts'
import type { FlyoutAnchor } from '../model/geometry.ts'

/** 可打开的浮层 id。 */
export type FlyoutKind = 'workspace' | 'tasks' | 'plugins' | 'more' | 'account'

/** 浮层默认锚点：尚未从图标按钮量出真实位置时的兜底。 */
export const DEFAULT_ANCHOR: FlyoutAnchor = { top: 12, bottom: 44, right: 56 }

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

/** 触发事件在钩子里读取的最小面。 */
export interface TriggerEventLike {
  readonly currentTarget?: { getBoundingClientRect?: () => { top: number; bottom: number; right: number } } | null
}

/** 添加项目动作的状态。 */
export type ProjectActionState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'busy' }
  | { readonly phase: 'failed'; readonly message: string }

/**
 * 图标轨浮层的交互状态机。
 *
 * 悬停打开、离开宽限关闭、Escape 回焦、关闭时清空分区与项目展开状态：
 * 折叠状态与项目展开**刻意不落盘**，每次打开都从 spec 的默认值开始。
 * @param appWindow - 可注入的 window（默认取全局，便于测试替身）。
 * @returns 浮层控制器。
 */
export function useFlyout(appWindow: Window = window): FlyoutController {
  const [open, setOpen] = useState<FlyoutKind | null>(null)
  const [anchor, setAnchor] = useState<FlyoutAnchor>(DEFAULT_ANCHOR)
  const [foldedSections, setFoldedSections] = useState<FoldedSections>({})
  const [expandedProjects, setExpandedProjects] = useState<Readonly<Record<string, boolean | undefined>>>({})
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
   * 展开或收起一个项目的会话列表。
   *
   * 只存在于组件状态：spec 规定展开状态从不持久化，因此每次打开浮层都从
   * 「全部收起」开始。多个项目可以同时展开，互不影响。
   * @param workspaceId - 工作区 id。
   */
  const toggleProject = useCallback((workspaceId: string) => {
    setExpandedProjects((current) => ({ ...current, [workspaceId]: current[workspaceId] !== true }))
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
   * @param kind - 要打开的浮层。
   * @param event - 触发事件（用于量出锚点矩形）。
   */
  const scheduleOpen = useCallback((kind: FlyoutKind, event: TriggerEventLike | undefined) => {
    const rect = event?.currentTarget?.getBoundingClientRect?.()
    clearTimers()
    openTimer.current = appWindow.setTimeout(() => {
      if (rect !== undefined) setAnchor({ top: rect.top, bottom: rect.bottom, right: rect.right })
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
    // 图标轨从不卸载，因此只靠组件状态会让折叠分区（与展开的项目）带进下一次打开。
    // spec 规定每次打开都从默认值开始，所以关闭时复位。
    setFoldedSections({})
    setExpandedProjects({})
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
    // 与 dismiss 同理：已关闭的浮层必须忘掉折叠与展开状态，
    // 否则下次打开会续上别人的状态。
    setFoldedSections({})
    setExpandedProjects({})
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
