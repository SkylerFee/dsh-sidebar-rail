/**
 * `shell.overlay` 的入口组件：只在需要图标轨的状态下渲染它。
 *
 * Desktop（macOS 与 Windows）把折叠列压到零宽并裁掉
 * （`AppFrame: collapsedWidth = drawer || darwin || windowsTitlebar ? 0 : 56`），
 * 所以已发布构建在那里没有任何轨——这正是本插件要补的洞。Web 已经自己画
 * 56px 轨，因此本入口在 Web 上保持为空，绝不重复画一条。
 * 平台白名单见 `platformNeedsRail`。
 */
import type { ReactNode } from 'react'
import { h } from '../jsx.ts'
import { useHostCollapsed, useViewportWidth } from '../hooks/use-rail-visibility.ts'
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
  const platform = typeof document === 'undefined' ? '' : (document.documentElement.dataset['platform'] ?? '')
  if (!shouldRenderRail(platform, collapsed, viewportWidth)) return null
  return h(RailColumn, props)
}