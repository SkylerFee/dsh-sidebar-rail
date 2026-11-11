/**
 * 浮层外壳：定位、固定高度、分区容器与焦点/关闭行为。
 *
 * 高度**必须**由这里算出并钉住，而不是贴内容收缩：分区化之后，面板高度绝不能
 * 随条目多少变化，否则步进最近会话条数就会改变面板高度（0.3.2 修掉的缺陷，
 * 不得回退）。
 */
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { h } from '../jsx.ts'
import {
  flyoutPlacement,
  flyoutSectionedHeight,
} from '../model/geometry.ts'
import type { FlyoutAnchor } from '../model/geometry.ts'
import { RAIL_REVEAL_WIDTH } from '../model/constants.ts'

/** 浮层外壳的构造参数。 */
export interface FlyoutShellOptions {
  /** 浮层标题（同时作为 aria-label）。 */
  readonly title: string
  /** 面板内容；`sections` 为真时是分区列表。 */
  readonly body: ReactNode
  /** 可选的固定底栏。 */
  readonly foot?: ReactNode
  /** 账号座位为真，此时底边对齐。 */
  readonly bottomAligned?: boolean
  /** 占用的像素高度；留空则贴合内容。 */
  readonly fixedHeight?: number | undefined
  /** 为真时把 body 渲染成独立分区容器。 */
  readonly sections?: boolean
  /** 为真时从 chrome 带下沿起，而不是锚点下方。 */
  readonly topFlush?: boolean
  /** 图标按钮的视口位置。 */
  readonly anchor: FlyoutAnchor
  /** `window.innerHeight`。 */
  readonly viewportHeight: number
  /** chrome 带高度（只在 `topFlush` 时使用）。 */
  readonly topClearance: number
  /** 指针进入面板。 */
  readonly onPointerEnter: () => void
  /** 指针离开面板。 */
  readonly onPointerLeave: () => void
  /** Escape 处理：收起并回焦触发按钮。 */
  readonly onEscape: () => void
  /**
   * 面板根元素的 ref。
   *
   * 浮层自己 portal 到 document.body、与轨是两个并列的 portal，所以没有任何
   * 冒泡能把「焦点现在在浮层里」告诉轨。调用方需要这个 ref 去反查
   * `document.activeElement` 是否落在面板内（见 RailColumn 的
   * `focusInsideRailOrFlyout`）。
   */
  readonly panelRef: { current: HTMLDivElement | null }
  /**
   * 焦点是否仍留在「轨 + 浮层」这个整体里。
   *
   * 浮层与轨是并列的 portal，焦点在两者之间移动不会互相冒泡。因此浮层自己
   * 也要判一次：焦点从浮层直接 Tab 到页面别处时，轨根本收不到事件，只有
   * 浮层能发现「我已经不是焦点的所在地了」。
   */
  readonly onFocusLeave: () => boolean
  /** 焦点真的离开整体时收起（含轨）。 */
  readonly onFocusLost: () => void
}

/** 浮层外壳：调用一次画出一个已定位的面板。 */
export type FlyoutShell = (
  title: string,
  body: ReactNode,
  foot?: ReactNode,
  bottomAligned?: boolean,
  fixedHeight?: number | undefined,
  sections?: boolean,
  topFlush?: boolean,
) => ReactNode

/**
 * 构造一个把面板挂到 `document.body` 的浮层外壳函数。
 *
 * 面板高度用内联 `height` 钉住。分区化的面板把 body 放进 `.dsr-sections`，那是
 * 浮层里**唯一**的滚动容器（ADR-0007）：分区只是分组，不再各自限高或独立滚动。
 * @param options - 定位所需的一切与交互回调。
 * @returns 可用于渲染一个浮层的外壳函数。
 */
export function makeFlyoutShell(options: FlyoutShellOptions): FlyoutShell {
  return (title, body, foot, bottomAligned, fixedHeight, sections, topFlush) => {
    const placed = flyoutPlacement(options.anchor, options.viewportHeight, bottomAligned === true)
    // 贴齐面板独占 chrome 带以下的整列，因此锚点推导出的 top 与它的预算都不适用，
    // 适用的是 chrome 带高度。这里只读一次，保证顶部偏移与高度不会互相矛盾。
    const flushTop = topFlush === true ? options.topClearance : undefined
    const panelHeight = topFlush === true
      ? flyoutSectionedHeight(options.viewportHeight, flushTop)
      : fixedHeight
    return createPortal(h('div', {
      ref: options.panelRef,
      className: 'dsr-flyout',
      role: 'dialog',
      'aria-label': title,
      ...(sections === true ? { 'data-dsr-sections': 'true' } : {}),
      style: {
        ...(topFlush === true
          ? { top: `${flushTop ?? 0}px` }
          : placed.top === undefined ? {} : { top: `${placed.top}px` }),
        ...(placed.bottom === undefined ? {} : { bottom: `${placed.bottom}px` }),
        maxHeight: `${topFlush === true ? panelHeight : placed.maxHeight}px`,
        ...(panelHeight === undefined ? {} : { height: `${panelHeight}px` }),
        left: `${(options.anchor.right ?? RAIL_REVEAL_WIDTH) + 8}px`,
      },
      onPointerEnter: options.onPointerEnter,
      onPointerLeave: options.onPointerLeave,
      // 焦点从浮层直接走到页面别处：轨收不到这个事件，只能由浮层自己发现。
      // 排到下一个宏任务再查，让同一轮里的 focus 处理先把 activeElement 定下来。
      onBlurCapture: () => {
        window.setTimeout(() => {
          if (options.onFocusLeave()) return
          options.onFocusLost()
        }, 0)
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        // Escape 把焦点交回触发按钮，于是下一次 Tab 从图标轨继续，
        // 而不是跳到页面顶部。
        if (event.key !== 'Escape') return
        event.stopPropagation()
        options.onEscape()
      },
    },
    h('div', { className: 'dsr-flyout-head' }, title),
    sections === true
      ? h('div', { className: 'dsr-sections' }, body)
      : h('div', { className: 'dsr-flyout-body' }, body),
    foot === undefined ? null : h('div', { className: 'dsr-flyout-foot' }, foot)), document.body)
  }
}