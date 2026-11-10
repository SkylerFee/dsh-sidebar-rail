/**
 * 几何计算：浮层高度、分区上限、浮层定位与图标轨唤出判据。
 *
 * 全是纯函数，便于单测；这些数字直接对应真机验收项（B3 的分区上限、
 * B4 的高度不随内容变化）。宿主 chrome 带高度从调用方传入，模块本身不读 DOM。
 */
import {
  FLYOUT_CHROME_HEIGHT,
  FLYOUT_EDGE_GAP,
  FRAME_TOP_CLEARANCE_FALLBACK,
  SECTION_HEIGHT_RATIO,
} from './constants.ts'
import type { FoldedSections } from './types.ts'

/** 浮层锚点：打开它的图标按钮在视口中的位置。 */
export interface FlyoutAnchor {
  readonly top: number
  readonly bottom: number
  /** 图标轨右缘，用于把浮层摆在它右侧；只做定位计算时可以不提供。 */
  readonly right?: number | undefined
}

/** 浮层定位结果：上边或下边贴齐，以及可用的最大高度。 */
export interface FlyoutPlacement {
  readonly top?: number
  readonly bottom?: number
  readonly maxHeight: number
}

/**
 * 分区浮层应占的高度：窗口 chrome 带之下到底边的全部空间。
 *
 * 0.3.x 用视口比例定高，分区化之后上下都会留出空隙。0.4.0 把浮层顶边钉在
 * `--dsh-frame-top-clearance`（承载 macOS 红绿灯与宿主重开按钮的那 48px）之下，
 * 底边贴住窗口底。**刻意不按内容推导**：条数变化、条目增减、分区收起都不能
 * 改变面板高度——这正是「算出来」而不是「撑出来」的原因。
 * @param viewportHeight - `window.innerHeight`。
 * @param topClearance - 需避开的 chrome 带高度。取不到时回退到文档里的 48px
 *   而不是 0：盖住红绿灯比少用 48px 更糟。
 * @returns 像素高度，不为负、不为 NaN。
 */
export function flyoutSectionedHeight(
  viewportHeight: number | undefined,
  topClearance: number | undefined,
): number {
  const viewport = typeof viewportHeight === 'number' && Number.isFinite(viewportHeight) && viewportHeight > 0
    ? viewportHeight : 0
  if (viewport === 0) return 0
  const clearance = typeof topClearance === 'number' && Number.isFinite(topClearance) && topClearance > 0
    ? topClearance : FRAME_TOP_CLEARANCE_FALLBACK
  return Math.max(0, Math.round(viewport - clearance))
}

/**
 * 单个分区在开始自身滚动前可占的最大高度。
 *
 * 取可用高度的三分之一并向下取整，保证三个满额分区加起来不超过可用空间。
 * 调用方仍通过 flex 与分区自身内容高度取 min：这是**上限**，不是目标值
 * ——内容少的分区保持自然高度，不强行撑满。
 * @param availableHeight - 浮层体可用的高度。
 * @returns 像素上限，不为负、不为 NaN。
 */
export function sectionMaxHeight(availableHeight: number | undefined): number {
  const available = typeof availableHeight === 'number' && Number.isFinite(availableHeight) && availableHeight > 0
    ? availableHeight : 0
  if (available === 0) return 0
  return Math.floor(available * SECTION_HEIGHT_RATIO)
}

/**
 * 求分区高度上限所依据的「可用预算」。
 *
 * 浮层可用高度减去面板自身 head + foot 的预留，就是里面所有分区能瓜分的空间。
 * 这个值必须由这里算出并可单测，而不是散在渲染闭包里：B3 的「每区不超过可用
 * 高度三分之一」直接依赖它，一旦算错，真机上表现为某个分区撑满整块面板。
 *
 * 真机实测对照（macOS Desktop，外接屏 1920×1080，渲染进程 innerHeight 1092）：
 * `1092 − 48 − 96 = 948`，取三分之一得 316px，与实测 sections 容器 949px
 * 的三分之一完全吻合。
 * @param viewportHeight - `window.innerHeight`。
 * @param topClearance - 顶部 chrome 带高度，通常来自 `--dsh-frame-top-clearance`。
 * @param chromeHeight - 面板 head 与 foot 占掉的预留高度。
 * @returns 像素预算，不为负、不为 NaN。
 */
export function sectionBudgetFor(
  viewportHeight: number | undefined,
  topClearance: number | undefined,
  chromeHeight: number | undefined,
): number {
  const panel = flyoutSectionedHeight(viewportHeight, topClearance)
  if (panel === 0) return 0
  const chrome = typeof chromeHeight === 'number' && Number.isFinite(chromeHeight) && chromeHeight > 0
    ? chromeHeight : 0
  return Math.max(0, panel - chrome)
}

/**
 * 判断某个分区是否以展开态渲染。
 *
 * 默认值由 spec 规定：工作区浮层三区全展开，任务浮层只展开「进行中」，
 * 插件浮层两区都展开。用户手动收起的结果覆盖默认值；展开状态不落盘，
 * 所以每次打开浮层都从 `defaultOpen` 开始。
 * @param folded - 分区 id → 是否已收起 的映射（组件 state）。
 * @param id - 分区 id，已按浮层命名空间化。
 * @param defaultOpen - spec 规定的默认展开态。
 * @returns 该分区的内容区是否应渲染。
 */
export function sectionIsOpen(
  folded: FoldedSections | null | undefined,
  id: string,
  defaultOpen: boolean,
): boolean {
  const entry = folded === null || folded === undefined ? undefined : folded[id]
  if (typeof entry === 'boolean') return entry !== true
  return defaultOpen === true
}

/**
 * 把浮层摆到锚点旁，同时不许它越出窗口。
 *
 * 固定的 `max-height: calc(100vh - 32px)` 忽略浮层自身偏移：窗口较矮时面板从
 * 中途开始却仍声称占用大部分视口，底边（连同最近会话的底栏）就落到窗口外。
 * 这里的预算取锚点之下真正剩下的空间。
 * @param anchor - 打开浮层的图标按钮的 `{ top, bottom }`。
 * @param viewportHeight - `window.innerHeight`。
 * @param bottomAligned - 账号座位为真，此时底边贴齐。
 * @returns 上边或下边偏移，加上面板可用的最大高度。
 */
export function flyoutPlacement(
  anchor: FlyoutAnchor,
  viewportHeight: number,
  bottomAligned: boolean,
): FlyoutPlacement {
  // 留在窗口内优先于「舒适的最小高度」：贴着底边还坚持 FLYOUT_CHROME_HEIGHT
  // 的面板，正是这里要挡住的溢出。
  const budget = (offset: number): number => Math.max(0, Math.min(
    Math.max(viewportHeight - offset - FLYOUT_EDGE_GAP, 0),
    Math.max(FLYOUT_CHROME_HEIGHT, viewportHeight - offset - FLYOUT_EDGE_GAP),
  ))
  if (bottomAligned === true) {
    // 座位在底部：把面板底边钉在它上面，让面板在剩余空间里向上生长。
    const bottom = Math.max(FLYOUT_EDGE_GAP, viewportHeight - anchor.bottom)
    return { bottom, maxHeight: budget(bottom) }
  }
  const top = Math.max(FLYOUT_EDGE_GAP, anchor.top)
  return { top, maxHeight: budget(top) }
}

/**
 * 指针是否仍停在那片让图标轨保持展开的区域里。
 *
 * 元素级 `pointerleave` 回答不了这个问题：图标轨滑到边缘热区之上，热区立刻收到
 * `pointerleave`，收起后又重新露出它——两者来回振荡。改为按指针 x 与展开宽度
 * 比较，谁在最上层都不影响判定。
 * @param x - 指针的 client 坐标 x。
 * @param railWidth - 图标轨展开后占用的宽度。
 * @returns 指针是否应让图标轨保持可见。
 */
export function keepsRailRevealed(x: number, railWidth: number): boolean {
  if (!Number.isFinite(x)) return false
  const width = Number.isFinite(railWidth) && railWidth > 0 ? railWidth : 56
  return x >= 0 && x <= width
}