/**
 * 图标轨的可见结构：四个入口、账号座位、边缘热区，以及承载它们的两个 portal。
 *
 * 从 `RailColumn` 拆出来的只是**布局与事件接线**：数据、浮层内容与状态仍由
 * `RailColumn` 编排。这样「编排」与「绘制」各自可读，单文件也不会无限增长。
 */
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { h } from '../jsx.ts'
import type { FlyoutKind } from '../hooks/use-flyout.ts'
import { OPEN_DELAY_MS } from '../model/constants.ts'
import {
  AccountAvatar,
  IconMore,
  IconPlugins,
  IconTasks,
  IconWorkspace,
} from './primitives.tsx'
import type { Translate } from '../locales.ts'
import type { AccountSeat } from '../model/types.ts'

/** 一个图标入口的渲染参数。 */
export interface RailEntryOptions {
  /** 浮层类型。 */
  readonly kind: FlyoutKind
  /** 已翻译的无障碍标签。 */
  readonly label: string
  /** 图标元素。 */
  readonly icon: ReactNode
  /** 该入口对应的主面板是否正在显示。 */
  readonly current?: boolean | undefined
}

/** `RailSurface` 的入参：渲染图标轨所需的一切，全部由调用方持有。 */
export interface RailSurfaceProps {
  /** 翻译函数。 */
  readonly t: Translate
  /** 当前打开的浮层；null 表示没有。 */
  readonly open: FlyoutKind | null
  /** 主视图当前选中的主面板 id。 */
  readonly activePanelId: string | null | undefined
  /** 账号座位。 */
  readonly accountSeat: AccountSeat
  /** 是否已滑出。 */
  readonly revealed: boolean
  /** 打开某个浮层（停留计时在调用方）。 */
  readonly onScheduleOpen: (kind: FlyoutKind, event: { currentTarget?: { getBoundingClientRect?: () => { top: number; bottom: number; right: number } } | null } | undefined) => void
  /** 取消待关闭。 */
  readonly onCancelClose: () => void
  /** 安排关闭。 */
  readonly onScheduleClose: () => void
  /** 收起浮层（点击入口时）。 */
  readonly onRetract: () => void
  /** 展开或折叠宿主侧栏。 */
  readonly onToggleSidebar: () => void
  /** 切到某个主面板。 */
  readonly onSelectPanel: (id: string) => void
  /** 记录触发按钮，供 Escape 回焦。 */
  readonly onTriggerRef: (kind: FlyoutKind, node: HTMLButtonElement | null) => void
  /** 把焦点移进浮层。 */
  readonly onFocusFlyout: () => void
  /** 唤出条进入：展开图标轨。 */
  /**
   * 键盘路径的唤出。
   *
   * 指针路径不经过它：窗口边缘跨屏时 pointerenter 带的坐标会被钳进视口，
   * 无法据此判断指针是否真在左缘，因此唤出改由 RailColumn 的 document 级
   * pointermove 连续判定驱动。
   */
  readonly onReveal: () => void
  /** 取消待收起。 */
  readonly onCancelRetract: () => void
  /** 安排收起。 */
  readonly onScheduleRetract: () => void
  /** 焦点离开图标轨时收起。 */
  readonly onBlurCollapse: () => void
  /**
   * 焦点是否仍留在「轨 + 浮层」这个整体里。
   *
   * 轨与浮层是并列的两个 portal，不会互相冒泡 focus/blur，因此收起判定必须
   * 主动反查 `document.activeElement`，不能用 `contains(relatedTarget)`。
   */
  readonly onFocusLeave: () => boolean
  /** 轨根元素，供 onFocusLeave 反查。 */
  readonly railRootRef: { current: HTMLDivElement | null }
  /** 焦点离开整体时关掉已打开的浮层（但不收起轨，收起由 onBlurCollapse 管）。 */
  readonly onDismissFlyout: () => void
  /** 当前打开的浮层元素。 */
  readonly flyout: ReactNode
}

/**
 * 绘制图标轨本体与浮层。
 *
 * 只有 `createPortal(document.body)` 能逃出宿主零宽、`overflow: hidden` 的折叠列；
 * body 子元素继承宿主的 no-drag 规则；固定层从承载红绿灯与宿主重开控件的
 * 48px 窗口 chrome 带之下开始。
 * @param props - 渲染参数与全部回调。
 * @returns 两个 portal 组成的界面。
 */
export function RailSurface(props: RailSurfaceProps): ReactNode {
  const { t, open } = props

  /**
   * 一个图标入口：图标按钮连同它的悬停与点击接线。
   * @param options - 入口类型、标签、图标与当前态。
   * @returns 入口元素。
   */
  const railEntry = (options: RailEntryOptions): ReactNode => h('div', {
    key: options.kind,
    onPointerEnter: (event: React.PointerEvent<HTMLDivElement>) => {
      props.onScheduleOpen(options.kind, event)
    },
    onPointerLeave: props.onScheduleClose,
  }, h('button', {
    ref: (node: HTMLButtonElement | null): void => {
      if (open === options.kind) props.onTriggerRef(options.kind, node)
    },
    type: 'button',
    className: 'dsr-rail-btn',
    'aria-label': options.label,
    'aria-current': options.current === true ? 'page' : undefined,
    'data-dsr-open': open === options.kind ? 'true' : undefined,
    'aria-haspopup': 'dialog',
    'aria-expanded': open === options.kind ? 'true' : undefined,
    onFocus: (event: React.FocusEvent<HTMLButtonElement>) => {
      props.onTriggerRef(options.kind, event.currentTarget)
      props.onScheduleOpen(options.kind, event)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowRight') return
      event.preventDefault()
      props.onScheduleOpen(options.kind, event)
      // 停留计时器还没触发时面板可能还不存在。
      window.setTimeout(props.onFocusFlyout, OPEN_DELAY_MS + 40)
    },
    onClick: () => {
      props.onRetract()
      if (options.kind === 'workspace' || options.kind === 'more') props.onToggleSidebar()
      else props.onSelectPanel(options.kind === 'tasks' ? 'schedules' : 'plugins')
    },
  }, options.icon))

  const railNav = h('nav', { className: 'dsr-rail', 'aria-label': t('rail.label') },
    h('div', { className: 'dsr-rail-top' },
      railEntry({ kind: 'workspace', label: t('rail.workspace'), icon: h(IconWorkspace, { size: 20 }) }),
      railEntry({
        kind: 'tasks',
        label: t('rail.tasks'),
        icon: h(IconTasks, { size: 20 }),
        current: props.activePanelId === 'schedules',
      }),
      railEntry({
        kind: 'plugins',
        label: t('rail.plugins'),
        icon: h(IconPlugins, { size: 20 }),
        current: props.activePanelId === 'plugins',
      }),
      railEntry({ kind: 'more', label: t('rail.more'), icon: h(IconMore, { size: 20 }) })),
    h('div', { className: 'dsr-rail-spacer' }),
    h('div', {
      onPointerEnter: (event: React.PointerEvent<HTMLDivElement>) => {
        props.onScheduleOpen('account', event)
      },
      onPointerLeave: props.onScheduleClose,
    }, h('button', {
      type: 'button',
      className: 'dsr-rail-btn',
      'aria-label': t('rail.account'),
      'data-dsr-open': open === 'account' ? 'true' : undefined,
      onFocus: (event: React.FocusEvent<HTMLButtonElement>) => {
        props.onScheduleOpen('account', event)
      },
      onClick: () => {
        props.onRetract()
        props.onToggleSidebar()
      },
    }, h(AccountAvatar, { seat: props.accountSeat }))))
  // 两个 portal：接指针的细边缘条，以及滑到它上面的图标轨。正是那条边缘条
  // 让隐藏的轨可被发现，同时不盖住会话标签。
  return createPortal(h('div', null,
    // 边缘条只负责唤出。它刻意没有 pointerleave：图标轨会滑到它上面，
    // 从边缘条离开的处理在轨一出现时就触发，于是两个状态来回振荡。
    // 收起改由指针位置决定（RailColumn 的 effect）。
    h('div', {
      className: 'dsr-rail-hotzone',
      // 刻意不绑 pointerenter：窗口边缘跨屏时它会带一个被钳进视口的坐标，
      // 无法区分「真的进入左缘」与「从右缘移出」。唤出统一由 RailColumn 的
      // document 级 pointermove 连续判定驱动。保留这个元素是为了让热区仍有
      // 命中面积（-webkit-app-region:no-drag）与可发现的边缘条。
    }),
    h('div', {
      // 轨根元素：与浮层 portal 并列，焦点跨两者时需要它来反查。
      ref: props.railRootRef,
      className: 'dsr-rail-float',
      'data-dsr-revealed': props.revealed === true ? 'true' : undefined,
      onPointerEnter: () => {
        // 轨已展开，无需唤出；进入只用于取消待收起。
        props.onCancelRetract()
      },
      // 离开图标轨会收起它，但延迟一小段时间，这样只是掠过边缘的指针
      // 不会让它闪烁。唤出条没有自己的离开处理，这正是两个状态不会互相追逐的原因。
      onPointerLeave: () => {
        if (open === null) props.onScheduleRetract()
      },
      onPointerMove: props.onCancelRetract,
      // 键盘路径：不带坐标，revealRail 因此不做热区判定、直接放行。
      onFocusCapture: () => {
        props.onReveal()
      },
      // 焦点真的离开了「轨 + 浮层」才收起。不能用 contains(relatedTarget)：
      // 浮层是另一个 portal，焦点从轨走进浮层时 relatedTarget 在浮层里、
      // 不在 currentTarget 子树内，会被误判成「离开」；而一旦放行，焦点
      // 之后再从浮层 Tab 出去就没有任何人接住，轨和浮层会一起留在屏幕上。
      // 因此改为在冒泡结束后反查 activeElement。
      onBlurCapture: () => {
        // React 的 blur 冒泡发生在焦点已切换之后，activeElement 已更新；
        // 排到下一个宏任务再查，避免与同一轮里的 focus 处理赛跑。
        window.setTimeout(() => {
          if (props.onFocusLeave()) return
          props.onBlurCollapse()
          if (open !== null) props.onDismissFlyout()
        }, 0)
      },
    }, railNav, props.flyout)), document.body)
}