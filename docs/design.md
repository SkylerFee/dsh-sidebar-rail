# dsh-sidebar-rail · 设计说明

> 本文与实现同步维护。验证记录见 [verify.md](verify.md)，需求与验收见 [PRD](PRD.md)。

客户端静态模块的 `window.__ModuleLoader__.load({ id, factory })` 使用完整包名 `@skylerfee/dsh-sidebar-rail` 作为 `id`，与 `package.json.name` 和 bundle patch 的模块 `name` 一致。宿主按该包名导入工厂；不能把注册 ID 改成去掉作用域的短名。`shell.overlay` 条目 ID 和本地存储键仍使用各自已有的值。

## 实现形态：`src/` 源码 → `lib/` 产物

源码在 `src/`，按职责拆成 TypeScript / TSX 模块：`src/index.ts` 是空的 Host 入口，`src/client/index.tsx` 组织 `inject` / `apply`、locale 与两处槽注册，`client/host-adapter.ts` 封装宿主服务调用与公开类型适配，`client/preferences.ts`、`client/locales.ts`、`client/styles.css` 各自独立，`client/model/*` 是不依赖 React 与 DOM 的纯逻辑，`client/hooks/*` 与 `client/components/*.tsx` 承载交互与渲染。依赖方向是「入口 → 适配器与组件 → 模型」，模型不反向依赖入口或 UI。

`scripts/build.mjs` 用 esbuild 只做转换与打包（类型检查由 `tsc --noEmit` 单独负责），生成 `lib/index.js`（ESM，保留空 `apply`）与 `lib/client.js`（单份静态脚本）。后者把包内相对模块静态打进来，再包进一次 `window.__ModuleLoader__.load({ id, factory })`：包装里的 `module` / `exports` 是工厂局部变量，注册阶段不执行插件副作用，工厂经传入的 `require` 取得宿主 `react` / `react-dom` 并返回客户端的 `inject` / `apply`。JSX 用 classic 转换生成 `React.createElement`，运行时不额外请求 `react/jsx-runtime`；CSS 作为文本进入产物，仍由 `apply` 的 effect 创建带 `data-dsh-sidebar-rail` 标记的 `<style>` 并在卸载时删除。

`lib/` 是生成目录，不提交 Git、不手工维护；改完 `src/` 必须 `npm run build`（开发时用 `npm run dev` 的 watch）。发布包内是这份预构建产物，安装者不需要编译器。工具链决定的背景与被取代的旧选择见 [ADR-0006](adr/0006-typescript-source-and-build.md)；下面的章节描述的是设计与约束，不因源码形态改变而改变。

## 1. 定位：增量插件，只补一个状态

宿主在 **macOS Desktop + 侧栏折叠** 时没有折叠图标轨。此时 `AppFrame` 把左侧列折到 0 宽（`const collapsedWidth = drawer || darwin || windowsTitlebar ? 0 : SIDEBAR_COLLAPSED`，`SIDEBAR_COLLAPSED = 56`），列上还有 `overflow: hidden`。本插件添加默认隐藏、按需唤出的 56px 图标轨，不为轨道占用宿主布局空间。

其余状态一律不渲染：

| 状态 | 宿主已有 | 插件行为 |
| --- | --- | --- |
| macOS Desktop 展开态 | 完整原生侧栏（搜索、视图选项、添加工作区、设置座位、账号菜单） | 不渲染任何节点 |
| Web 折叠态 | 宿主自带 56px 折叠轨（`ui-sidebar` 的 `.collapsed` rail 布局） | 不渲染，避免出现第二条轨 |
| Web 展开态 | 完整原生侧栏 | 不渲染 |
| Windows / Linux | 未验证 | 不渲染 |

判据是 `document.documentElement.dataset.platform === 'darwin'`、宿主 frame 带 `data-sidebar-collapsed` 且视口宽度 ≥ 768px，任一不成立就 `return null`。插件**没有设置块**：唯一的设置项（可调最近会话条数）在 0.5.1 被分页取代，`plugins.bundle.config` 的注册与 `RailSettings` 组件一并删除。

## 2. 挂载点：`shell.overlay` list 槽

ui-layout 在 frame 上把 `shell.overlay` 声明为 **`kind: 'list'`、`scope: 'root'`** 的增量座位，专门给「自己的整帧浮动面」用：条目按 `id` 并存，不需要声明 `children`，不会和别的插件抢位。实际注册写法（见 `src/client/index.tsx` 的 `apply`；下面按源码简写，`h` 是 classic JSX 工厂）：

```ts
ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
  name: 'shell.overlay',
  id: 'dsh-sidebar-rail.rail',
  order: 10,
  locale: NS,
  inject: () => face,
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
transform: translateX(-100%);
```

- **默认隐藏**：左缘保留 12px 热区，进入热区或聚焦轨内控件时唤出轨道。宿主折叠态正文抵达窗口左缘，标签行没有为浮轨留位置，因此轨道可见期间仍是临时覆盖层；隐藏后恢复正文入口。热区只负责唤出，指针位置及导航动作决定收起，避免热区被轨盖住时反复触发显隐。
- **为什么必须 portal**：折叠列宽为 0 且 `.sidebarCol { overflow: hidden }`，任何挂在列内的元素都会被裁没。portal 到 `body` 是唯一不被裁剪的面。
- **为什么 top 从 48px 起**：`--dsh-frame-top-clearance` 是宿主声明在**根元素**上的窗口 chrome 带高度（注释明确写了「Declared on the root element rather than the frame so overlays portalled to document.body inherit it too」，macOS 桌面端 48px）。这条带里有：
  - macOS 红绿灯（traffic lights 到 x 68）；
  - 宿主自己挂在 `shell.leading` 的重开 / 新会话控件（`.leadingSeat { top: 11px; left: 88px; z-index: 15 }`，`leadingMounted = drawer || darwin && sidebarCollapsed`）。
  从 48px 起排就同时避开两者；`var(..., 48px)` 的 fallback 保证变量缺失时也不压 chrome。
- **显式 `-webkit-app-region: no-drag`**：Electron 的 app-region 是**几何**而不是 stacking，浮轨盖住窗口拖拽带时必须自己 opt out（即便 body 级 portal 通常已继承 no-drag），否则点图标会拖窗口。
- **窄窗口不渲染**：判定不是 CSS 媒体查询，而是纯函数 `shouldRenderRail(platform, collapsed, viewportWidth)`（阈值 `RAIL_MIN_VIEWPORT = 768`），`RailOverlay` 用 `window.innerWidth` + `resize` 监听驱动；不满足即 `return null`，组件整体卸载。768 = 680（宿主正文最小宽）+ 56（轨宽）+ 32（两侧安全）。为什么不用 CSS：阈值语义是「正文是否还放得下」，与轨自身盒模型无关；做成纯函数还能被单测覆盖边界（`src/client/model/geometry.ts`，由 `test/*.test.ts` 直接导入执行）。为什么不是 900：旧实现的 900 是拍的，与宿主 drawer 断点（768）无对应关系；按 680 正文可读宽推导更可解释。
- **浮层位置**：`.dsr-flyout` 也是 `position: fixed`（portal 到 body），宽 288px，`left = rect.right + 8`。`flyoutPlacement` 根据触发按钮与视口计算顶部或底部距离，并以内联 `maxHeight` 限制剩余可视高度；账号浮层从头像底边向上展开。
- **浮层定高的来历**：0.3.x 曾用「视口 70%」给工作区浮层定高（`workspaceFlyoutHeight` + `WORKSPACE_FLYOUT_VIEWPORT_RATIO`），因为该浮层内容长度差异最大（两条或二十条最近会话）。0.4.0 起改为**从 chrome 带下沿占到底边**（`flyoutSectionedHeight`），两个函数都已不在源码里。定高的目的没变——「显示更多」只让列表变长、交给整体滚动，不改变浮层高度。
- **单一滚动容器（ADR-0007 的形态；票 #11 已落地）**：浮层 body 用 `.dsr-sections` 承载所有分区，整块内容共用一个 `overflow-y:auto` 滚动区。分区（`.dsr-section`）只是「标题行 + 条目组」，**不是滚动单元**，也没有高度上限：内容多就整页一起滚，标题跟着滚走；内容少就没有滚动条。分区之间的分隔线已移除，分组靠标题字重与留白区分。
- **浮层高度仍钉死**：`.dsr-flyout` 的 `height` 由 `flyoutSectionedHeight(innerHeight, topClearance)` 算出（chrome 带之下到底边），不随内容变化。分区收起/展开、列表分页只让滚动内容变短或变长，都不改变面板高度。
- **为什么不再分区独立滚动**：0.4.0 的三段式（固定标题 + 独立滚动 + 1/3 限高）在真机上让列表被切碎、多个滚动条并存，与宿主侧栏「一个列表 + 分组标题」的习惯相反。见 [ADR-0007](adr/0007-single-scroll-flyout.md)。0.4.0 的旧结构（分区 `max-height`、分区 `border-top`、分区独立 `overflow`）已随票 #11 从源码移除，不再存在两套并行的滚动模型。

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

热区的 z-index 为 59，轨道为 60；轨道出现时会覆盖左侧 56px 正文及其点击区域，因此默认隐藏，不能据轨宽较小推断「不会挡住正文交互」。

## 8. 事件、计时与清理

| 交互 | 实现 | 清理 |
| --- | --- | --- |
| 悬停打开 | `pointerenter` 后 120ms（`OPEN_DELAY_MS`）定时器 | `clearTimers()` 卸下两个定时器 |
| 移出关闭 | `pointerleave` 后 200ms（`CLOSE_DELAY_MS`）；浮层 `onPointerEnter: cancelClose`，跨间隙不闪断 | 同上 |
| 轨道显隐 | 12px 热区或轨内焦点唤出；在图标间移动只关闭或切换浮层，导航动作同时收起轨道 | 收起定时器及窗口 `pointermove` 监听随组件清理 |
| Escape | `open !== null` 时挂 `window` keydown，关闭浮层 | effect cleanup 摘除监听 |
| 键盘进入 | 顶部功能图标上按 `↓` / `→`，打开浮层并聚焦首个按钮；浮层内 Escape 关闭并返回触发图标 | 焦点只移到当前浮层节点 |
| 定时任务 / 插件数据 | 每次打开拉取（`idle → loading → ready/failed`），5s 超时或服务不可用进入失败态；Promise resolve 后仍判断 `RemoteResult.ok`。任务列表在**任务浮层与工作区浮层**都会加载：后者的用途是给会话行标定时任务时钟（`useFlyoutList` 的 `when: ['tasks', 'workspace']`），两个入口共用同一份状态，只取一次 | `live` 标记隔离过期结果，清理超时并重置请求标记，切回入口可重试 |
| 账号数据 | 组件挂载后读取登录态；登录时并行读取 profile 与余额，各自保留失败占位。**按 PRD 非目标，不订阅 `account/watch`**，挂载期间切换登录态不会自动刷新，完整信息以宿主账号页为准 | 清理后忽略晚到结果 |
| 槽注册与订阅 | `ctx.effect(...)` 包裹 overlay 注册、locale 字典、panel 条目订阅、locale 订阅 | effect dispose 自动回收 |
| 样式 | `<style data-dsh-sidebar-rail>` 注入 `head` | 卸载时 `style.remove()` |
| 折叠订阅 | 属性限定 MutationObserver | `observer.disconnect()` |

## 9. 卸载恢复

插件卸载 / 禁用后，overlay 注册释放，组件 effect 清理 keydown、pointermove、定时器和 MutationObserver，样式节点与 portal DOM 随之移除。宿主侧栏与正文结构不由插件修改；`localStorage['dsh.sidebar-rail.v1']` 中的置顶与展开项目偏好保留，不写宿主存储。实际卸载验收范围见 [verify.md](verify.md)。

## 10. 数据来源（全部只读）

| 数据 | 来源 |
| --- | --- |
| 会话 | 标准 prop `useSessions(state => state)` → `{ ids, byId }`，`byId[id]: SessionSummary` |
| 工作区 | 标准 prop `useWorkspaces(state => state.items)` → `WorkspaceView[]` |
| 归档会话 | `useWorkspaces(state => state.archivedSessionIds)` |
| 当前面板 | `usePanelInfo(info => info.activePanelId)` |
| 其他面板条目 | `ctx.slots.entriesOfSlot('sidebar.panellist')` + `ctx.slots.subscribe`（只读别人声明的槽，不注册、不声明） |
| 定时任务 | `ctx.get('remote.schedule')?.catalog()`（可选，失败降级）。打开任务浮层或工作区浮层时各取一次；归一化时额外读出 `involvedSessionIds` / `target` / `lastDelivery.targetSessionId` / `status`，供会话行的时钟标记判定，**不新增远程调用** |
| 插件 | `ctx.get('remote.pluginManager')?.listBundles()`（可选）。用 bundle 列表而非 `pluginInventory/list`：只有它带 `official` 与 `availability`，这是宿主区分「自带 / 用户安装」的结构化依据 |
| 账号头像与余额 | `remote.account.getState()` 判登录态；登录后用 `getProfile(metadata)` 与 `getBalance(metadata)` 读取头像、主钱包和赠金钱包；元数据版本取自 `__DSH_BOOT__.release.version` |
| 账号链接 | 宿主账号状态提供的用量及充值地址，只接受绝对 http(s) 链接，使用新窗口打开 |
| 会话状态标识 | 标准 prop `useSessionStatus` 提供会话状态，缺失时仅使用 summary 中可用的运行信息 |
| 定时任务标记 | 由上面同一份任务列表推导：`sessionHasActiveTask(tasks, sessionId)` = 存在 `status === 'active'` 且「涉及」该会话的任务（`involvedSessionIds` 命中，或目标会话就是它）。纯函数在 `model/remote.ts` |
| 语言 | `ctx.locale.subscribe` 包装成可订阅快照，驱动相对时间文案 |

**已知细节**：`SessionSummary` 没有 `workspaceId`，也没有归档 / 置顶字段。归属工作区靠 `WorkspaceView.sessionIds` 反查；归档靠 `archivedSessionIds` 过滤；置顶是**工作区级**的插件本地概念，宿主无对应字段。

导航动作走注入的 `layout` / `uiWorkspace`：`toggleSidebar()`、`selectPanel(id)`、`openWorkspace(id)`、`openSession(sessionId)`。**`SessionTarget` 是 `SessionId | SubagentAddress`——传裸 id，不要传 `{ kind, sessionId }` 对象**：宿主会把对象当作「没有指定会话」，释放原会话并落回新建会话空态（这正是曾经的会话跳转 bug）。

## 11. 分组规则与置顶

| 段 | 规则 | 排序 |
| --- | --- | --- |
| 置顶项目 | 命中 `pinnedWorkspaceIds` 的工作区 | 置顶顺序（最近置顶在前） |
| 项目 | 其余工作区 | 宿主返回顺序 |
| 最近会话 | 未归档、非子代理的会话；空白会话只保留当前那一个 | `updatedAt` 倒序，分页显示：默认 10 条，注意力行自动突破水位，点「显示更多」再 +10 |

- 置顶持久化：`localStorage['dsh.sidebar-rail.v1'] = { pinnedWorkspaceIds: string[] }`，行内图钉按钮切换，写入用合并语义（`{ ...readStore(), ...patch }`）。展开的项目存在同一键的 `expandedProjectIds`（0.5.0 起），写入同样走合并语义，两个字段互不覆盖。
- 列表分页是组件内状态，不落盘：基础 `PAGE_SIZE = 10`，自动提升上限 `PAGE_SIZE_AUTO_MAX = 50`，只升不降，浮层 `dismiss` / `retract` 时复位。实现见 `hooks/use-flyout.ts`（水位控制器）与 `model/workspaces.ts`（`watermarkSlice` / `requiredWatermark`），照抄宿主 `WorkspaceBrowser` 的同名机制。
- 折叠状态**不再**由插件持久化：宿主自己持有并持久化，插件只读 `data-sidebar-collapsed`。

## 12. 重构中删除的能力

| 能力 | 现状 |
| --- | --- |
| 自绘展开态列（品牌行 / 新会话 / 面板行 / 分组列表 / 设置入口） | 删除。展开态完全交给宿主原生侧栏 |
| native 模式（`nativeExpanded` 开关、声明并渲染 `sidebar` 子槽、停用 `ui-sidebar`） | 删除。`docs/native-mode.md` 一并移除，不得再描述为可选能力 |
| 插件自己的折叠状态持久化（store 里的 `collapsed`、挂载时 `toggleSidebar()` 校正） | 删除。折叠状态归宿主 |
| `openSettings` 命令探测 | 删除。账号 / 更多浮层只给「展开侧栏」，把设置入口交回宿主 |
| `workspaceSessions` 辅助函数 | 删除。会话归属改用 `WorkspaceView.sessionIds` 反查 |
| 可调的最近会话条数（`recentCount`）、浮层底部步进器、插件详情页设置块 | 删除（0.5.1）。改为分页：`PAGE_SIZE = 10` + 「显示更多」，注意力行自动突破水位；`RailSettings` 组件与 `plugins.bundle.config` 注册一并移除 |

## 13. 容错

| 场景 | 行为 |
| --- | --- |
| 组件渲染抛错 | 自有 `Boundary` 拦截并渲染 `.dsr-fallback` 占位；overlay 条目不会把宿主侧栏或正文拖崩 |
| `remote.schedule` 缺失 / 失败 | 任务浮层显示失败文案 + 「打开面板」，成功空列表另显示空态；工作区浮层里则只是**不显示定时任务时钟**，会话列表照常渲染 |
| `remote.pluginManager` 缺失 / 失败 | 插件浮层同上 |
| 头像或余额不可用 | 头像使用占位；主钱包不可用显示「余额暂不可用」；账号完整信息留给宿主账号页 |
| 标准 hooks 缺失 | `selectorHook` 回退到常量读取器，不会白屏 |
| `localStorage` 不可用 / 内容损坏 | 置顶与项目展开不持久但界面可用（分页状态本就不落盘） |
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
- 可访问性：每个图标按钮有 `aria-label`；当前面板用 `aria-current="page"`；浮层 `role="dialog"` + `aria-label`；顶部功能图标支持方向键进入浮层，浮层内 Escape 返回触发按钮；`prefers-reduced-motion: reduce` 关闭浮层入场与轨道滑动动画。实现支持不等于完整键盘路径已验收，具体结果见 [verify.md](verify.md)。
- **会话行首那一格**（`.dsr-row-mark`，16×16）：定时任务时钟与状态点**互斥**——只有该行状态为 `idle` 且存在活跃定时任务时才画时钟，否则画状态点。时钟 SVG 自绘（16px 视框、`stroke-width: 1`、`currentColor`，照抄宿主 `clock-outline` artwork），不 import 宿主包；图标 `aria-hidden`，含义由 `.dsr-visually-hidden` 文本送达读屏。点击时钟 `stopPropagation`，不触发行的打开。
- 样式作用域统一 `.dsr-*` 前缀，样式节点带 `data-dsh-sidebar-rail` 标记，避免影响其他插件。