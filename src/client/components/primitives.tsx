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
import { useTitleMarquee } from '../hooks/use-title-marquee.ts'
import type { SessionMark } from '../model/types.ts'

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
 * 定时任务标记的时钟图标。
 *
 * 形状照抄宿主 `IconClockOutlineRegular`（ui-primitives artwork 的 `clock-outline`）：
 * 16px 视框、1px 描边、currentColor。自绘而不是 import，因为产物只能 require
 * 宿主的 react / react-dom。
 * @returns 时钟图标元素。
 */
export function IconClock(): ReactNode {
  return h('svg', {
    viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor',
    strokeWidth: 1, 'aria-hidden': true, focusable: false,
  },
  h('path', { d: 'M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14Z' }),
  h('path', { d: 'M8 4.31V8.46L11 10.08' }))
}

/**
 * 可折叠分区标题的展开箭头。
 *
 * 展开时朝下；收起时由分区 CSS 旋转四分之一圈，因此一个图形覆盖两种状态，
 * 折叠过程带过渡。
 */
export function IconChevron(): ReactNode {
  // 12px rather than the former 10px: the section headers this caret sits in are
  // now 15px/700, and a 10px glyph read as a speck beside them.
  return h('svg', {
    viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', stroke: 'currentColor',
    strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
  }, h('path', { d: 'M5 9l7 7 7-7' }))
}

/**
 * 展开态的项目文件夹图标（宿主 folder-open 图形）。
 *
 * 形状照抄宿主 `IconFolderOpenRegular`（ui-primitives artwork）：三条 path 里
 * 第一条是 opacity 0.16 的同形填充（背面那一层），第二条是外框，第三条是文件夹
 * 背脊与左上角折角。宿主该图标是 fill-only 的 16px 图形，因此这里也走 fill，
 * 不描边——用描边重画会得到另一个形状。外层的 stroke 只是外框默认值，
 * 三条 path 各自用 fill 定义形状。
 */
export function IconFolderOpen(): ReactNode {
  return h('svg', {
    viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', stroke: 'currentColor',
    strokeWidth: 1, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true, focusable: false,
  },
  h('path', {
    d: 'M2.55912 7.93683C2.67584 7.49906 3.0723 7.19446 3.52536 7.19446H13.6491C14.3061 7.19446 14.7846 7.81725 14.6153 8.45209L13.4411 12.856C13.3244 13.2938 12.9279 13.5984 12.4748 13.5984H2.35113C1.69411 13.5984 1.21562 12.9756 1.38489 12.3407L2.55912 7.93683Z',
    fill: 'currentColor', opacity: 0.16, stroke: 'none',
  }),
  h('path', {
    d: 'M13.6491 6.69446C14.6346 6.69453 15.3522 7.62895 15.0983 8.58118L13.9245 12.9845C13.7494 13.6412 13.1539 14.0988 12.4743 14.0988H2.35126C1.36574 14.0988 0.648153 13.1643 0.902044 12.212L2.07587 7.80774C2.25102 7.15128 2.84567 6.69455 3.52509 6.69446H13.6491ZM3.52509 7.69446C3.29865 7.69455 3.10004 7.84674 3.04169 8.06555L1.86786 12.4698C1.78345 12.7872 2.02285 13.0988 2.35126 13.0988H12.4743C12.7007 13.0988 12.8992 12.9463 12.9577 12.7277L14.1325 8.32336C14.2171 8.00598 13.9776 7.69453 13.6491 7.69446H3.52509Z',
    fill: 'currentColor', stroke: 'none',
  }),
  h('path', {
    d: 'M4.7666 1.90137C5.13227 1.90144 5.48571 2.03525 5.75977 2.27734L7.27246 3.61328C7.36379 3.69382 7.48174 3.73828 7.60352 3.73828H12.3994C13.2276 3.73841 13.8993 4.41005 13.8994 5.23828V6.7168C13.8183 6.70327 13.735 6.69436 13.6494 6.69434H12.8994V5.23828C12.8993 4.96233 12.6754 4.73841 12.3994 4.73828H7.60352C7.23781 4.73828 6.88446 4.60438 6.61035 4.3623L5.09766 3.02637C5.00636 2.94576 4.88838 2.90144 4.7666 2.90137H2.0498C1.77366 2.90137 1.5498 3.12523 1.5498 3.40137V9.78223L0.902344 12.2119C0.648452 13.1642 1.36604 14.0986 2.35156 14.0986H2.0498C1.2214 14.0986 0.549838 13.427 0.549805 12.5986V3.40137C0.549805 2.57294 1.22138 1.90137 2.0498 1.90137H4.7666Z',
    fill: 'currentColor', stroke: 'none',
  }))
}

/**
 * 收起态的项目文件夹图标（宿主 folder-close 图形）。
 *
 * 照抄宿主 `IconFolderCloseRegular`：16px、两条描边 path（外框 + 折痕），
 * 描边宽度取宿主 regular 权重的 1px，与展开态那条 fill-only 图形同源。
 */
export function IconFolderClose(): ReactNode {
  return h('svg', {
    viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', stroke: 'currentColor',
    strokeWidth: 1, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true, focusable: false,
  },
  h('path', {
    d: 'M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z',
  }),
  h('path', { d: 'M3.63501 7.66614H12.3647' }))
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
  /** 该会话是否有活跃的定时任务；仅行状态为 idle 时显示时钟（宿主同款互斥）。 */
  readonly scheduledTask?: boolean | undefined
  /** 时钟标记的无障碍文案。 */
  readonly scheduledTaskLabel?: string | undefined
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
  // 标题超出格子时，指针停留期间以恒定速度滚到末端（照抄宿主 useTitleMarquee）。
  const marquee = useTitleMarquee()
  const main = h('button', {
    type: 'button',
    className: 'dsr-row',
    // 刻意不写内联背景：它曾压过 CSS 里的 hover / focus-visible / current 规则，
    // 于是没有图钉包装的行永远不显示任何状态。行背景从此归样式表管。
    style: { flex: '1 1 auto', minWidth: 0 },
    'aria-current': props.current === true ? 'page' : undefined,
    'data-dsr-current': props.current === true ? 'true' : undefined,
    onClick: props.onClick,
    // 触屏点按不触发滚动：没有「悬停」这个持续状态，动起来反而像故障。
    onPointerEnter: (event: { pointerType?: string }) => {
      if (event.pointerType === 'touch') return
      marquee.enter()
    },
    onPointerLeave: marquee.leave,
  },
  h('span', { className: 'dsr-row-main' },
    h('span', { ref: marquee.titleRef, className: 'dsr-row-title' }, props.title),
    props.meta === undefined || props.meta === '' ? null : h('span', { className: 'dsr-row-meta' }, props.meta)),
  // 行首那一格是状态标记与定时任务时钟的共用位置，两者互斥：宿主只在行
  // 自身状态为 idle 时才把这一格让给时钟（侧栏行在审批/未读/运行中时状态点优先）。
  h(SessionMarkCell, {
    status: props.status,
    statusLabel: props.statusLabel,
    scheduledTask: props.scheduledTask,
    scheduledTaskLabel: props.scheduledTaskLabel,
  }))
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
  /**
   * 该项目旗下会话的最高状态标记（{@link projectStatusOf} 的结果）。
   *
   * 宿主在项目层级不聚合状态，这一格是本插件补的；`idle` 不画任何东西，
   * 因此「没有值得注意的会话」与「没有状态数据」都表现为同一个安静的行。
   */
  readonly status?: SessionMark | undefined
  /** 状态标记的无障碍文案。 */
  readonly statusLabel?: string | undefined
  readonly children?: ReactNode
}

/**
 * 一个项目行：文件夹图标、名称、新建会话、图钉。
 *
 * **刻意不复用 `Row`**：项目行有两个任何会话行都没有的操作，且文件夹图标必须常显
 * （会话行的图钉只在悬停时出现）。并进 `Row` 会让其余每个列表都要做一堆
 * `undefined` 判断。
 *
 * 展开/收起用宿主的方式（spec §4.3）：**整行**可点，不再只有箭头可点；图标本身
 * 也从箭头换成了文件夹——收起是 folder-close，展开是 folder-open。整行的点击
 * 处理器挂在外层容器上，中间那个 `<button>` 只负责键盘可达与 `aria-expanded`，
 * 它的点击事件冒泡到外层，因此鼠标与键盘走同一条路径。
 *
 * 图钉与新建会话按钮阻止冒泡，避免顺带把行折起来。
 * @param props - 行内容、展开态与三个回调。
 * @returns 项目行元素。
 */
export function ProjectRow(props: ProjectRowProps): ReactNode {
  return h('div', { className: 'dsr-project-row', 'data-pinned': props.pinned === true ? 'true' : undefined },
    // 整行点击：处理器只挂在这一层。内层按钮自己不挂 onClick，它的鼠标点击与
    // 键盘 Enter/Space 都会冒泡到这一层，于是两条路径共用同一个处理器，也不会
    // 因为两层各挂一个而切换两次。
    h('div', { className: 'dsr-row-wrap', onClick: props.onToggleOpen },
      h('button', {
        type: 'button',
        className: 'dsr-row dsr-project-main',
        style: { flex: '1 1 auto', minWidth: 0 },
        'aria-expanded': props.open === true,
        'data-dsr-project-toggle': props.title,
      },
      h('span', {
        className: 'dsr-project-folder',
        'data-dsr-open': props.open === true ? 'true' : 'false',
      }, props.open === true ? h(IconFolderOpen) : h(IconFolderClose)),
      h('span', { className: 'dsr-row-main' },
        h('span', { className: 'dsr-row-title' }, props.title),
        props.meta === undefined || props.meta === ''
          ? null
          : h('span', { className: 'dsr-row-meta' }, props.meta)),
      // 状态点排在加号之前的**固定位置**：它属于「这一行现在怎么样」的尾部信息，
      // 与会话行把标记放在行尾同一个道理（见 PRD A15 的既有裁决）。固定在这里
      // 也让标题拿到整行的可伸缩宽度——项目名不再为一个时有时无的点让位，
      // 长名字的省略只发生在真正放不下的时候。idle 时 StateMark 不渲染，
      // 因此安静的项目行不会留下空槽。
      h('span', { className: 'dsr-project-status' },
        h(StateMark, { status: props.status ?? 'idle', label: props.statusLabel ?? '' }))),
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
  readonly children?: ReactNode
}

/**
 * 一个可收起的分区：标题行 + 内容区，两者都在浮层**同一个**滚动容器里。
 *
 * 标题是按钮，键盘可达，并带 `aria-expanded` 让状态可被朗读。收起时**卸载**
 * 内容区而不是用 CSS 隐藏——留着挂载会让下次展开回到旧的滚动位置。
 *
 * 分区**不再限高、也不再自己滚动**（ADR-0009）：标题与条目一起随浮层整体滚动，
 * 于是这里既没有 `maxHeight` 入参，也没有内联高度。
 * @param props - 标题、展开标志、收起回调、可选的行内操作、分区内容。
 * @returns 分区元素。
 */
export function FlyoutSection(props: FlyoutSectionProps): ReactNode {
  // 没有内联高度：分区高度从此只由内容决定，限高已随 ADR-0009 一并移除。
  return h('div', {
    className: 'dsr-section',
    'data-dsr-section': props.title,
    'data-dsr-open': props.open === true ? 'true' : 'false',
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

/** 行首标记格的入参。 */
export interface SessionMarkCellProps {
  /** 会话状态；undefined 表示宿主未提供状态快照。 */
  readonly status?: SessionMark | undefined
  /** 状态的无障碍文案。 */
  readonly statusLabel?: string | undefined
  /** 该会话是否有活跃的定时任务。 */
  readonly scheduledTask?: boolean | undefined
  /** 时钟标记的无障碍文案。 */
  readonly scheduledTaskLabel?: string | undefined
}

/**
 * 行首那一格：状态点与定时任务时钟二选一。
 *
 * 复刻宿主的行为：定时任务的时钟标记坐在行首 16px 格里，但**只有行自身状态
 * 是 idle 时**才挂载——审批请求、未读完成或正在运行会占用同一格，此时状态点
 * 优先，时钟不出现（宿主 SessionScheduleMark 的槽位注释就是这么写的）。
 * @param props - 状态、定时任务标志与两者各自的文案。
 * @returns 时钟、状态点，或什么都不渲染。
 */
export function SessionMarkCell(props: SessionMarkCellProps): ReactNode {
  const status = props.status ?? 'idle'
  if (props.scheduledTask === true && status === 'idle') {
    return h('span', {
      className: 'dsr-row-mark',
      title: props.scheduledTaskLabel,
      // 点时钟不应激活会话：这一格借的是行按钮内部的点击区域。
      onClick: (event: { stopPropagation(): void }) => {
        event.stopPropagation()
      },
    },
    h(IconClock),
    h('span', { className: 'dsr-visually-hidden' }, props.scheduledTaskLabel ?? ''))
  }
  if (props.status === undefined) return null
  return h(StateMark, { status: props.status, label: props.statusLabel ?? '' })
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

/** 「显示更多」按钮的入参。 */
export interface ShowMoreProps {
  readonly label: string
  readonly onClick: () => void
}

/**
 * 列表末尾的「显示更多」按钮。
 *
 * 只在还有被水位藏起来的行时渲染（调用方判断后整个不挂载），因此这里没有
 * disabled 态：一个永远点不动的按钮比不画它更像缺陷。
 * @param props - 已翻译的文案与抬高水位的回调。
 * @returns 按钮元素。
 */
export function ShowMore({ label, onClick }: ShowMoreProps): ReactNode {
  return h('button', {
    type: 'button',
    className: 'dsr-show-more',
    'data-dsr-show-more': '',
    onClick,
  }, label)
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