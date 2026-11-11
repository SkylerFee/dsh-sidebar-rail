/**
 * 展示层的纯格式化函数：相对时间、locale 解析、状态标记、路径与偏好夹取。
 *
 * 这些函数原先在 `client.js` 的 pure-helpers 区，迁移后仍不依赖 React 或 DOM，
 * 因此可以被单测直接 import。
 */
import { MIN_TITLE_REVEAL_PX, RAIL_MIN_VIEWPORT, VISIBLE_PENDING_KINDS } from './constants.ts'
import type { SessionMark, SessionStatusLike } from './types.ts'

/**
 * 在读者语言下给出紧凑的相对时间。
 * @param value - epoch 毫秒。
 * @param language - 当前 locale id。
 * @returns 形如「5 分钟前」的短标签；输入不可用时为空白。
 */
export function relativeTime(value: number | undefined, language: string | null | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return ''
  const delta = Date.now() - value
  const minute = 60_000
  const chinese = String(language ?? '').toLowerCase().startsWith('zh')
  if (delta < minute) return chinese ? '刚刚' : 'now'
  if (delta < 60 * minute) {
    const n = Math.floor(delta / minute)
    return chinese ? `${n} 分钟前` : `${n} min ago`
  }
  if (delta < 24 * 60 * minute) {
    const n = Math.floor(delta / (60 * minute))
    return chinese ? `${n} 小时前` : `${n} h ago`
  }
  const n = Math.floor(delta / (24 * 60 * minute))
  return chinese ? `${n} 天前` : `${n} d ago`
}

/**
 * 从宿主 locale 快照里取出当前 locale id。
 *
 * 已发布客户端在 `LocaleSnapshot.active` 上发布当前语言。此前读 `id` / `locale`
 * 的写法（2026-11-04 真机验证之前）总会退回英文，于是中文界面出现 "min ago"。
 * 这里只接受非空字符串，避免畸形快照把整列文案清空；`id` / `locale` 仅作为
 * 合成快照的防御性回退保留。
 * @param snapshot - 宿主 locale 快照，或任何取而代之的输入。
 * @returns locale id，默认 `'en'`。
 */
export function resolveLocaleId(snapshot: unknown): string {
  if (snapshot === null || typeof snapshot !== 'object') return 'en'
  const record = snapshot as Record<string, unknown>
  for (const key of ['active', 'id', 'locale']) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return 'en'
}

/**
 * 判断当前世界状态是否应该画出图标轨。
 *
 * 图标轨浮在主列之上，因此只在视口仍能容下可读中列时才出现（宿主把会话列
 * 下限设为 680px）。更窄时宿主 `shell.leading` 里的重开按钮仍然可用，隐藏
 * 图标轨不会让人失去回到侧栏的入口。
 * @param platform - `document.documentElement.dataset.platform`。
 * @param collapsed - 宿主侧栏是否折叠。
 * @param viewportWidth - 视口宽度（CSS 像素）。
 * @returns 是否渲染图标轨。
 */
export function shouldRenderRail(
  platform: string,
  collapsed: boolean,
  viewportWidth: number | undefined,
): boolean {
  if (platform !== 'darwin' || collapsed !== true) return false
  return typeof viewportWidth === 'number' && Number.isFinite(viewportWidth) && viewportWidth >= RAIL_MIN_VIEWPORT
}

/**
 * 把绝对路径裁到最后两段，用于提示文案。
 * @param path - 规范目录路径。
 * @returns 缩短后的路径。
 */
export function shortPath(path: string | null | undefined): string {
  if (typeof path !== 'string' || path.length === 0) return ''
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`
}

/**
 * 解析一个会话行应显示的状态标记。
 *
 * 复刻宿主 ui-workspace `sessionStatuses` 的优先级：待交互 > 正在运行 >
 * 未读完成 > 空闲。两个宿主细节被逐字复刻而不是近似：
 *   - 只有 `approval` / `plan-review` / `question` 算可见待交互
 *     （`visiblePendingKind`），其他领域键一概忽略，将来新增的键不会让轨悄悄变琥珀色；
 *   - 状态快照没有条目时，`running` 回退到 SessionSummary，与宿主树的解析一致。
 *
 * 运行中的子代理刻意不计入：宿主也把它们算作 ongoing，但那需要
 * `projectionsBySession.subagentCatalog`，本行的投影并不携带。PRD 把该项列为非目标。
 * @param summary - 该行的 SessionSummary（用于 `running` 回退）。
 * @param status - `useSessionStatus` 给出的条目，可能不存在。
 * @returns 四种状态标记之一。
 */
export function sessionStatusOf(
  summary: { readonly running?: boolean | undefined; readonly [extra: string]: unknown } | null | undefined,
  status: SessionStatusLike | null | undefined,
): SessionMark {
  const pending = status?.pendingInteraction
  const pendingKind = pending?.kind
  if (typeof pendingKind === 'string' && VISIBLE_PENDING_KINDS.has(pendingKind)) return 'warning'
  const running = status?.running === undefined ? summary?.running : status.running
  if (running === true) return 'ongoing'
  if (status?.completionUnread === true) return 'done'
  return 'idle'
}
/**
 * 标题需要滚动的距离。
 *
 * `scrollWidth - clientWidth` 就是被裁掉的那一段；非正值表示没溢出。
 * @param scrollWidth - 标题内容的完整宽度。
 * @param clientWidth - 标题可见宽度。
 * @returns 需要滚动的像素数；无溢出时为 0。
 */
export function titleScrollRange(scrollWidth: number, clientWidth: number): number {
  if (!Number.isFinite(scrollWidth) || !Number.isFinite(clientWidth)) return 0
  const range = scrollWidth - clientWidth
  return range > 0 ? range : 0
}

/**
 * 该不该为这个溢出量启动滚动。
 *
 * 溢出不大于 {@link MIN_TITLE_REVEAL_PX} 时保持静止：藏起来的尾部没有实质内容，
 * 为几像素动起来读起来像抖动。阈值与判定照抄宿主 `useTitleMarquee`。
 * @param range - {@link titleScrollRange} 的结果。
 * @returns 值得滚动时为 true。
 */
export function shouldMarqueeTitle(range: number): boolean {
  return Number.isFinite(range) && range > MIN_TITLE_REVEAL_PX
}

/**
 * 求出某一时刻标题应处的滚动位置，以及两端渐隐是否该亮。
 *
 * 纯函数：把宿主 `placeTitle` 里「位置 + 两个 data 属性」的判定抽出来，
 * 好在没有 DOM 的环境里把边界测清楚。
 * @param offset - 期望的滚动偏移（会被夹到 [0, range]）。
 * @param range - 最大可滚动距离。
 * @returns 夹紧后的偏移，以及左端（已离开起点）与右端（仍有内容在外）是否该渐隐。
 */
export function titleMarqueeFrame(
  offset: number,
  range: number,
): { readonly left: number; readonly fadeStart: boolean; readonly fadeEnd: boolean } {
  const safeRange = Number.isFinite(range) && range > 0 ? range : 0
  const wanted = Number.isFinite(offset) ? offset : 0
  const left = wanted <= 0 ? 0 : wanted >= safeRange ? safeRange : wanted
  return {
    left,
    // 左端渐隐：已经离开起点，起点处的字被裁掉了。
    fadeStart: left > 0,
    // 右端渐隐：还没到尽头，右边仍有字在外。
    fadeEnd: left < safeRange,
  }
}
