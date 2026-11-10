/**
 * 宿主适配层：把壳体 Context 收敛成 UI 只需要的「数据 + 回调」。
 *
 * 组件因此拿不到整个宿主 Context，也不会顺手调用未在公开面上承诺的方法
 * （ADR-0005）。所有跨边界读取都在这里收窄，可选服务缺席时返回 null 或空集，
 * 让上层的请求状态机有确定的失败态可用。
 */
import { NS } from './model/constants.ts'
import { resolveLocaleId } from './model/formatting.ts'
import type { Translate } from './locales.ts'

/** 平台面板条目：AccountFlyout 之外的「更多」浮层列出它们。 */
export interface PanelEntry {
  readonly id: string
  readonly label: string
}

/** 一个可被订阅的快照源（与 `useSyncExternalStore` 的形状对齐）。 */
export interface ObservableSource<T> {
  /** 读取当前快照；同一状态必须返回相同引用，否则 React 会无限重渲染。 */
  getSnapshot(): T
  /** 订阅变化，返回取消订阅函数。 */
  subscribe(listener: () => void): () => void
}

/** 面板条目源的快照类型。 */
export type PanelEntriesSource = ObservableSource<readonly PanelEntry[]>

/** locale 源的快照类型。 */
export interface LocaleSnapshot {
  readonly active: string
}

/**
 * 宿主注入的 UI 回调集合。
 *
 * 全部是宿主公开动词的薄包装：不改变参数形状，也不吞掉同步抛错
 * （`openSession` / `startSession` 会同步抛错，包装层保留该行为）。
 */
export interface RailActions {
  /** 展开或折叠宿主侧栏。 */
  toggleSidebar(): void
  /** 切换到某个主面板。 */
  selectPanel(id: string): void
  /** 打开一个工作区。 */
  openWorkspace(workspaceId: string): Promise<unknown> | unknown
  /** 打开一个已有会话（宿主同步抛错时包装层不吞）。 */
  openSession(sessionId: string): void
  /** 在某个工作区新建会话。 */
  startSession(workspaceId: string): void
  /** 调起目录选择器；后端拒绝时 reject。 */
  pickDirectory(): Promise<unknown>
  /** 按绝对路径登记工作区。 */
  createWorkspace(path: string): Promise<unknown> | unknown
}

/**
 * 宿主与外壳之间的完整适配面。
 *
 * `locale` / `panels` 是可订阅快照，`scheduleCatalog` / `pluginInventory` /
 * `accountSeat` 是可选远程读取（缺席时由调用方落到失败态），其余是动作与
 * 标准 props 的转发。
 */
export interface HostAdapter extends RailActions {
  /** 面板条目快照源。 */
  readonly panels: PanelEntriesSource
  /** locale 快照源。 */
  readonly locale: ObservableSource<LocaleSnapshot>
  /** 读取定时任务目录；服务缺席时 resolve null。 */
  scheduleCatalog(): Promise<unknown>
  /** 读取 bundle 列表；服务缺席时 resolve null。 */
  pluginInventory(): Promise<unknown>
  /** 读取账号座位（登录态、头像、余额与链接）。 */
  accountSeat(): Promise<unknown>
  /** 宿主未注入翻译时的兜底文案。 */
  readonly fallbackText: string
}

/**
 * 宿主单词「执行后无返回值」的包装：把同步返回与 Promise 都拉平成 Promise，
 * 让调用方只需处理一种形状。
 * @param run - 立即执行的宿主调用。
 * @returns 该调用结果的 Promise；同步抛错会转成拒绝。
 */
export function settle(run: () => unknown): Promise<unknown> {
  return Promise.resolve().then(run)
}

/**
 * 从宿主 Context 的 `slots` 面上取某个槽的条目，并保持增量订阅。
 *
 * 面板元数据读宿主壳体读的同一本账，于是「更多」浮层列出真实导航条目。
 * 只有条目集合真的变化时才通知订阅者，避免每次渲染都唤醒 React。
 * @param ctx - 宿主 context 的最小面（`slots`）。
 * @returns 可订阅的面板条目源。
 */
export function panelEntriesSource(ctx: SlotsFace): PanelEntriesSource {
  let snapshot: readonly PanelEntry[] = []
  const listeners = new Set<() => void>()
  /** 重读槽条目；集合有变化才更新快照并通知订阅者。 */
  const read = (): void => {
    const entries = ctx.entriesOfSlot('sidebar.panellist') ?? []
    const next: PanelEntry[] = entries.map(({ options }) => ({
      id: options.id,
      label: typeof options.label === 'function'
        ? String(options.label() ?? options.id)
        : String(options.label ?? options.id),
    }))
    // 稳定排序：order 相同时保持宿主给出的顺序。
    next.sort((a, b) => {
      const left = orderOf(entries, a.id)
      const right = orderOf(entries, b.id)
      return left - right
    })
    const same = snapshot.length === next.length
      && snapshot.every((row, index) => row.id === next[index]?.id && row.label === next[index]?.label)
    if (!same) {
      snapshot = next
      for (const listener of [...listeners]) listener()
    }
  }
  read()
  ctx.subscribe('sidebar.panellist', read)
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * 求某个面板条目的排序值。
 * @param entries - 槽条目原始数组。
 * @param id - 面板 id。
 * @returns order 值；未声明时按 0 处理（与宿主一致）。
 */
function orderOf(entries: readonly SlotEntryLike[], id: string): number {
  const entry = entries.find((candidate) => candidate.options.id === id)
  const order = entry?.options.order
  return typeof order === 'number' && Number.isFinite(order) ? order : 0
}

/** 槽条目在适配层读取的最小面。 */
export interface SlotEntryLike {
  readonly options: {
    readonly id: string
    readonly order?: number | undefined
    readonly label?: string | (() => unknown) | undefined
  }
}

/** 适配层用到的 `ctx.slots` 面。 */
export interface SlotsFace {
  /** 取某个槽的条目；槽不存在或为空时返回 undefined。 */
  entriesOfSlot(name: string): readonly SlotEntryLike[] | undefined
  /** 订阅某个槽的变化，返回取消订阅函数。 */
  subscribe(name: string, listener: () => void): () => void
}

/**
 * 构造 locale 快照源：只携带图标轨需要的「当前语言 id」，字段名沿用宿主的 `active`。
 * @param localeFace - 宿主 `ctx.locale` 的最小面。
 * @returns locale 快照源。
 */
export function localeSource(localeFace: LocaleFace): ObservableSource<LocaleSnapshot> {
  return {
    getSnapshot: () => ({ active: resolveLocaleId(localeFace.getSnapshot?.() ?? localeFace.getLocale?.() ?? null) }),
    subscribe: (listener) => localeFace.subscribe(listener),
  }
}

/** 适配层用到的 `ctx.locale` 面。 */
export interface LocaleFace {
  getSnapshot?(): unknown
  getLocale?(): unknown
  subscribe(listener: () => void): () => void
}

/**
 * 取翻译函数：宿主注入的 `t` 缺失时退化成原样返回键名。
 * @param props - 带可选 `t` 的组件道具。
 * @returns 翻译函数。
 */
export function translatorOf(props: { readonly t?: Translate | undefined }): Translate {
  return typeof props.t === 'function' ? props.t : (key) => String(key)
}

/** 本插件注册 locale 字典时使用的命名空间。 */
export const LOCALE_NAMESPACE = NS
