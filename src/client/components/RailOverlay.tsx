/**
 * `shell.overlay` 的入口组件：只在需要图标轨的状态下渲染它。
 *
 * 是否接管**由宿主折叠列的实际宽度决定，不按平台名**：宿主把折叠列算成
 * `drawer || darwin || windowsTitlebar ? 0 : SIDEBAR_COLLAPSED`——归零的平台
 * （macOS / Windows Desktop）折叠后没有任何轨可点，正是本插件要补的洞；
 * 仍保留 56px 的平台（Linux Desktop、Web）宿主自己画着一条轨，本入口必须保持
 * 为空，否则会叠成双轨。判定见 `shouldRenderRail`。
 */
import type { ReactNode } from 'react'
import { h } from '../jsx.ts'
import { useHostCollapsed, useHostSidebarWidth, useViewportWidth } from '../hooks/use-rail-visibility.ts'
import { shouldRenderRail } from '../model/formatting.ts'
import { RailColumn } from './RailColumn.tsx'
import type { RailColumnProps } from '../contracts.ts'

/**
 * 覆盖层入口。
 * @param props - 转发给图标轨的 overlay 条目 props。
 * @returns 图标轨；在 Desktop 折叠态之外返回 null。
 */
export function RailOverlay(props: RailColumnProps): ReactNode {
  const collapsed = useHostCollapsed()
  const viewportWidth = useViewportWidth()
  const sidebarWidth = useHostSidebarWidth(collapsed)
  if (!shouldRenderRail(collapsed, sidebarWidth, viewportWidth)) return null
  return h(RailColumn, props)
}