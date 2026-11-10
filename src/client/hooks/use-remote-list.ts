/**
 * 懒加载远程列表：一次浮层打开只请求一次，切走后旧答案落地不算数。
 *
 * 两条规则都是踩过的坑（0.2.x 的「浮层永远加载中」）：
 *   - effect 只依赖 `open`。把阶段写进依赖会让「刚设成 loading」立刻再次触发
 *     effect，而 React 的清理随即把 `live` 置 false 并清掉计时器——于是
 *     Promise 结果永远被丢掉。
 *   - 加载器经 ref 读取：注入 props 每次渲染都是新对象，把函数身份放进依赖
 *     会在每次渲染重跑同一个 effect，重新引入上面的缺陷。
 */
import { useEffect, useRef, useState } from 'react'
import { REMOTE_TIMEOUT_MS } from '../model/constants.ts'
import { remoteOutcome } from '../model/remote.ts'

/** 列表的阶段：未开始、加载中、就绪、失败。 */
export type ListPhase = 'idle' | 'loading' | 'ready' | 'failed'

/** 一个远程列表的状态；只有 `ready` 携带行。 */
export interface ListState<Row> {
  readonly phase: ListPhase
  readonly rows: readonly Row[]
}

/** 未开始时的状态常量，避免每次渲染都造新对象。 */
export const IDLE_LIST: { readonly phase: 'idle'; readonly rows: readonly never[] } = {
  phase: 'idle',
  rows: [],
}

/** `useFlyoutList` 的入参。 */
export interface FlyoutListOptions<Row> {
  /** 当前打开的浮层 id；null 表示没有打开。 */
  readonly open: string | null
  /** 该列表属于哪个浮层；`open` 等于它时才加载。 */
  readonly when: string
  /** 远程调用；服务缺席时 resolve null（于是归为 unavailable→failed）。 */
  readonly load: () => Promise<unknown>
  /** 就绪行的归一化函数。 */
  readonly normalize: (rows: readonly unknown[]) => readonly Row[]
  /** 日志标签，指出是哪一份列表。 */
  readonly label: string
}

/**
 * 按浮层打开事件加载一份远程列表。
 *
 * 结局只有四种：未开始、加载中、就绪、失败。可选服务缺席（`unavailable`）
 * 归为失败而不是空列表——那是可以让人采取行动的失败（AGENTS.md 硬约束 8）。
 * @param options - 浮层 id、加载器、归一化函数与日志标签。
 * @returns 当前列表状态。
 */
export function useFlyoutList<Row>(options: FlyoutListOptions<Row>): ListState<Row> {
  const { open, when, load, normalize, label } = options
  const [state, setState] = useState<ListState<Row>>(IDLE_LIST)
  /** 加载器经 ref 读取，避免函数身份进入 effect 依赖。 */
  const loader = useRef(load)
  loader.current = load
  const normalizer = useRef(normalize)
  normalizer.current = normalize
  const started = useRef(false)

  useEffect(() => {
    // 关闭的浮层忘掉自己的尝试，于是重开会重试一次挂起的调用。
    if (open !== when) {
      started.current = false
      return undefined
    }
    if (started.current) return undefined
    started.current = true
    let live = true
    setState({ phase: 'loading', rows: [] })
    // AGENTS.md 硬约束 8：可选 Host 调用绝不能把界面留在永久加载态。
    const timer = window.setTimeout(() => {
      if (live) setState({ phase: 'failed', rows: [] })
    }, REMOTE_TIMEOUT_MS)
    Promise.resolve()
      .then(() => loader.current())
      .then((answer) => {
        if (!live) return
        const outcome = remoteOutcome(answer)
        if (outcome.kind !== 'ready') {
          // 'unavailable' 表示可选远程缺席——那是人可行动的失败，绝不是空列表。
          setState({ phase: 'failed', rows: [] })
          return
        }
        const rows = normalizer.current(Array.isArray(outcome.value) ? outcome.value : [])
        if (rows.length !== (Array.isArray(outcome.value) ? outcome.value.length : 0)) {
          // CODING_STANDARDS §6：归一化会丢掉宿主发来的行（不认识的任务状态、
          // 未安装的 bundle），静默丢弃在「我的插件怎么不见了」时无从解释。
          const received = Array.isArray(outcome.value) ? outcome.value.length : 0
          console.info('[dsh-sidebar-rail] %s: kept %d of %d rows', label, rows.length, received)
        }
        setState({ phase: 'ready', rows })
      })
      .catch(() => {
        if (live) setState({ phase: 'failed', rows: [] })
      })
      .finally(() => {
        window.clearTimeout(timer)
      })
    // 清理在浮层切走时运行。`live` 挡住旧答案落地，`started` 也必须随
    // `open` 变化复位，否则切回来会提前返回、列表永远停在「加载中」。
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [open, when, label])

  return state
}
