/**
 * 共享的展示原语：图标、行、分区、头像、状态标记与错误边界。
 *
 * 这些组件只读 props，不直接读宿主 Context；图标是重画的而不是从
 * `@deepseek-ai/dsh-client-ui-primitives` 导入——产物只能 require 宿主提供的
 * react / react-dom，颜色仍取自宿主同名 token，因此两处观感一致。
 */
import { Component, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { h } from '../jsx.ts'
import type { SessionMark } from '../model/types.ts'
import { MAX_RECENT_COUNT, MIN_RECENT_COUNT } from '../model/constants.ts'

/** 图标公共入参：尺寸与子节点（`<path>`、`<circle>` 等）。 */
export interface IconProps {
  readonly size?: number | undefined
  readonly children?: ReactNode
}

/**
 * 共享的描边图标外框。
 * @param props - 尺寸与图形子节点。
 * @returns svg 元素。
 */
export function Icon({ size = 20, children }: IconProps): ReactNode {
  return h('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true, focusable: false,
  }, children)
}

/** 工作区/项目图标。 */
export function IconWorkspace(props: { readonly size?: number | undefined }): ReactNode {
  return h(Icon, props,
    h('path', { d: 'M3 7.5A2 2 0 0 1 5 5.5h3.6a2 2 0 0 1 1.6.8l.9 1.2H19a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }),
    h('path', { d: 'M3 10.5h18' }))
}

/** 定时任务图标。 */
export function IconTasks(props: { readonly size?: number | undefined }): ReactNode {
  return h(Icon, props,
    h('circle', { cx: 12, cy: 12, r: 8.2 }),
    h('path', { d: 'M12 7.6V12l3 1.8' }))
}

/** 插件图标。 */
export function IconPlugins(props: { readonly size?: number | undefined }): ReactNode {
  return h(Icon, props,
    h('path', { d: 'M8.5 4.5v3M15.5 4.5v3' }),
    h('path', { d: 'M6.5 7.5h11v4.2a5.5 5.5 0 0 1-11 0z' }),
    h('path', { d: 'M12 17.4v2.1' }))
}

/** 「更多」三点图标。 */
export function IconMore(props: { readonly size?: number | undefined }): ReactNode {
  return h(Icon, props,
    h('circle', { cx: 6, cy: 12, r: 1.5, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 12, cy: 12, r: 1.5, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 18, cy: 12, r: 1.5, fill: 'currentColor', stroke: 'none' }))
}

/** 「更多」省略号，即宿主对未登录账号座位画的形状。 */
export function IconEllipsis(props: { readonly size?: number | undefined }): ReactNode {
  return h(Icon, props,
    h('circle', { cx: 6, cy: 12, r: 1.4, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 12, cy: 12, r: 1.4, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 18, cy: 12, r: 1.4, fill: 'currentColor', stroke: 'none' }))
}

/** 无头像时的中性人形图标。 */
export function IconUser(props: { readonly size?: number | undefined }): ReactNode {
  return h(Icon, props,
    h('circle', { cx: 12, cy: 8.2, r: 3.4 }),
    h('path', { d: 'M5 19.4c0-3 3.1-5 7-5s7 2 7 5' }))
}

/** 工作区行尾部的小图钉。 */
export function IconPin(): ReactNode {
  return h('svg', {
    viewBox: '0 0 24 24', width: 13, height: 13, fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
  }, h('path', { d: 'M9 4.5h6l-.8 5.2 3.3 3.3v1.5H6.5V13l3.3-3.3z' }), h('path', { d: 'M12 14.5V20' }))
}

/**
 * 项目行「新建会话」的加号。
 *
 * 独立图标而不是文字标签：行很窄，按钮又与图钉并排，标签会把项目名挤出去。
 */
export function IconPlus(): ReactNode {
  return h('svg', {
    viewBox: '0 0 24 24', width: 13, height: 13, fill: 'none', stroke: 'currentColor',
    strokeWidth: 2, strokeLinecap: 'round', 'aria-hidden': true,
  }, h('path', { d: 'M12 5v14M5 12h14' }))
}

/**
 * 可折叠分区标题的展开箭头。
 *
 * 展开时朝下；收起时由分区 CSS 旋转四分之一圈，因此一个图形覆盖两种状态，
 * 折叠过程带过渡。
 */
export function IconChevron(): ReactNode {
  return h('svg', {
    viewBox: '0 0 24 24', width: 10, height: 10, fill: 'none', stroke: 'currentColor',
    strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
  }, h('path', { d: 'M5 9l7 7 7-7' }))
}

/** 一行列表的入参。 */
export interface RowProps {
  readonly title: string
  readonly meta?: string | undefined
  readonly onClick?: (() => void) | undefined
  readonly onTogglePin?: (() => void) | undefined
  readonly pinLabel?: string | undefined
  readonly pinned?: boolean | undefined
  readonly current?: boolean | undefined
  readonly status?: SessionMark | undefined
  readonly statusLabel?: string | undefined
}

/**
 * 一条工作区/会话行，带可选的尾部图钉动作。
 *
 * `current` 标记主视图正在显示的行，用宿主给自己的选中会话行上的同一填充色。
 * 宿主在 treeitem 上用 `aria-selected` 标记该行；这里这些行是普通按钮，
 * 因此等价的可访问性声明是 `aria-current="page"`。
 * @param props - 行内容、点击回调、图钉与当前态。
 * @returns 行元素。
 */
export function Row(props: RowProps): ReactNode {
  const main = h('button', {
    type: 'button',
    className: 'dsr-row',
    // 刻意不写内联背景：它曾压过 CSS 里的 hover / focus-visible / current 规则，
    // 于是没有图钉包装的行永远不显示任何状态。行背景从此归样式表管。
    style: { flex: '1 1 auto', minWidth: 0 },
    'aria-current': props.current === true ? 'page' : undefined,
    'data-dsr-current': props.current === true ? 'true' : undefined,
    onClick: props.onClick,
  },
  h('span', { className: 'dsr-row-main' },
    h('span', { className: 'dsr-row-title' }, props.title),
    props.meta === undefined || props.meta === '' ? null : h('span', { className: 'dsr-row-meta' }, props.meta)),
  props.status === undefined ? null : h(StateMark, { status: props.status, label: props.statusLabel ?? '' }))
  if (props.onTogglePin === undefined) return main
  return h('div', { className: 'dsr-row-wrap', 'data-pinned': props.pinned === true ? 'true' : undefined },
    main,
    h('button', {
      type: 'button',
      className: 'dsr-row-action',
      'aria-label': props.pinLabel,
      title: props.pinLabel,
      onClick: (event: { stopPropagation(): void }) => {
        event.stopPropagation()
        props.onTogglePin?.()
      },
    }, h(IconPin)))
}

/** 项目行的入参。 */
export interface ProjectRowProps {
  readonly title: string
  readonly meta?: string | undefined
  readonly open: boolean
  readonly onToggleOpen: () => void
  readonly pinned: boolean
  readonly pinLabel: string
  readonly onTogglePin: () => void
  readonly newSessionLabel: string
  readonly onNewSession: () => void
  readonly children?: ReactNode
}

/**
 * 一个项目行：展开箭头、名称、图钉、新建会话。
 *
 * **刻意不复用 `Row`**：项目行有三个任何会话行都没有的操作，且展开箭头必须常显
 * （会话行的图钉只在悬停时出现）。并进 `Row` 会让其余每个列表都要做一堆
 * `undefined` 判断。
 *
 * 箭头与名称是同一个按钮：点哪个都收起/展开，符合 disclosure 行的惯例。
 * 图钉与新建会话按钮阻止冒泡，避免顺带把行折起来。
 * @param props - 行内容、展开态与三个回调。
 * @returns 项目行元素。
 */
export function ProjectRow(props: ProjectRowProps): ReactNode {
  return h('div', { className: 'dsr-project-row', 'data-pinned': props.pinned === true ? 'true' : undefined },
    h('div', { className: 'dsr-row-wrap' },
      h('button', {
        type: 'button',
        className: 'dsr-row dsr-project-main',
        style: { flex: '1 1 auto', minWidth: 0 },
        'aria-expanded': props.open === true,
        'data-dsr-project-toggle': props.title,
        onClick: props.onToggleOpen,
      },
      h('span', {
        className: 'dsr-project-caret',
        'data-dsr-open': props.open === true ? 'true' : 'false',
      }, h(IconChevron)),
      h('span', { className: 'dsr-row-main' },
        h('span', { className: 'dsr-row-title' }, props.title),
        props.meta === undefined || props.meta === '' ? null : h('span', { className: 'dsr-row-meta' }, props.meta))),
      h('button', {
        type: 'button',
        className: 'dsr-project-action',
        'aria-label': props.newSessionLabel,
        title: props.newSessionLabel,
        onClick: (event: { stopPropagation(): void }) => {
          event.stopPropagation()
          props.onNewSession()
        },
      }, h(IconPlus)),
      h('button', {
        type: 'button',
        className: 'dsr-project-action',
        'aria-label': props.pinLabel,
        title: props.pinLabel,
        onClick: (event: { stopPropagation(): void }) => {
          event.stopPropagation()
          props.onTogglePin()
        },
      }, h(IconPin))),
    props.open === true
      ? h('div', { className: 'dsr-project-sessions' }, props.children)
      : null)
}

/** 账号座位的入参。 */
export interface AccountAvatarProps {
  readonly seat: { readonly kind: string; readonly avatarUrl?: string | undefined }
}

/**
 * 账号座位头像。
 *
 * 已登录且有图：用宿主自己的头像 URL。否则用宿主的兜底处理——与已发布侧栏同一
 * 字段上的中性人形图标。以前这里放的是「AI」字母组合，读起来像插件有自己的身份，
 * 而不是在展示登录的账号。
 * @param props - 账号资料里的头像 URL（可能没有）。
 * @returns 头像元素。
 */
export function AccountAvatar({ seat }: AccountAvatarProps): ReactNode {
  const [broken, setBroken] = useState(false)
  const kind = seat.kind
  const url = seat.avatarUrl
  const usable = typeof url === 'string' && url !== '' && !broken
  // 未登录不是「没有头像的人」：宿主侧栏会整个丢掉头像槽、改为「更多」省略号。
  // 这里画同一形状，而不是凭空造一张脸。
  const glyph = kind === 'signed-out' ? h(IconEllipsis, { size: 16 }) : h(IconUser, { size: 16 })
  return h('span', { className: 'dsr-avatar', 'data-dsr-seat': kind, 'aria-hidden': true },
    usable
      ? h('img', {
        className: 'dsr-avatar-img',
        src: url,
        alt: '',
        referrerPolicy: 'no-referrer',
        onError: () => setBroken(true),
      })
      : glyph)
}

/** 状态标记的入参。 */
export interface StateMarkProps {
  readonly status: SessionMark
  readonly label: string
}

/**
 * 会话状态标记，画成与宿主 `StateDot` 相同的形状。
 *
 * 图形是重画的而不是导入的：这是静态模块，只能 require react/react-dom，
 * 够不到 `@deepseek-ai/dsh-client-ui-primitives`。颜色取宿主同名 token，
 * 于是两处观感一致：进行中是三级文字色里旋转的环，其余是状态色实心点。
 * @param props - `sessionStatusOf` 给出的状态与可访问标签。
 * @returns 标记元素。
 */
export function StateMark({ status, label }: StateMarkProps): ReactNode {
  if (status === 'idle') return null
  const title = label === '' ? undefined : label
  if (status === 'ongoing') {
    return h('span', { className: 'dsr-dot dsr-dot-ongoing', role: 'img', 'aria-label': label, title },
      h('svg', { viewBox: '0 0 24 24', width: 14, height: 14, 'aria-hidden': true },
        h('circle', { cx: 12, cy: 12, r: 9.5, className: 'dsr-ring-track' }),
        h('circle', { cx: 12, cy: 12, r: 9.5, className: 'dsr-ring-arc' })))
  }
  return h('span', {
    className: `dsr-dot dsr-dot-${status}`,
    role: 'img',
    'aria-label': label,
    title,
  })
}

/** 条数步进器的入参。 */
export interface RecentCountRowProps {
  readonly value: number
  readonly label: string
  readonly onChange: (next: number) => void
  readonly min?: number | undefined
  readonly max?: number | undefined
}

/**
 * 一条紧凑的步进行：最近会话条数偏好。
 *
 * 这是该值能改变的第二处（插件详情页是第一处）；两者写同一个 localStorage 键，
 * 因此图标轨浮层提供的是短路径，而不是自己拥有该设置。
 * @param props - 当前值、标签、变更回调与边界。
 * @returns 步进行元素。
 */
export function RecentCountRow({ value, label, onChange, min, max }: RecentCountRowProps): ReactNode {
  const low = min ?? MIN_RECENT_COUNT
  const high = max ?? MAX_RECENT_COUNT
  const step = (delta: number): void => {
    onChange(value + delta)
  }
  return h('div', { className: 'dsr-stepper' },
    h('span', { className: 'dsr-stepper-label' }, label),
    h('button', {
      type: 'button',
      className: 'dsr-stepper-btn',
      'aria-label': `${label} −`,
      disabled: value <= low,
      onClick: () => step(-1),
    }, '−'),
    h('span', { className: 'dsr-stepper-value', 'aria-live': 'polite' }, String(value)),
    h('button', {
      type: 'button',
      className: 'dsr-stepper-btn',
      'aria-label': `${label} +`,
      disabled: value >= high,
      onClick: () => step(1),
    }, '+'))
}

/** 分组标题的入参。 */
export interface SectionProps {
  readonly title: string
  readonly children?: ReactNode
}

/**
 * 浮层体内的分组标题。
 * @param props - 标题与内容。
 * @returns 分组元素。
 */
export function Section({ title, children }: SectionProps): ReactNode {
  return h('div', null, h('div', { className: 'dsr-section-title' }, title), children)
}

/** 可折叠分区的入参。 */
export interface FlyoutSectionProps {
  readonly title: string
  readonly open: boolean
  readonly onToggle: () => void
  readonly actions?: ReactNode
  readonly maxHeight?: number | undefined
  readonly children?: ReactNode
}

/**
 * 一个可收起的分区：不随内容滚动的标题行 + 自己的滚动区。
 *
 * 标题是按钮，键盘可达，并带 `aria-expanded` 让状态可被朗读。收起时**卸载**
 * 内容区而不是用 CSS 隐藏——留着挂载会让下次展开回到旧的滚动位置。
 *
 * 高度上限由面板通过内联 `maxHeight` 下发，所有分区共享同一个「可用高度的
 * 三分之一」，而不是各自猜自己有多少空间。
 * @param props - 标题、展开标志、收起回调、可选的行内操作、分区内容。
 * @returns 分区元素。
 */
export function FlyoutSection(props: FlyoutSectionProps): ReactNode {
  return h('div', {
    className: 'dsr-section',
    'data-dsr-section': props.title,
    'data-dsr-open': props.open === true ? 'true' : 'false',
    // 上限用内联而不是面板上的 CSS 变量：百分比 max-height 需要确定的父高度，
    // 而这些条目是内容高度，于是后备规则静默失效，最后一个分区会撑满面板
    // 而不是被限制并滚动（验收 B3，实测 566px 对 316px 的三分之一）。
    style: props.maxHeight === undefined ? undefined : { maxHeight: `${props.maxHeight}px` },
  },
  h('div', { className: 'dsr-section-head' },
    h('button', {
      type: 'button',
      className: 'dsr-section-toggle',
      'aria-expanded': props.open === true,
      'data-dsr-toggle': props.title,
      onClick: props.onToggle,
    },
    h('span', { className: 'dsr-section-caret' }, h(IconChevron)),
    h('span', { className: 'dsr-section-title-text' }, props.title)),
    props.actions === undefined ? null : props.actions),
  props.open === true ? h('div', { className: 'dsr-section-body' }, props.children) : null)
}

/**
 * 居中的空态或状态行。
 * @param props - 文案。
 * @returns 空态元素。
 */
export function Empty(props: { readonly children?: ReactNode }): ReactNode {
  return h('div', { className: 'dsr-empty' }, props.children)
}

/** 整行动作按钮的入参。 */
export interface ActionRowProps {
  readonly children?: ReactNode
  readonly onClick?: (() => void) | undefined
}

/**
 * 整行宽度的动作行。
 * @param props - 文案与点击回调。
 * @returns 动作行元素。
 */
export function ActionRow({ children, onClick }: ActionRowProps): ReactNode {
  return h('button', { type: 'button', className: 'dsr-row', onClick },
    h('span', { className: 'dsr-row-main' }, h('span', { className: 'dsr-row-title' }, children)))
}

/** 错误边界的入参。 */
export interface BoundaryProps {
  readonly fallbackText?: string | undefined
  readonly children?: ReactNode
}

/** 错误边界的内部状态。 */
interface BoundaryState {
  readonly failed: boolean
  readonly message?: string | undefined
}

/**
 * 把一次渲染崩溃限制在图标轨内部。
 *
 * 不设边界时，一次渲染异常会让组件从槽里退出（宿主于是把已发布侧栏带回来），
 * 而这正是本插件承诺不会发生的事。
 */
export class Boundary extends Component<BoundaryProps, BoundaryState> {
  /** 初始状态：尚未失败。 */
  constructor(props: BoundaryProps) {
    super(props)
    this.state = { failed: false }
  }

  /**
   * React 在渲染抛错后调用，返回新的边界状态。
   * @param error - 抛出的错误。
   * @returns 失败态；消息用于在兜底界面里定位问题。
   */
  static getDerivedStateFromError(error: unknown): BoundaryState {
    const message = error !== null && typeof error === 'object' && 'message' in error
      ? String((error as { readonly message?: unknown }).message ?? error)
      : String(error)
    return { failed: true, message }
  }

  /**
   * 记录崩溃，便于从应用外部诊断。
   * @param error - 抛出的错误。
   * @param info - React 的组件栈信息。
   * @returns 无。
   */
  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[dsh-sidebar-rail] render failed', error, info.componentStack)
  }

  /**
   * 失败时渲染兜底文案与消息，否则透传 children。
   * @returns 兜底或原始内容。
   */
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return h('div', { className: 'dsr-fallback', role: 'status' },
      this.props.fallbackText,
      this.state.message === undefined
        ? null
        : h('div', { style: { fontSize: '10px', opacity: 0.8 } }, this.state.message))
  }
}
