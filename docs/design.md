# dsh-sidebar-rail · 设计说明

> 本文与实现同步维护。验证记录见 `docs/verify.md`。

## 1. 为什么"替换"而不是"追加"

`sidebar` 是 `kind: 'single'` 槽，占用者是 `ui-sidebar` 的 `SidebarRoot`：

> registering here replaces the navigation column outright rather than adding to it, and the seats it declares disappear with it.

- **追加式**（`sidebar.panellist` / `sidebar.footer.action` / `shell.overlay`）只能加图标，**改不了折叠轨的排布，也给图标加不了悬浮浮层**——轨的 Markup 属于外壳。
- **替换式**（注册进 `sidebar`）才能接管折叠态。

## 2. 三条硬约束（决定了实现形态）

| 约束 | 事实 | 后果 |
| --- | --- | --- |
| **不能声明 `children`** | `ui-sidebar` 已声明那 7 个子槽；重复声明抛 `slot "x" is already declared`（ui-slots `index.ts:1256-1264`） | 本插件不声明任何子槽 → **拿不到 `renderSlot`** → 展开态的列表必须自绘 |
| **静态包必须显式 priority** | 走 `__ModuleLoader__` 不受动态守卫的优先级分配 | 注册时写 `priority: -1` 才能赢过同槽的 shipped entry |
| **折叠态列宽可能为 0** | `collapsedWidth = drawer \|\| darwin \|\| windows-titlebar ? 0 : 56` | 浮层必须 `createPortal(document.body)` + `position: fixed`，不能挂在列内 |

## 3. 组件结构

```
SidebarRailRoot  (注册进 sidebar，priority: -1，不声明 children)
├─ props: collapsed / width / drawer
│         + useSessions / useWorkspaces / usePanelInfo（框架白送的标准 hooks）
│         + inject face: toggleSidebar / selectPanel / startSession
│                       / openWorkspace / openSession / panels / locale
│                       / scheduleCatalog / pluginInventory / openSettings
├─ collapsed → <Rail/>
│     4 个功能按钮（工作区 / 定时任务 / 插件 / 更多）+ 底部头像
│     + 按需渲染的浮层（portal 到 body）
└─ !collapsed → <Wide/>
      品牌行 → 新会话按钮 → 面板行 → 分组列表（置顶项目/项目/最近会话）→ 底部设置
```

## 4. 数据来源（全部只读）

| 数据 | 来源 |
| --- | --- |
| 会话 | 标准 prop `useSessions(state => state)` → `{ ids, byId }`，`byId[id]: SessionSummary` |
| 工作区 | 标准 prop `useWorkspaces(state => state.items)` → `WorkspaceView[]` |
| 归档会话 | `useWorkspaces(state => state.archivedSessionIds)` |
| 当前面板 | `usePanelInfo(info => info.activePanelId)` |
| 导航面板条目 | `ctx.slots.entriesOfSlot('sidebar.panellist')` + `subscribe`（与 shipped 外壳同源） |
| 定时任务 | `ctx.get('remote.schedule')?.catalog()`（可选，失败降级） |
| 插件 | `ctx.get('remote.pluginInventory')?.list()`（可选，失败降级） |
| 语言 | `ctx.locale.subscribe` 包装成可订阅快照，驱动 `相对时间` 文案 |

**已知细节**：`SessionSummary` 没有 `workspaceId`，也没有归档/置顶字段。归属工作区靠 `WorkspaceView.sessionIds` 反查；归档靠 `archivedSessionIds` 过滤；置顶是**工作区级**的本地概念，宿主无对应字段。

## 5. 分组规则

| 段 | 规则 | 排序 |
| --- | --- | --- |
| 置顶项目 | 命中 `localStorage.pinnedWorkspaceIds` 的工作区 | 置顶时间倒序 |
| 项目 | 其余工作区 | 宿主返回顺序 |
| 最近会话 | 全部未归档、非空白、非子代理的会话 | `updatedAt` 倒序，取前 10 |

折叠态浮层展示三段；展开态在列表区展示三段（项目行下挂各自的会话）。

## 6. 持久化

`localStorage['dsh.sidebar-rail.v1'] = { collapsed: boolean, pinnedWorkspaceIds: string[] }`

- 折叠态在 `collapsed` prop 变化时写入；置顶在点击时写入。
- 挂载后读一次；与框架状态不一致时调用一次 `ctx.layout.toggleSidebar()` 校正（`restoredRef` 保证只执行一次）。
- 不写宿主：DSH 的 panel geometry 明确是瞬态的（`ui-layout` README），置顶工作区也不是宿主概念。

## 7. 样式与可访问性

- 只用 `--dsw-alias-*` / `--dsw-radius-*` 主题 token，无硬编码颜色。
- 轨道 56px、按钮 36×36、图标 20px、圆角 `--dsw-radius-md`。
- 每个图标按钮有 `aria-label`；当前面板用 `aria-current="page"`；浮层 `role="dialog"` + `aria-label`；`Escape` 关闭。
- `prefers-reduced-motion: reduce` 时关闭浮层入场动画。
- 样式通过 `ctx.effect` 注入 `<style data-dsh-sidebar-rail>`，卸载时移除。

## 8. 容错

| 场景 | 行为 |
| --- | --- |
| 组件抛错 | 自有 `Boundary` 拦截并渲染占位；**不让 entry 崩溃**（崩溃会 abdicate 出该 cell，shipped 侧栏会突然回来） |
| `remote.schedule` 缺失 | 任务浮层显示空态 + "打开面板"入口 |
| `remote.pluginInventory` 缺失 | 插件浮层同上 |
| 设置命令不可用 | 提示"请展开侧栏后从底部进入设置" |
| 无工作区/无会话 | 对应段不渲染；空态文案 |

## 9. 与宿主既有实现的边界

- 不 require 任何宿主 Client 包（`react` / `react-dom` 除外，二者是平台种子模块）。
- 不读写宿主 DOM（浮层用 portal，位置由按钮 `getBoundingClientRect` 决定）。
- 不注册服务、不加宿主事件类型、不写宿主存储。

## 10. 已知偏差（相对"完全还原 DSH 展开态"）

由于不能声明子槽（约束 1），展开态**无法复用宿主的工作区浏览器**，改由本插件自绘列表。因此展开态保留了 DSH 的信息架构（品牌→新建→面板→列表→设置）与分组能力，但少了宿主浏览器的若干交互：搜索、Show more 折叠、拖拽排序、行内重命名/Fork/归档菜单。

**升级路径**（若要完全还原）：把 `ui-sidebar` 这一行在 profile patch 里 `disabled: true`，使它的声明消失，本插件即可声明并渲染 `sidebar.workspaces`，直接复用宿主浏览器。代价是需要同时接管 `shell.leading` 等座位，风险更高，故 v1 不做。
