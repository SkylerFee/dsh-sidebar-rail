# 术语表

本仓库统一用词。写 issue、spec、ticket、测试名、代码命名时，用这里的词，不要换同义词。

## 轨 rail / sidebar

- **sidebar**：宿主的左侧导航列，归宿主所有（`ui-sidebar` 是它的占用者）。侧栏的展开/折叠状态、宽度、内部座位都由宿主决定。
- **rail（轨）**：本插件在 macOS 折叠态补出来的 56px 图标条。**它不是 sidebar，也不是 sidebar 的替代品**——它浮在 frame 之上，只出现在宿主折叠、且视口够宽的时候。

用错的表现：把 rail 说成「侧栏」、或在文档里暗示插件接管了 sidebar。

## 浮层 flyout

悬停轨上某个图标后弹出的列表面板（`.dsr-flyout`）。它是 `role="dialog"` 的浮层：120ms 悬停打开、移出 200ms 关闭、`Escape` 关闭。

**不是** modal（不阻塞页面）、**不是** dropdown（不依附于表单控件）、**不是** popover 里的菜单项集合。

## 折叠 collapsed

宿主侧栏处于收起状态。判定依据是宿主发布在 frame 元素上的 `data-sidebar-collapsed` 属性。

**折叠状态归宿主**：插件只读，不持久化、不在挂载时纠正。本仓库里说「折叠态」时，指的是宿主的状态，不是插件自己的开关。

## 浮层座位 overlay seat

`shell.overlay` 槽——ui-layout 声明的 frame 级 `list` 槽，宿主用来放全局浮动表面（toast、菜单、本插件的轨）。条目自带 `id`、`order`，彼此并列而非替换。

关键含义：注册进这个座位是**增量**的，不需要声明 `children`，也不会抢占宿主已有的 UI。轨就挂在这里（`id: 'dsh-sidebar-rail.rail'`）。

## 我的插件 my plugins

插件浮层里列出的条目：**用户自己安装并启用**的 bundle。判据是宿主 bundle 列表里的

```
enabled === true && official !== true && installed !== false && availability !== 'installation'
```

`official` 单独不够：宿主自带的 `@deepseek-ai/dsh-base`、`dsh-web-app` 不在官方目录里，`official` 为 false，靠 `availability === 'installation'` 才能区分。包名 `@deepseek-ai/` 只作兜底启发式。

数据源必须是 `pluginManager/listBundles`（只有它带 `official`/`availability`）；`pluginInventory/list` 是 Loader 条目视图，这两个字段都没有。

## 当前会话 current session

主视图正在显示的那个会话。宿主在 `ui-session` 与 `ui-workspace` 里都用 `retainedBy.mainView > 0` 判定，插件跟随同一判据，避免两个界面各说各话。

注意：这个计数由宿主维护，插件不自己 `retain(source:'mainView')` 造选中态。Desktop `0.2.2-rc.1` 上实测该计数在读时为 0（宿主侧栏同样不高亮），此时插件也不高亮——**两边一起不亮**是正确的一致行为。

## 分区 section

浮层内部的一级分组，由一个标题行加一组条目组成；可展开/收起，收起时内容卸载。0.4.0 起每个浮层都按分区组织。

关键含义：分区**只是分组，不是滚动单元**。整个浮层共用一个滚动容器，分区标题随内容一起滚动（[ADR-0009](docs/adr/0009-flyout-scroll-and-height.md)）。这与更早的「固定标题 + 独立滚动」相反——那次结构已被真机实测否决。

分区收起/展开只让内容变短：浮层高度随锚点与内容，由 `maxHeight` 封顶，因此内容跨过边界时面板会变矮——它**不是**钉死的固定高度（[ADR-0009](docs/adr/0009-flyout-scroll-and-height.md)）。

## 工作区三分区 three workspace sections

工作区浮层固定为三个分区，顺序不变：

| 分区 | 内容 | 来源 |
| --- | --- | --- |
| **置顶** | 被置顶的项目 | 插件本地 `pinnedWorkspaceIds` |
| **项目** | 其余全部项目 | 宿主工作区列表，宿主顺序 |
| **最近会话** | 全部工作区里的最近会话（空白会话只保留当前那个） | 宿主会话列表，`updatedAt` 倒序，分页显示 |

一个项目**只会出现在其中一处**：置顶了就从「项目」区移走。三个分区都可展开/收起，收起状态**不持久化**（每次打开浮层都是全展开）。

> 「置顶」在本仓库特指**置顶项目**。宿主另有会话级置顶（`pinSession`，数据在 `useWorkspaces().pinnedSessionIds`），本插件**不使用**它。

## 项目行展开 project row expansion

项目行左侧的展开箭头，展开后显示该项目下的会话列表。

- 排序用宿主顺序，但**分页显示**（见「分页」）：默认 10 条，点「显示更多」再加载 10 条；需要引起注意的行会突破水位自动显示。
- **子代理会话不列出**：与宿主 `sessionVisible` 一致。宿主那条规则的第一步就是 `origin === 'subagent'` 即不可见，而且它**对工作区成员同样生效**——子代理子会话继承父会话的 `cwd`，工作区启动回填按 `cwd` 归组时会把它们一并写进 `sessionIds`，所以不能假设它们天然不在里面。
- **归档仍不过滤**：归档的会话照常列出，只是额外标注「已归档」。**空白会话只保留当前那一个**——同样照抄宿主 `sessionVisible`：`blank && id !== current` 的会话不渲染，真实数据不删除。
- **状态标记与最近会话区同源同判定**：运行中 / 有待操作 / 已完成未读 / 空闲四种，同一个会话在两个列表里不能有两个说法。位置在行尾（规格原写行首，实际渲染在行尾，按既有裁决如实记录）。归档行与空白行行尾留空（宿主 `Rows.tsx` 的 `!archived && !blank` 规则）。
- **项目行也有状态标记**：取旗下会话里**最值得注意**的那一个（待操作 > 运行中 > 已完成未读），归档会话不参与。宿主在项目层级不聚合状态（`GroupNode` 只有 `containsCurrent`），这一格是本插件补的；文案用「旗下有会话…」而不是会话行的「运行中」，避免读屏把项目本身读成在跑。位置在**行尾固定槽**（新建会话按钮之前）——与会话行把标记放在行尾同理；固定在此让标题拿到整行可伸缩宽度，项目名只在真正放不下时才省略。idle 时整个槽不渲染，安静的行不会多出空隙。
- 没有会话时**仍可展开**，展开后显示空态文案。
- 展开状态**持久化**在 `localStorage['dsh.sidebar-rail.v1']` 的 `expandedProjectIds`。

## 分页 paging / 水位 watermark

会话列表一次不全部渲染，而是按「水位」切出一段显示。

- 基础水位 **`PAGE_SIZE = 10`**：一屏默认 10 条**非空白**会话；空白会话恒显示且不占名额。
- 自动提升上限 **`PAGE_SIZE_AUTO_MAX = 50`**：注意力行会把水位顶高，让它们不至于被挡在「显示更多」之后；上限之外只剩手动加载。**注意力行的判据两个列表相同**：运行中 / 有待操作 / 已完成未读 / 当前会话，与宿主对每个列表用同一套判定一致。
- **只升不降**：水位在同一份浮层打开期间不会回落；**浮层关闭时重置**，下次打开又从 10 条开始；不落盘。
- 「显示更多」= 在当前**有效**水位上再 `+ PAGE_SIZE`；没有剩余可显示的行时按钮**不渲染**（不是禁用）。
- 作用范围：最近会话区，以及每个项目各自的展开列表；每个列表独立计数（最近会话固定键 `recent`，项目用 `project:<workspaceId>`）。
- 机制照抄宿主 `WorkspaceBrowser` 的 `watermarkRows` / `requiredWatermark`。**两个列表的注意力判据一致**（运行中 / 有待操作 / 已完成未读 / 当前会话），与宿主对每个列表用同一套判定的做法相同。与宿主的一处有意差异：自动提升不考虑 `runningSubagentCount`（需要子代理投影，按 PRD 属于非目标）。

**不要**把分页说成「最近会话条数设置」——那个可调的 `recentCount` 偏好已在 0.4.0 整项移除，也没有对应的设置块或步进器。

## 新建会话按钮 new-session action

项目行右侧的按钮，点击后在该项目下新建一个空会话并跳过去，同时收起浮层。调用宿主公开的 `uiWorkspace.startSession(workspaceId)`。

## 添加项目 add-project action

「项目」分区标题行右侧的按钮。点击后调用宿主公开的 `pickDirectory()` 弹出系统目录选择器，选定后经 `workspaces.create({ path })` 登记为项目。

**只登记，不跳转、不建会话**——与宿主原生添加工作区的行为对齐。

**已知缺陷：选择器标题是英文。** 底层是宿主用 `osascript` 调起的 `NSOpenPanel`，标题取自宿主硬编码的字符串 `Select Workspace Directory`（`@deepseek-ai/dsh-host-directory-picker-native`）。`NSOpenPanel.message` 是自定义字段，AppKit 不做本地化，所以标题恒为英文、而面板按钮跟随系统语言。插件**无法绕过**：纯 Client 模块没有 Node 权限，不能自己 `spawn` 一个选择器。这是宿主侧的本地化缺口，不是本插件的待办。

## 任务分区 task sections

定时任务浮层固定为三个分区，对应宿主 `ScheduleStatus` 枚举：

| 分区标题 | 宿主状态 |
| --- | --- |
| **进行中** | `active` |
| **已暂停** | `paused` |
| **已结束** | `ended` |

数据源是 `remote.schedule.catalog()`——它返回**全部状态**的任务（`entries()` 不做状态过滤）。某类为空时保留标题并显示空态文案。

默认只展开「进行中」。点击任务条目打开定时任务面板，**无法定位到具体那一条**：宿主把选中任务存在 `TaskManagerPage` 内部的 `useState` 里，没有公开 API 可从外部设置。

## 定时任务标记 scheduled-task mark

会话行行首那个时钟图标，表示「这个会话有活跃的定时任务」。照抄宿主 `ui-schedule` 的 `SessionScheduleMark`。

- **位置**：行首 16px 格，与状态点**争同一格**。
- **互斥**：仅当该行自身状态为 `idle` 时才显示时钟；运行中、有待操作（审批）、已完成未读时那一格让给状态点，时钟不挂载。
- **「活跃」只算 `status === 'active'`**：暂停与已结束的任务不显示标记（宿主注释：只有 active 有定时器义务）。
- **「涉及」判定**：`task.involvedSessionIds` 含该会话，或该任务的目标会话就是它（`target.kind === 'new'` 时看 `lastDelivery.targetSessionId`，否则看 `target.sessionId`）。两者都要查。
- **点击不激活会话**：图标在行按钮内部，点击 `stopPropagation`。
- 数据源是现有的 `remote.schedule.catalog()`，不新增远程调用；工作区浮层打开时也会取一次任务列表，失败或超时则**不显示标记**，不阻塞会话列表。

## 插件分区 plugin sections

插件浮层固定为两个分区：

| 分区标题 | 判据 |
| --- | --- |
| **已启用** | `enabled === true` |
| **未启用** | `installed === true && enabled === false` |

「未启用」**只包含已安装但被关闭的包**，不列尚未安装的官方按需插件（`availability === 'missing'` 的那些）。数据源同样是 `pluginManager/listBundles`。

点击条目打开插件管理面板。