/**
 * dsh-sidebar-rail 的共享常量。
 *
 * 这些值原先散落在 `client.js` 的 pure-helpers 区里；迁移后集中在此，
 * 让 model 层与组件层读到同一份数字，不复制多份。
 */

/** 本插件拥有的 locale 命名空间（不得与宿主命名空间冲突）。 */
export const NS = 'sidebarRail'

/** 本插件唯一的 localStorage 键。 */
export const STORE_KEY = 'dsh.sidebar-rail.v1'

/** 浮层打开前的悬停停留时长。 */
export const OPEN_DELAY_MS = 120

/** 指针跨过间隙时，浮层关闭前的宽限时长。 */
export const CLOSE_DELAY_MS = 200

/**
 * 仍能放下图标轨与可读主列的最窄视口。
 * 680（宿主内容下限）+ 56（轨宽）+ 32（两侧留白）。
 */
export const RAIL_MIN_VIEWPORT = 768

/**
 * 可选远程调用的超时上限。
 *
 * 挂起的 Host 调用必须以失败态收场，不能停在永远「加载中」。
 */
export const REMOTE_TIMEOUT_MS = 5000

/** 最近会话行数的硬上限。 */
export const RECENT_LIMIT = 20

/** `recentCount` 偏好的默认值：浮层显示多少最近会话行。 */
export const DEFAULT_RECENT_COUNT = 5

/** 偏好允许的下界；设置输入框按此范围夹取。 */
export const MIN_RECENT_COUNT = 1

/** 偏好允许的上界。 */
export const MAX_RECENT_COUNT = RECENT_LIMIT

/** 浮层与窗口边缘之间保留的间隙。 */
export const FLYOUT_EDGE_GAP = 12

/** 预算空间时为浮层 head 与 foot 预留的高度。 */
export const FLYOUT_CHROME_HEIGHT = 96

/**
 * 窗口 chrome 带的后备高度。
 *
 * 真实值来自 `--dsh-frame-top-clearance`（macOS Desktop 为 48px，声明在根元素上，
 * 于是 portal 出去的浮层能继承）。该常量只在计算样式读不到时兜底，让缺失的 token
 * 退化成「待在红绿灯之下」，而不是「画到它们上面」。
 */
export const FRAME_TOP_CLEARANCE_FALLBACK = 48

/** 唤出图标轨的边缘热区宽度。 */
export const RAIL_HOTZONE_WIDTH = 12

/** 图标轨展开后占用的宽度（与 `.dsr-rail-float` 一致）。 */
export const RAIL_REVEAL_WIDTH = 56

/** 指针离开后图标轨收起前的宽限时长。 */
export const RETRACT_DELAY_MS = 180

/**
 * 宿主以 `warning` 绘制的待交互类型。
 *
 * `ui-workspace/tree.ts#visiblePendingKind` 只白名单这三个键；其余已声明的领域键
 * 在那里与导航无关，本轨也不应为它们变琥珀色。
 */
export const VISIBLE_PENDING_KINDS: ReadonlySet<string> = new Set([
  'approval',
  'plan-review',
  'question',
])
