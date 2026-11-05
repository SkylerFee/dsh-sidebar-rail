# dsh-sidebar-rail · 设计说明

> 本文与实现同步维护。验证记录见 [verify.md](verify.md)，需求与验收见 [PRD](PRD.md)。

客户端静态模块的 `window.__ModuleLoader__.load({ id, factory })` 使用完整包名 `@skylerfee/dsh-sidebar-rail` 作为 `id`，与 `package.json.name` 和 bundle patch 的模块 `name` 一致。宿主按该包名导入工厂；不能把注册 ID 改成去掉作用域的短名。`shell.overlay` 条目 ID 和本地存储键仍使用各自已有的值。

## 1. 定位：增量插件，只补一个状态

宿主只有一种状态是「空」的：**macOS Desktop + 侧栏折叠**。此时 `AppFrame` 把左侧列折到 0 宽（`const collapsedWidth = drawer || darwin || windowsTitlebar ? 0 : SIDEBAR_COLLAPSED`，`SIDEBAR_COLLAPSED = 56`），列上还有 `overflow: hidden`，样式的注释直接写着「The darwin closed sidebar has no rail」。本插件只往这个空位补一条 56px 图标轨。

其余状态一律不渲染：

| 状态 | 宿主已有 | 插件行为 |
| --- | --- | --- |
| macOS Desktop 展开态 | 完整原生侧栏（搜索、视图选项、添加工作区、设置座位、账号菜单） | 不渲染任何节点 |
| Web 折叠态 | 宿主自带 56px 折叠轨（`ui-sidebar` 的 `.collapsed` rail 布局） | 不渲染，避免出现第二条轨 |
| Web 展开态 | 完整原生侧栏 | 不渲染 |
| Windows / Linux | 未验证 | 不渲染 |

判据是 `document.documentElement.dataset.platform === 'darwin'` 且宿主 frame 带 `data-sidebar-collapsed`，两者任一不成立就 `return null`。

## 2. 挂载点：`shell.overlay` list 槽

ui-layout 在 frame 上把 `shell.overlay` 声明为 **`kind: 'list'`、`scope: 'root'`** 的增量座位，专门给「自己的整帧浮动面」用：条目按 `id` 并存，不需要声明 `children`，不会和别的插件抢位。实际注册写法（见 `client.js` 的 `apply`）：

```js
ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
  name: 'shell.overlay',
  id: 'dsh-sidebar-rail.rail',
  order: 10,
  locale: NS,
  inject: injectProps,
}, (props) => h(Boundary, { fallbackText: props.fallbackText }, h(RailOverlay, props)))),
'dsh-sidebar-rail: rail overlay')
```

渲染容器是 frame 内的 `.overlayLayer`：`position: absolute; inset: 0; z-index: 20; pointer-events: none`，其直接子元素恢复 `pointer-events: auto`。因此条目自己的根节点默认「透明可穿透」，这正好适合一个把内容 portal 出去的组件。

**关键限制：overlay 条目拿不到 owner props。** 只有 `sidebar` 这类单槽的占用者才会收到 frame 给的 `collapsed / width / drawer`；`shell.overlay` 是列表条目，只有运行时 props 加 `inject` face。所以折叠状态不能靠 props 判断，见下一节。

## 3. 折叠检测：读宿主发布的 DOM 属性

- 宿主在 frame 元素上发布折叠状态：`<div className={css.frame} data-sidebar-collapsed={sidebarCollapsed || undefined} …>`（`ui-layout` 的 `AppFrame.tsx`）。
- 定位 frame：`.overlayLayer` 是 frame 的直接子节点，且带稳定标记 `data-shell-overlay`。用 `document.querySelector('[data-shell-overlay]')?.parentElement` 拿到 frame，**不用** hash 化的 CSS Module 类名（构建一变就失效）。
- 订阅用**属性范围限定的 MutationObserver**：

```js
const observer = new MutationObserver(() => setCollapsed(frame.hasAttribute('data-sidebar-collapsed')))
observer.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
return () => { observer.disconnect() }
```

  只观察这一个属性，窗口 resize、无关 re-render 都不会唤醒组件；`useEffect` 清理时 `disconnect()`。

- 兜底：拿不到 frame 时一直按「未折叠」处理（不渲染），不在错误状态下画东西。

## 4. portal 定位与避让

轨本体用 `createPortal(document.body)` 渲染，样式 `.dsr-rail-float`：

```
position: fixed; left: 0; top: var(--dsh-frame-top-clearance, 48px); bottom: 0;
width: 56px; z-index: 60; -webkit-app-region: no-drag;
background: var(--dsw-specific-sidebar-fill); border-right: .5px solid var(--dsw-alias-border-l3);
```

- **为什么必须 portal**：折叠列宽为 0 且 `.sidebarCol { overflow: hidden }`，任何挂在列内的元素都会被裁没。portal 到 `body` 是唯一不被裁剪的面。
- **为什么 top 从 48px 起**：`--dsh-frame-top-clearance` 是宿主声明在**根元素**上的窗口 chrome 带高度（注释明确写了「Declared on the root element rather than the frame so overlays portalled to document.body inherit it too」，macOS 桌面端 48px）。这条带里有：
  - macOS 红绿灯（traffic lights 到 x 68）；
  - 宿主自己挂在 `shell.leading` 的重开 / 新会话控件（`.leadingSeat { top: 11px; left: 88px; z-index: 15 }`，`leadingMounted = drawer || darwin && sidebarCollapsed`）。
  从 48px 起排就同时避开两者；`var(..., 48px)` 的 fallback 保证变量缺失时也不压 chrome。
- **显式 `-webkit-app-region: no-drag`**：Electron 的 app-region 是**几何**而不是 stacking，浮轨盖住窗口拖拽带时必须自己 opt out（即便 body 级 portal 通常已继承 no-drag），否则点图标会拖窗口。
- **窄窗口不渲染**：判定不是 CSS 媒体查询，而是纯函数 `shouldRenderRail(platform, collapsed, viewportWidth)`（阈值 `RAIL_MIN_VIEWPORT = 768`），`RailOverlay` 用 `window.innerWidth` + `resize` 监听驱动；不满足即 `return null`，组件整体卸载。768 = 680（宿主正文最小宽）+ 56（轨宽）+ 32（两侧安全）。为什么不用 CSS：阈值语义是「正文是否还放得下」，与轨自身盒模型无关；做成纯函数还能被单测覆盖边界（`test/data.test.mjs`）。为什么不是 900：旧实现的 900 是拍的，与宿主 drawer 断点（768）无对应关系；按 680 正文可读宽推导更可解释。
- **浮层位置**：`.dsr-flyout` 也是 `position: fixed`（portal 到 body），`width: 288px; max-height: calc(100vh - 32px)`，位置从触发按钮的 `getBoundingClientRect()` 取：`left = rect.right + 8`，`top` 夹在 `[12, innerHeight - 200]`，避免底部越界。

## 5. 为什么不改宿主列宽

看起来最「干净」的做法是把折叠列宽从 0 改成 56，再把轨嵌回栅格。未采用，原因：

1. 列宽是宿主算出来的：`AppFrame` 把 `gridTemplateColumns` 作为**内联样式**写在 frame 上，并在 resize、折叠动画、drawer 切换时重算。插件要改只能覆写内联样式 / 用 `!important` 盖宿主 CSS，和宿主的几何契约打架。
2. 折叠是一次带过渡的 track 变化（`--ds-transition-duration-slow`），第三方把宽度钉死会破坏动画与拖拽把手逻辑（`DragHandle` 只在展开时挂载）。
3. 即便改宽，macOS 折叠态列内的内容也不是为 56px 轨排的布；宿主的语义是「折叠即隐藏整个列」。
4. 结论：**不做列宽修改、不用 `!important` 覆盖宿主栅格轨**；改为 portal 浮层，代价是浮在主内容之上（已写进 README 的已知限制）。

## 6. 为什么不替换 `sidebar` 槽

`sidebar` 是 `kind: 'single'`，ui-layout 的槽文档写得很明白：

> registering here replaces the navigation column outright rather than adding to it, and the seats it declares disappear with it.

决定性理由不是「抢占风格」而是**设置会整体不可达**：`ui-sidebar` 在自己的注册里声明了 7 个子槽，其中 `sidebar.settings` 由 `ui-settings-general` 的 `SettingsRoot` 占位。一旦插件替换 `sidebar`，这 7 个子槽随之消失 → `SettingsRoot` 根本不挂载 → 设置（含账号页、主题、插件管理入口）全部没有入口。

替换还会一起带走：搜索、视图选项、添加工作区、拖拽排序、行内重命名 / Fork / 归档菜单、账号菜单。这些正是重构要「交回宿主」的部分。

因此本项目**不允许**重新引入替换 `sidebar` 的实现（`AGENTS.md` 已写成硬约束）。

## 7. z-index 层级取舍

宿主 frame 相关层级（`AppFrame.module.css`）：drag handle 11、`.leadingSeat` 15、`.overlayLayer` 20、drawer 模式下 `.drawerMask` 70 / drawer 列 71。

| 面 | z-index | 理由 |
| --- | --- | --- |
| 浮轨 `.dsr-rail-float` | 60 | 要盖住 overlay 层（20）与 leading seat（15）的视觉层，但不能压过 drawer 体系（70/71）——drawer 只在 <768px 生效，而浮轨在同一阈值下已不渲染（`shouldRenderRail` 的 768），两者不共存 |
| 浮层 `.dsr-flyout` | 2147483000（字面值） | 浮层是 body portal，要压过宿主任意表面；宿主没有提供「浮层层级」token，用极大字面值而不是 `!important` |

浮轨只有 56px 宽，指针事件只落在自己的盒子里，不会挡住正文交互。

## 8. 事件、计时与清理

| 交互 | 实现 | 清理 |
| --- | --- | --- |
| 悬停打开 | `pointerenter` 后 120ms（`OPEN_DELAY_MS`）定时器 | `clearTimers()` 卸下两个定时器 |
| 移出关闭 | `pointerleave` 后 200ms（`CLOSE_DELAY_MS`）；浮层 `onPointerEnter: cancelClose`，跨间隙不闪断 | 同上 |
| Escape | `open !== null` 时挂 `window` keydown，关闭浮层 | effect cleanup 摘除监听 |
| 定时任务 / 插件数据 | 浮层首次打开才拉取（`idle → loading → ready/failed`） | `live` 标记，清理后不回写 state |
| 槽注册与订阅 | `ctx.effect(...)` 包裹 overlay 注册、locale 字典、panel 条目订阅、locale 订阅 | effect dispose 自动回收 |
| 样式 | `<style data-dsh-sidebar-rail>` 注入 `head` | 卸载时 `style.remove()` |
| 折叠订阅 | 属性限定 MutationObserver | `observer.disconnect()` |

## 9. 卸载恢复

插件卸载 / 禁用后：overlay 条目被注销 → `RailColumn` 卸载 → 上述 effect 全部执行清理 → keydown 监听、定时器、MutationObserver、样式节点、portal 出来的 DOM 一起消失。宿主侧栏与正文**从未被修改**，所以不存在「恢复宿主原状」的额外步骤；`localStorage['dsh.sidebar-rail.v1']` 里的置顶偏好保留（重装即读回），不写宿主存储。

## 10. 数据来源（全部只读）

| 数据 | 来源 |
| --- | --- |
| 会话 | 标准 prop `useSessions(state => state)` → `{ ids, byId }`，`byId[id]: SessionSummary` |
| 工作区 | 标准 prop `useWorkspaces(state => state.items)` → `WorkspaceView[]` |
| 归档会话 | `useWorkspaces(state => state.archivedSessionIds)` |
| 当前面板 | `usePanelInfo(info => info.activePanelId)` |
| 其他面板条目 | `ctx.slots.entriesOfSlot('sidebar.panellist')` + `ctx.slots.subscribe`（只读别人声明的槽，不注册、不声明） |
| 定时任务 | `ctx.get('remote.schedule')?.catalog()`（可选，失败降级） |
| 插件 | `ctx.get('remote.pluginManager')?.listBundles()`（可选）。用 bundle 列表而非 `pluginInventory/list`：只有它带 `official` 与 `availability`，这是宿主区分「自带 / 用户安装」的结构化依据 |
| 语言 | `ctx.locale.subscribe` 包装成可订阅快照，驱动相对时间文案 |

**已知细节**：`SessionSummary` 没有 `workspaceId`，也没有归档 / 置顶字段。归属工作区靠 `WorkspaceView.sessionIds` 反查；归档靠 `archivedSessionIds` 过滤；置顶是**工作区级**的插件本地概念，宿主无对应字段。

导航动作走注入的 `layout` / `uiWorkspace`：`toggleSidebar()`、`selectPanel(id)`、`openWorkspace(id)`、`openSession(sessionId)`。**`SessionTarget` 是 `SessionId | SubagentAddress`——传裸 id，不要传 `{ kind, sessionId }` 对象**：宿主会把对象当作「没有指定会话」，释放原会话并落回新建会话空态（这正是曾经的会话跳转 bug）。

## 11. 分组规则与置顶

| 段 | 规则 | 排序 |
| --- | --- | --- |
| 置顶项目 | 命中 `pinnedWorkspaceIds` 的工作区 | 置顶顺序（最近置顶在前） |
| 项目 | 其余工作区 | 宿主返回顺序 |
| 最近会话 | 未归档、非空白、非子代理的会话 | `updatedAt` 倒序，`deriveSections` 上限 10 条；浮层底部当前渲染前 5 条 |

- 置顶持久化：`localStorage['dsh.sidebar-rail.v1'] = { pinnedWorkspaceIds: string[] }`，行内图钉按钮切换，写入用合并语义（`{ ...readStore(), ...patch }`）。
- 折叠状态**不再**由插件持久化：宿主自己持有并持久化，插件只读 `data-sidebar-collapsed`。

## 12. 重构中删除的能力

| 能力 | 现状 |
| --- | --- |
| 自绘展开态列（品牌行 / 新会话 / 面板行 / 分组列表 / 设置入口） | 删除。展开态完全交给宿主原生侧栏 |
| native 模式（`nativeExpanded` 开关、声明并渲染 `sidebar` 子槽、停用 `ui-sidebar`） | 删除。`docs/native-mode.md` 一并移除，不得再描述为可选能力 |
| 插件自己的折叠状态持久化（store 里的 `collapsed`、挂载时 `toggleSidebar()` 校正） | 删除。折叠状态归宿主 |
| `openSettings` 命令探测 | 删除。账号 / 更多浮层只给「展开侧栏」，把设置入口交回宿主 |
| `workspaceSessions` 辅助函数 | 删除。会话归属改用 `WorkspaceView.sessionIds` 反查 |

## 13. 容错

| 场景 | 行为 |
| --- | --- |
| 组件渲染抛错 | 自有 `Boundary` 拦截并渲染 `.dsr-fallback` 占位；overlay 条目不会把宿主侧栏或正文拖崩 |
| `remote.schedule` 缺失 / 失败 | 任务浮层显示空态或失败文案 + 「打开面板」 |
| `remote.pluginInventory` 缺失 / 失败 | 插件浮层同上 |
| 标准 hooks 缺失 | `selectorHook` 回退到常量读取器，不会白屏 |
| `localStorage` 不可用 / 内容损坏 | 置顶不持久但界面可用 |
| `apply` 整体异常 | `try/catch` 包住注册，只 `console.error` 一次，宿主侧栏不受影响 |
| 无工作区 / 无会话 | 对应段不渲染；空态文案 |

## 14. 与宿主的边界

- 只 `require` 平台种子模块 `react` 与 `react-dom`，不 `require` 任何宿主 Client 内部包。
- 不注册服务、不加宿主事件类型、不写宿主存储。
- 不修改宿主 DOM 结构与样式：不替换槽、不改宿主列宽、不用 `!important` 覆盖宿主栅格轨、不 toggle 宿主 class；只新增自己的 `<style data-dsh-sidebar-rail>` 与 body 级 portal 节点。
- 读取宿主 DOM 仅两处：`[data-shell-overlay]` 的父元素（定位 frame）及其 `data-sidebar-collapsed`；`<html>` 上的 `data-platform`。

## 15. 样式与可访问性

- 文字：`--dsw-alias-label-primary / secondary / tertiary`；悬停：`--dsw-alias-interactive-bg-hover / active`；浮层底：`--dsw-alias-bg-overlay`；边框：`--dsw-alias-border-l1`（浮层内）/ `--dsw-alias-border-l3`（浮轨右边框）；当前态与展开按钮：`--dsw-specific-sidebar-nav-item-active`；浮轨底色：`--dsw-specific-sidebar-fill`。
- 圆角用 `--dsw-radius-sm`（按钮、行）与 `--dsw-radius-lg`（浮层），阴影用 `--dsw-shadow-lv3`，与宿主 `HoverCard` 的组合一致。这些变量由 `ui-theme`（`styles/base.css`、`styles/gradient-shadow-text.css`，经 `styles.ts` 内联注入）全局提供，但**不在 Theme token 注册表**里，因此 `Theme.listTokens` 查不到它们——不能据此判断变量不存在。仅当变量缺失时才落到括号里的 fallback。
- 几何：浮轨 56px、按钮 36×36、图标 20px、头像 26px、浮层 288px。
- 可访问性：每个图标按钮有 `aria-label`；当前面板用 `aria-current="page"`；浮层 `role="dialog"` + `aria-label`；`Escape` 关闭；`prefers-reduced-motion: reduce` 关闭浮层入场动画。
- 样式作用域统一 `.dsr-*` 前缀，样式节点带 `data-dsh-sidebar-rail` 标记，避免影响其他插件。
