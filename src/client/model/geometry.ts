/**
 * 几何计算：浮层高度、浮层定位、分区展开判据与图标轨唤出判据。
 *
 * 全是纯函数，便于单测；这些数字直接对应真机验收项（B4 的高度不随内容变化）。
 * 宿主 chrome 带高度从调用方传入，模块本身不读 DOM。
 *
 * 0.5.0 起不再有「分区限高」：浮层内容是单一滚动容器，分区只是分组
 * （见 docs/adr/0007-single-scroll-flyout.md），所以 sectionMaxHeight /
 * sectionBudgetFor 与 SECTION_HEIGHT_RATIO 一并删除。
 */
import {
  FLYOUT_CHROME_HEIGHT,
  FLYOUT_EDGE_GAP,
  FRAME_TOP_CLEARANCE_FALLBACK,
  POINTER_HOTZONE_SLACK,
  RAIL_REVEAL_WIDTH,
} from './constants.ts'
import type { FoldedSections } from './types.ts'

/**
 * 浮层锚点。
 *
 * 语义是「图标轨的位置」，**不是**「某个按钮此刻的矩形」：`right` 恒为轨展开后的
 * 右缘（左缘 0 + `RAIL_REVEAL_WIDTH`），只有 `top` / `bottom` 随垂直位置变化。
 */
export interface FlyoutAnchor {
  readonly top: number
  readonly bottom: number
  /** 图标轨右缘的固定 x 坐标；浮层摆在它右侧。只做定位计算时可以不提供。 */
  readonly right?: number | undefined
}

/**
 * 触发按钮矩形里本模块读取的部分。
 *
 * `right` **存在但被刻意忽略**：轨的露出动画让它不可信（见 `flyoutAnchorFrom`）。
 * 保留该字段是为了让 DOMRect 结构兼容，并让「忽略它」这件事在类型上可见。
 */
export interface TriggerRectLike {
  readonly top?: number | undefined
  readonly bottom?: number | undefined
  readonly right?: number | undefined
}

/**
 * 浮层默认锚点：拿不到按钮矩形时的兜底。
 *
 * 垂直值只是「第一排图标附近」的保守估计；`right` 是轨展开后的右缘。
 */
export const DEFAULT_FLYOUT_ANCHOR: FlyoutAnchor = {
  top: 12,
  bottom: 44,
  right: RAIL_REVEAL_WIDTH,
}

/** 浮层定位结果：上边或下边贴齐，以及可用的最大高度。 */
export interface FlyoutPlacement {
  readonly top?: number
  readonly bottom?: number
  readonly maxHeight: number
}

/**
 * 从触发按钮的矩形推出浮层锚点，水平方向**只用轨的固定几何**。
 *
 * 为什么不能读矩形里的 `right`（spec-0.5.0 §4.5.1 决策 3）：图标轨默认
 * `transform: translateX(-100%)`，露出时用 160ms 过渡滑到 `translateX(0)`，
 * 而浮层在悬停 120ms 后就打开。打开瞬间量到的矩形反映的是**过渡中途**的位置，
 * 左侧还在窗口外，`right` 因而偏小，浮层被摆得偏左；即便改到计时器回调里
 * 再量，结果也只是「另一个中途位置」，依赖动画时序。这还顺带影响「轨正在
 * 收回时打开浮层」的同一条路径。
 *
 * 锚点的语义本就是「轨在哪」，不是「按钮此刻在哪」，所以水平基准取常量：
 * 左缘 0、右缘 `RAIL_REVEAL_WIDTH`。垂直位置仍取自矩形——它不受水平滑动
 * 影响，且保留它浮层才能与按钮垂直对齐。
 * @param rect - 触发按钮的矩形；缺失或字段非法时逐项退回默认锚点。
 * @returns 可直接交给 `flyoutPlacement` 与外壳定位的锚点。
 */
export function flyoutAnchorFrom(rect: TriggerRectLike | null | undefined): FlyoutAnchor {
  const top = typeof rect?.top === 'number' && Number.isFinite(rect.top) ? rect.top : DEFAULT_FLYOUT_ANCHOR.top
  const bottom = typeof rect?.bottom === 'number' && Number.isFinite(rect.bottom)
    ? rect.bottom
    : DEFAULT_FLYOUT_ANCHOR.bottom
  return { top, bottom, right: RAIL_REVEAL_WIDTH }
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
/**
 * 指针是否落在左侧热区里。
 *
 * **不能只靠 pointerenter 判断「进入了左缘」。** 那个事件由 React 从冒泡的
 * `pointerover` 合成，而窗口边缘跨屏时 Chromium 上报的坐标并不可信：
 *
 * - DSH 右边框贴着屏幕右缘、右侧还有另一块屏时，指针从 DSH 右缘移出去，
 *   Chromium 仍会派发 pointerover，且 `relatedTarget` 变成 null；React 于是
 *   合成一次「进入了热区」。实测这次事件带的 `clientX` 会落到热区范围内
 *   （视口外的坐标被钳到边界），因此**连坐标门禁都拦不住**。
 * - 结论：判据必须来自连续移动的 `pointermove`，它在指针真实位于窗口内时
 *   给的坐标才可信。
 *
 * 判定用 `clientX`：它相对视口左上角，与是否全屏、是否有副屏无关；
 * `screenX` 在多屏下是全局坐标，反而会误判。
 * @param x - 指针的 client 坐标 x；非有限值时按「不在热区」处理。
 * @param hotzoneWidth - 左侧热区宽度。
 * @returns 指针是否真的在左缘热区内。
 */
export function pointerInHotzone(x: number, hotzoneWidth: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(hotzoneWidth)) return false
  if (hotzoneWidth <= 0) return false
  return x >= 0 && x <= hotzoneWidth + POINTER_HOTZONE_SLACK
}