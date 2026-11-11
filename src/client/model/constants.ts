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

/**
 * 列表分页的基础水位：一屏默认显示多少条非空白会话。
 *
 * 0.5.1 起不再是用户偏好（可调的 `recentCount` 已整项移除，spec §4）：它是
 * 「显示更多」每次累加的步长，也是自动提升的下限。照抄宿主
 * `SESSION_WATERMARK_BASE`。
 */
export const PAGE_SIZE = 10

/**
 * 自动提升水位的上限，照抄宿主 `SESSION_WATERMARK_AUTO_MAX`。
 *
 * 只有落在这个序号之内的会话才能把水位自动顶高；再往后就只剩「显示更多」。
 */
export const PAGE_SIZE_AUTO_MAX = 50

/** 最近会话区在水位表里的固定键（项目列表用自己的工作区 id 作键）。 */
export const RECENT_LIST_KEY = 'recent'

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
/**
 * 标题溢出多少像素以上才滚动显示。
 *
 * 溢出这么少时尾部没有实质内容被藏住，为几像素动起来只会像抖动，不像揭示。
 * 照抄宿主 `MIN_TITLE_REVEAL_PX`。
 */
export const MIN_TITLE_REVEAL_PX = 8

/**
 * 标题滚动的速度（CSS 像素 / 毫秒）。
 *
 * 慢到能边移边读。照抄宿主 `TITLE_MARQUEE_PX_PER_MS`。
 */
export const TITLE_MARQUEE_PX_PER_MS = 0.03
/**
 * 热区坐标判定的容差（CSS 像素）。
 *
 * 指针移向热区时，最后一条 `pointerover` 的 x 可能已经略过 12px 边界，而
 * 手指/触控板的落点精度也在几像素量级；留一点余量，避免「明明到了左缘却不
 * 唤出」。取值远小于右缘到左缘的距离，因此不会把右侧的误报重新放进来。
 */
export const POINTER_HOTZONE_SLACK = 4
