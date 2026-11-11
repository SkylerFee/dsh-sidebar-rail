/**
 * 图标轨的宿主环境钩子：折叠状态与视口宽度。
 *
 * 两者都是「读宿主发布的事实」，不写宿主、不持久化。
 */
import { useEffect, useState } from 'react'
import { FRAME_TOP_CLEARANCE_FALLBACK } from '../model/constants.ts'

/**
 * 读取宿主左列当前是否折叠。
 *
 * 图标轨挂在整帧的 `shell.overlay` 座位上，该座位的条目收不到 owner props，
 * 因此折叠状态取自宿主发布在帧元素上的属性（`data-sidebar-collapsed`）。帧元素
 * 经 overlay 层稳定的 `data-shell-overlay` 标记定位，而不是易变的 CSS Module 哈希类名。
 * 观察是属性级的，因此窗口缩放或无关的重渲染都唤不醒该组件。
 * @returns 宿主侧栏折叠时为 true。
 */
export function useHostCollapsed(): boolean {
  const read = (): boolean => {
    if (typeof document === 'undefined') return false
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement ?? null
    return frame !== null && frame.hasAttribute('data-sidebar-collapsed')
  }
  const [collapsed, setCollapsed] = useState(read)
  useEffect(() => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement ?? null
    if (frame === null) return undefined
    setCollapsed(frame.hasAttribute('data-sidebar-collapsed'))
    const observer = new MutationObserver(() => {
      setCollapsed(frame.hasAttribute('data-sidebar-collapsed'))
    })
    observer.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
    return () => {
      observer.disconnect()
    }
  }, [])
  return collapsed
}

/**
 * 跟踪视口宽度，让图标轨在窄窗口下退出。
 *
 * 这里用 resize 监听而不是 ResizeObserver：判据取决于窗口，而不是插件拥有的
 * 任何元素，而且图标轨在阈值处会卸载，根本没有盒子可观察。
 * @returns 当前视口宽度（CSS 像素）。
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth))
  useEffect(() => {
    const update = (): void => {
      setWidth(window.innerWidth)
    }
    update()
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
    }
  }, [])
  return width
}

/**
 * 读取宿主根元素上声明的窗口 chrome 带高度。
 *
 * 宿主在根元素上声明 `--dsh-frame-top-clearance`（macOS Desktop 为 48px），
 * portal 出去的浮层会继承它。渲染时读取，让宿主日后调整不必等插件发版；
 * 读不到时退回文档规定的 48px——盖住红绿灯比少用 48px 更糟。
 * @returns chrome 带的像素高度。
 */
export function readFrameTopClearance(): number {
  try {
    const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-top-clearance')
    const parsed = Number.parseFloat(raw)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  } catch (error) {
    // 读样式失败不能让面板失去位置：落到文档规定的默认值，
    // 而不是在没有顶部偏移的情况下渲染。
    console.warn('[dsh-sidebar-rail] frame clearance unreadable', error)
  }
  return FRAME_TOP_CLEARANCE_FALLBACK
}
/**
 * 读「本窗口是否处于聚焦状态」。
 *
 * 图标轨的唤出条贴在窗口左缘，而 macOS 上指针移进一个**未聚焦**的窗口时，
 * 浏览器依旧会派发 `pointerenter`——于是切到别的应用后，只要指针扫过那条
 * 12px 热区，本插件的轨就会滑出来，而人根本没打算用它。
 *
 * `document.hasFocus()` 正是「这个文档是否拥有键盘焦点」的权威答案：窗口
 * 失去焦点时它变 false。除了 focus / blur，还要听 `visibilitychange`——
 * 切到别的 Space 或最小化时 focus 事件不保证到达。
 * @returns 文档当前持有焦点时为 true。
 */
export function useWindowFocused(): boolean {
  /** 读一次权威答案；没有 document 时按「未聚焦」处理，宁可不唤出。 */
  const read = (): boolean => {
    if (typeof document === 'undefined') return false
    return document.hasFocus()
  }
  const [focused, setFocused] = useState(read)
  useEffect(() => {
    /** 把焦点状态同步进 React。 */
    const update = (): void => {
      setFocused(read())
    }
    update()
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return focused
}
