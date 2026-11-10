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

关键含义（0.5.0 起）：分区**只是分组，不是滚动单元**。整个浮层共用一个滚动容器，分区标题随内容一起滚动（[ADR-0007](docs/adr/0007-single-scroll-flyout.md)）。这与 0.4.0 的「固定标题 + 独立滚动」相反——那次结构已被实测否决。

分区收起/展开不影响浮层总高度：浮层高度由「chrome 带之下到底边」钉死，只随窗口变化。

## 工作区三分区 three workspace sections

工作区浮层固定为三个分区，顺序不变：

| 分区 | 内容 | 来源 |
| --- | --- | --- |
| **置顶** | 被置顶的项目 | 插件本地 `pinnedWorkspaceIds` |
| **项目** | 其余全部项目 | 宿主工作区列表，宿主顺序 |
| **最近会话** | 全部工作区里的最近会话 | 宿主会话列表，`updatedAt` 倒序 |

一个项目**只会出现在其中一处**：置顶了就从「项目」区移走。三个分区都可展开/收起，收起状态**不持久化**（每次打开浮层都是全展开）。

> 「置顶」在本仓库特指**置顶项目**。宿主另有会话级置顶（`pinSession`，数据在 `useWorkspaces().pinnedSessionIds`），本插件**不使用**它。

## 项目行展开 project row expansion

项目行左侧的展开箭头，展开后显示该项目下的会话列表。

- 排序用宿主顺序，**不限条数**（不像「最近会话」受 `recentCount` 限制）。
- **不过滤**：归档、空白、子代理会话都列出，与「最近会话」的过滤规则不同——这里要的是「这个项目里到底有什么」。
- 没有会话时**仍可展开**，展开后显示空态文案。
- 展开状态**不持久化**。

## 新建会话按钮 new-session action

项目行右侧的按钮，点击后在该项目下新建一个空会话并跳过去，同时收起浮层。调用宿主公开的 `uiWorkspace.startSession(workspaceId)`。

## 添加项目 add-project action

「项目」分区标题行右侧的按钮。点击后调用宿主公开的 `pickDirectory()` 弹出系统目录选择器，选定后经 `workspaces.create({ path })` 登记为项目。

**只登记，不跳转、不建会话**——与宿主原生添加工作区的行为对齐。

## 任务分区 task sections

定时任务浮层固定为三个分区，对应宿主 `ScheduleStatus` 枚举：

| 分区标题 | 宿主状态 |
| --- | --- |
| **进行中** | `active` |
| **已暂停** | `paused` |
| **已结束** | `ended` |

数据源是 `remote.schedule.catalog()`——它返回**全部状态**的任务（`entries()` 不做状态过滤）。某类为空时保留标题并显示空态文案。

默认只展开「进行中」。点击任务条目打开定时任务面板，**无法定位到具体那一条**：宿主把选中任务存在 `TaskManagerPage` 内部的 `useState` 里，没有公开 API 可从外部设置。

## 插件分区 plugin sections

插件浮层固定为两个分区：

| 分区标题 | 判据 |
| --- | --- |
| **已启用** | `enabled === true` |
| **未启用** | `installed === true && enabled === false` |

「未启用」**只包含已安装但被关闭的包**，不列尚未安装的官方按需插件（`availability === 'missing'` 的那些）。数据源同样是 `pluginManager/listBundles`。

点击条目打开插件管理面板。
