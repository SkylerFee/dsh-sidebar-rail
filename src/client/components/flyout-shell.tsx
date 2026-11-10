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
  sectionMaxHeight,
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
 * 面板高度用内联 `height` 钉住；分区化的面板跳过常规滚动包装层，因为那一层
 * 一旦存在就会独占滚动，内部各分区便无法独立滚动。
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
        // 所有分区共享的天花板，于是它们都读同一个「可用高度的三分之一」。
        ...(sections === true ? { '--dsr-section-cap': `${sectionMaxHeight(panelHeight)}px` } : {}),
      },
      onPointerEnter: options.onPointerEnter,
      onPointerLeave: options.onPointerLeave,
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