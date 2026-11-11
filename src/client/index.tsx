/**
 * Client 半边入口：导出 `inject` 与 `apply`，组织槽注册、locale 与样式生命周期。
 *
 * 只使用宿主公开面：`shell.overlay` 增量注册（从不替换 sidebar 单槽）。
 * 所有注册都经 `ctx.effect` 持有清理句柄，卸载顺序是「先停消费者，再释放依赖」。
 */
import type { ReactNode } from 'react'
import { h } from './jsx.ts'
import { Boundary } from './components/primitives.tsx'
import { RailOverlay } from './components/RailOverlay.tsx'
import {
  localeSource,
  panelEntriesSource,
} from './host-adapter.ts'
import type {
  LocaleFace,
  SlotsFace,
} from './host-adapter.ts'
import { NS } from './model/constants.ts'
import { accountClientMetadata, clientBuildVersion, withAccountExtras, accountSeatState } from './model/account.ts'
import { resolveLocaleId } from './model/formatting.ts'
import { REMOTE_TIMEOUT_MS } from './model/constants.ts'
import { en, zh } from './locales.ts'
import styles from './styles.css'
import type { AccountSeatWithExtras } from './model/types.ts'

/** 宿主客户端 Context 的最小面：只声明本插件实际使用的服务。 */
interface ClientContext {
  /** 生命周期注册（返回清理句柄）。 */
  effect(run: () => (() => void) | void, label?: string): () => void
  /** 槽注册表。 */
  slots: SlotsFace & {
    /** 注册一个槽入口，返回注册句柄。 */
    register(definition: Record<string, unknown>, component: (props: never) => ReactNode): () => void
    /** 在某个槽上做一次声明式注入。 */
    inject(name: string, run: () => unknown): unknown
  }
  /** locale 服务。 */
  locale: LocaleFace & {
    /** 注册一个命名空间的字典，返回清理句柄。 */
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
  }
  /** 布局服务：面板选择与侧栏折叠。 */
  layout: {
    toggleSidebar(): void
    selectPanel(id: string): void
  }
  /** 工作区/会话导航服务。 */
  uiWorkspace: {
    openWorkspace(workspaceId: string): unknown
    openSession(target: string): void
    startSession(workspaceId: string): void
    pickDirectory(): Promise<unknown>
  }
  /** 可选的远程服务读取入口。 */
  get(name: string): unknown
}

/**
 * 从 `ctx.slots` / `ctx.locale` 构造图标轨的注入面。
 *
 * 所有导航动作都只是宿主公开动词的薄包装；可选服务经 `ctx.get` 读取，
 * 于是宿主缺少其中一个也不会在注册期抛错。
 * @param ctx - 客户端根 Context 的最小面。
 * @returns 图标轨的注入面。
 */
function buildInjectFace(ctx: ClientContext): Record<string, unknown> {
  return {
    toggleSidebar: () => {
      ctx.layout.toggleSidebar()
    },
    selectPanel: (id: string) => {
      ctx.layout.selectPanel(id)
    },
    openWorkspace: (workspaceId: string) => ctx.uiWorkspace.openWorkspace(workspaceId),
    openSession: (target: string) => {
      ctx.uiWorkspace.openSession(target)
    },
    // 在一个项目里新建会话（ticket #3）。宿主自己的动词返回 void：
    // 它自己切换主视图，因此没有 id 要传递。
    startSession: (workspaceId: string) => {
      ctx.uiWorkspace.startSession(workspaceId)
    },
    // 目录选择与项目登记（ticket #4）。刻意是两个不同的服务：`pickDirectory`
    // 在 `uiWorkspace` 上，而 `create` 是独立 `workspaces` 服务上的命令。
    // 这里用 `ctx.get` 而不是解构，避免宿主缺少其中一个时在注册期抛错。
    pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
    createWorkspace: (path: string) => {
      const workspaces = ctx.get('workspaces')
      if (workspaces === null || typeof workspaces !== 'object' || typeof (workspaces as { create?: unknown }).create !== 'function') {
        throw new Error('workspace service unavailable')
      }
      return (workspaces as { create(input: { path: string }): unknown }).create({ path })
    },
    panels: panelEntriesSource(ctx.slots),
    locale: localeSource(ctx.locale),
    scheduleCatalog: async (): Promise<unknown> => {
      const remote = ctx.get('remote.schedule')
      if (remote === null || typeof remote !== 'object') return null
      const catalog = (remote as { catalog?: unknown }).catalog
      return typeof catalog === 'function' ? (catalog as () => Promise<unknown>).call(remote) : null
    },
    // 图标轨列出人安装并启用的东西，因此读 bundle 列表而不是 Loader inventory：
    // 只有 bundle 带 `official`，那正是分开宿主自带插件与用户插件的字段
    // （inventory 只暴露 moduleName/enabled）。
    pluginInventory: async (): Promise<unknown> => {
      const manager = ctx.get('remote.pluginManager')
      if (manager === null || typeof manager !== 'object') return null
      const listBundles = (manager as { listBundles?: unknown }).listBundles
      return typeof listBundles === 'function' ? (listBundles as () => Promise<unknown>).call(manager) : null
    },
    // 账号座位显示宿主自己的头像，因此读宿主侧栏读的那份资料。失败退化成中性兜底字符。
    // 两次调用，因为它们的失败方式不同：`getState` 不接受身份、只回答登录问题，
    // 于是缺失的构建版本绝不会让我们失去「未登录」渲染。只有已登录账号才会走到
    // `getProfile`，那确实需要身份。
    //
    // 每条路径都经 `withAccountExtras` 返回：`getState` 对未登录账号也携带
    // `links`，在那里丢掉它们会让未登录的人看不到用量/充值入口。整次读取还与
    // `REMOTE_TIMEOUT_MS` 赛跑（AGENTS.md 硬约束 8）：挂起的 Host 调用必须以
    // 可见失败态收场，绝不能停在永远的「余额不可用」座位。
    accountSeat: async (): Promise<AccountSeatWithExtras> => {
      const account = ctx.get('remote.account')
      if (account === null || typeof account !== 'object'
        || typeof (account as { getState?: unknown }).getState !== 'function') {
        return withAccountExtras({ kind: 'unknown', avatarUrl: undefined }, null, null)
      }
      const face = account as {
        getState(): Promise<unknown>
        getProfile?(metadata: unknown): Promise<unknown>
        getBalance?(metadata: unknown): Promise<unknown>
      }
      let timedOut = false
      /** 计时器句柄；每条出口都清掉，于是结束的读取不泄漏任何东西。 */
      let timerId: number | undefined
      const timer = new Promise<null>((resolve) => {
        timerId = window.setTimeout(() => {
          timedOut = true
          console.warn('[dsh-sidebar-rail] account read timed out')
          resolve(null)
        }, REMOTE_TIMEOUT_MS)
      })
      const read = (async (): Promise<AccountSeatWithExtras> => {
        let view: unknown
        try {
          view = await face.getState()
        } catch (error) {
          console.warn('[dsh-sidebar-rail] account state unavailable', error)
          return withAccountExtras({ kind: 'unknown', avatarUrl: undefined }, null, null)
        }
        // `view` 已在手上：即使后续读取提前结束，也带着它的 `links`。
        const viewValue = unwrapValue(view)
        const signedIn = viewValue !== null && typeof viewValue === 'object'
          && (viewValue as { status?: unknown }).status === 'credential-stored'
        if (!signedIn) return withAccountExtras(accountSeatState(view, null), view, null)
        const metadata = accountClientMetadata(
          resolveLocaleId(ctx.locale.getSnapshot?.() ?? null),
          clientBuildVersion(),
          new Date().getTimezoneOffset(),
        )
        if (metadata === null) {
          console.warn('[dsh-sidebar-rail] account calls skipped: no client build version')
          return withAccountExtras({ kind: 'signed-in', avatarUrl: undefined }, view, null)
        }
        if (typeof face.getProfile !== 'function') {
          return withAccountExtras({ kind: 'signed-in', avatarUrl: undefined }, view, null)
        }
        // 资料与余额在宿主侧是两条独立查询，一个失败不能让另一个变空白：
        // 各自保留自己的兜底。
        const [profile, balance] = await Promise.all([
          face.getProfile(metadata).catch((error: unknown) => {
            console.warn('[dsh-sidebar-rail] account profile unavailable', error)
            return null
          }),
          typeof face.getBalance === 'function'
            ? face.getBalance(metadata).catch((error: unknown) => {
              console.warn('[dsh-sidebar-rail] account balance unavailable', error)
              return null
            })
            : Promise.resolve(null),
        ])
        return withAccountExtras(accountSeatState(view, profile), view, balance)
      })()
      try {
        // 竞速的输方自行结束；`read` 已经吞掉自己的失败，迟到的答案也不许写状态
        // （调用方的 `live` 标志覆盖这一点）。
        const result = await Promise.race([read, timer])
        if (timedOut || result === null) {
          return withAccountExtras({ kind: 'unknown', avatarUrl: undefined }, null, null)
        }
        return result
      } finally {
        if (timerId !== undefined) window.clearTimeout(timerId)
      }
    },
    fallbackText: 'Sidebar rail unavailable',
  }
}

/**
 * 剥掉 `RemoteResult` 外壳取出内层值；没有外壳时原样返回。
 * @param answer - 任意远程答案。
 * @returns 内层值或原输入。
 */
function unwrapValue(answer: unknown): unknown {
  return answer !== null && typeof answer === 'object' && 'value' in answer
    ? (answer as { readonly value?: unknown }).value
    : answer
}

/** 客户端的模块导出面：宿主按这个形状物化插件。 */
export const inject = ['slots', 'locale', 'layout', 'uiWorkspace', 'workspaces', 'remote']

/**
 * 注册图标轨外壳、字典与样式表。
 *
 * Client 插件的 apply 在页面启动期运行。这里任何一抛都会让人失去图标轨，
 * 因此注册被 try/catch 包住并只记录一次；已发布的侧栏无论如何都不受影响。
 * @param ctx - 客户端根 Context。
 * @returns 无。
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-sidebar-rail: dictionaries')
    ctx.effect(() => {
      const style = document.createElement('style')
      style.setAttribute('data-dsh-sidebar-rail', '')
      style.textContent = styles
      document.head.appendChild(style)
      return () => {
        style.remove()
      }
    }, 'dsh-sidebar-rail: styles')

    const face = buildInjectFace(ctx)

    // 只做增量：已发布的侧栏从不被替换，于是搜索、视图选项、设置座位与账号菜单
    // 都保持宿主的原样。宿主唯一留空的状态是 macOS 折叠列（零宽、无轨），
    // 那正是本插件填上的座位。
    const registerOverlay = (): () => void => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'dsh-sidebar-rail.rail',
      order: 10,
      locale: NS,
      inject: () => face,
    }, (props: { fallbackText?: string }) => h(Boundary, { fallbackText: props.fallbackText },
      h(RailOverlay, props as never)))) as () => void

    ctx.effect(registerOverlay, 'dsh-sidebar-rail: rail overlay')
  } catch (error) {
    console.error('[dsh-sidebar-rail] apply failed; the shipped sidebar is unaffected', error)
  }
}
