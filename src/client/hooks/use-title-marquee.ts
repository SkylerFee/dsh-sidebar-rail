/**
 * 会话标题溢出时的滚动显示（marquee）。
 *
 * 照抄宿主 `ui-workspace` 的 `useTitleMarquee`（`rows/Rows.tsx`）：
 * 指针停在行上时，标题以恒定速度滚到末端，停在末端；离开时一步回到起点。
 * 「减少动态效果」时直接跳到末端而不逐帧滚动。
 *
 * 为什么离开要「一步回到起点」而不是反向滚回：静止态有省略号、格子也更窄，
 * 反向滚回途中文字会与省略号撞在一起。
 *
 * 与宿主的一处差异：宿主把 `data-scrolled` / `data-clipped` 写在标题元素上，
 * 由样式表据此加两端渐隐遮罩；本插件同样如此，两个属性名保持一致，
 * 便于对照。
 */
import { useCallback, useEffect, useRef } from 'react'
import { TITLE_MARQUEE_PX_PER_MS } from '../model/constants.ts'
import { shouldMarqueeTitle, titleMarqueeFrame, titleScrollRange } from '../model/formatting.ts'

/** 行上可用的 marquee 控制器。 */
export interface TitleMarquee {
  /** 指针移进行：够宽就滚。 */
  readonly enter: () => void
  /** 指针离开行：回到起点并清掉两端渐隐。 */
  readonly leave: () => void
  /** 绑定到标题元素上的 ref。 */
  readonly titleRef: { current: HTMLSpanElement | null }
}

/**
 * 把标题滚到某个位置，并同步两端的渐隐标记。
 *
 * 直接赋值 `scrollLeft` 而不是 `scrollTo({behavior})`：这是逐帧脚本控制的位置，
 * 任何平滑行为都会与下一帧打架。测试环境没有布局引擎时 `scrollLeft` 恒为 0，
 * 但标记仍会按纯函数的结论设置，因此判定逻辑可被单测覆盖。
 * @param element - 标题元素。
 * @param offset - 期望偏移，会被夹紧。
 * @param range - 最大可滚动距离。
 */
function placeTitle(element: HTMLSpanElement, offset: number, range: number): void {
  const frame = titleMarqueeFrame(offset, range)
  element.scrollLeft = frame.left
  if (frame.fadeStart) element.dataset['scrolled'] = ''
  else delete element.dataset['scrolled']
  if (frame.fadeEnd) element.dataset['clipped'] = ''
  else delete element.dataset['clipped']
}

/**
 * 把标题恢复成静止态：回到起点、两端渐隐都关掉，于是静止的省略号正常显示。
 * @param element - 标题元素。
 */
function restTitle(element: HTMLSpanElement): void {
  element.scrollLeft = 0
  delete element.dataset['scrolled']
  delete element.dataset['clipped']
}

/**
 * 会话标题的滚动显示控制器。
 *
 * 只在指针停留时滚动，触屏点按不触发（宿主同样如此）：触屏没有「悬停」这个
 * 持续状态，动起来反而像故障。
 * @returns 进入 / 离开处理函数与要绑到标题上的 ref。
 */
export function useTitleMarquee(): TitleMarquee {
  const titleRef = useRef<HTMLSpanElement | null>(null)
  const frameRef = useRef(0)
  const runningRef = useRef(false)

  // 卸载时停掉还没跑完的帧，避免回调打到已卸载的节点上。
  useEffect(() => {
    return () => {
      if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  const leave = useCallback(() => {
    runningRef.current = false
    if (frameRef.current !== 0) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
    const element = titleRef.current
    if (element !== null) restTitle(element)
  }, [])

  const enter = useCallback(() => {
    const element = titleRef.current
    if (element === null) return
    if (runningRef.current) return
    const range = titleScrollRange(element.scrollWidth, element.clientWidth)
    if (!shouldMarqueeTitle(range)) return
    runningRef.current = true
    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      // 减少动态效果：直接给到末端，不逐帧移动。
      placeTitle(element, range, range)
      return
    }
    if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current)
    let previous: number | undefined
    let position = 0
    const step = (now: number): void => {
      // 首帧没有上一帧时间，只记录不前进，否则第一帧会跳一大段。
      position += previous === undefined ? 0 : (now - previous) * TITLE_MARQUEE_PX_PER_MS
      previous = now
      placeTitle(element, Math.min(position, range), range)
      if (position < range) frameRef.current = requestAnimationFrame(step)
      else frameRef.current = 0
    }
    frameRef.current = requestAnimationFrame(step)
  }, [])

  return { enter, leave, titleRef }
}
