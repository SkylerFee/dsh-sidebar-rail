# 0.5.1 需求：会话列表的分页、空会话规则与定时任务标记

> 状态：需求已确认（6 项决策已定），待实现
> 来源：2026-11-10 真机核验 0.5.0 后提出的三项优化
> 前置：[spec-0.5.0](spec-0.5.0-native-parity.md)、[ADR-0007](adr/0007-single-scroll-flyout.md)

## 1. 背景

0.5.0 落地后真机核验「逻辑基本正确」，但三处与宿主不一致或不够好用：

1. **空会话全都露出来**。项目展开时，所有空白会话（`blank === true`）都会列出。宿主的规则其实是「空白会话里只显示当前那一个」——我们完全没过滤。
2. **最近会话条数是可调设置**，默认 5、范围 1–20，且浮层底部有个步进器、插件详情页还有个设置块。实际使用中调这个数字价值很低，而「先看 10 条、不够再加载」更符合浏览习惯。
3. **被定时任务使用的会话没有标记**。宿主在侧栏行首用时钟图标标出「这个会话有活跃的定时任务」，我们没有。

## 2. 已确认决策

| # | 问题 | 决策 |
| --- | --- | --- |
| 1 | 空会话怎么处理 | **照抄宿主**：只隐藏「非当前」的空白会话。当前打开的那个空会话保留。不删除真实数据。 |
| 2 | 「显示更多」作用范围 | **最近会话区 + 每个项目的展开列表**都用同一套分页。 |
| 3 | 设置项移除范围 | **两处都移除**：浮层底部步进器与插件详情页设置块。设置块因此没有内容，连 `plugins.bundle.config` 的注册一起移除。 |
| 4 | 时钟图标数据源 | **复用现有 `remote.schedule.catalog()`**，扩展归一化读出 `involvedSessionIds` / `target` / `status`，不新增远程调用。 |
| 5 | 时钟图标位置 | **完全照抄宿主**：行首 16px 格，且仅当行自身状态为 idle 时显示（状态点与时钟互斥）。 |
| 6 | 分支 | 继续在 `refactor/typescript-migration`。 |

## 3. 需求一：空会话可见性（照抄宿主）

### 宿主的规则（tree.ts `sessionVisible`）

```
if (session.origin === 'subagent') return false
if (session.blank && session.id !== current) return false
```

即：空白会话中**只有当前那一个**可见。当前 = 主视图正在显示的会话。

### 我们要做的

- 项目展开的会话列表（`projectSessionRows`）：加上同样的过滤。当前的空会话保留，其余空会话隐藏。
- 最近会话区（`deriveSections`）：当前是 `entry.blank === true` 就全部跳过，改为同样保留当前那一个。
- 「当前」的判定复用现有 `currentSessionId()`（读 `retainedBy.mainView > 0`），不新增判据。
- **不删除任何真实数据**。只是不渲染。

### 与既有文档的冲突（必须一并更新）

`GLOSSARY.md` 第 75 行写的是「**不过滤**：归档、空白、子代理会话都列出」，`spec-0.4.0` 的 B5 也这么写。本次起**空白会话不再全列**，这两处要与实现同步改，并说明是宿主规则而非我们的取舍。

## 4. 需求二：分页（默认 10 条 + 显示更多）

### 规则

- 默认显示 **10** 条（原 `DEFAULT_RECENT_COUNT = 5` 改为 10，且不再可调）。
- 列表底部有「显示更多」按钮，点击再加载 **10** 条。
- 已全部显示时，按钮**不渲染**（不是禁用）。
- 浮层每次隐藏时，分页状态重置回 10 条。
- 作用范围：最近会话区 **和** 每个项目的展开列表，各自独立计数。

### 需要删除的东西

- `recentCount` 这个偏好：`preferences.ts` 的读写、`subscribeRecentCount` / `setRecentCount` / `getRecentCountSnapshot`。
- `MIN_RECENT_COUNT` / `MAX_RECENT_COUNT` / `RECENT_LIMIT` 常量。
- `RecentCountRow` 组件（primitives.tsx）与浮层底部的步进器（flyouts.tsx）。
- `RailSettings.tsx` 整个组件，以及 `client/index.tsx` 里 `plugins.bundle.config` 的注册。
- 相关 i18n 键：`settings.title` / `settings.recentCount` / `settings.recentCountHint`。

### 新增的分页状态

- 组件内 state：每个列表的当前可见条数，初值 10。
- 浮层关闭（`dismiss` / `retract`）时重置（与 `foldedSections` 同一生命周期）。
- **不持久化**：每次打开都是 10 条。

### 需要新增的 i18n 键

- `action.showMore`：「显示更多」/「Show more」

## 5. 需求三：定时任务会话的时钟标记（照抄宿主）

### 宿主机制

宿主 ui-schedule 的 `SessionScheduleMark` 挂在 `sidebar.session.row.leading` 槽，规则：

```
hasActive = catalog 中该会话的活跃任务数 > 0
活跃 = status === 'active'
涉及 = task.involvedSessionIds.includes(sessionId) || taskSessionId(task) === sessionId
其中 taskSessionId = target.kind === 'new' ? lastDelivery?.targetSessionId : target.sessionId
```

显示位置：行首 16px 格，**仅在行自身状态为 idle 时**。有审批请求、未读、运行中时那一格让给状态点，时钟不挂载。

标记是 `<IconClockOutlineRegular size={14} />`，点击 `stopPropagation` 不触发行的打开。

### 我们要做的

- 扩展 `normalizeTasks` 的归一化：额外读出每个任务的 `involvedSessionIds`、`target`、`lastDelivery.targetSessionId`、`status`。
- 新增纯函数：给一个 `sessionId` 与任务列表，返回「是否有活跃任务」。放在 `model/remote.ts` 或新建 `model/schedule.ts`。
- 行渲染：行首 16px 格；若该会话有活跃任务**且**行状态为 `idle`，显示时钟图标；否则显示状态点（现有 `StateMark`）。
- 自绘时钟 SVG（不能 import 宿主 ui-primitives），形状照抄宿主 `clock-outline` artwork。
- 点击 `stopPropagation`。
- 无数据时（catalog 未取到）不显示标记，不报错。

### 数据时机

任务 catalog 目前只在打开任务浮层时加载。要在会话行显示标记，需要在**工作区浮层打开时也取一次**。这是一个新的加载时机，需明确：
- 复用 `useFlyoutList` 的 `when` 机制，把 `tasks` 列表的 `when` 从 `'tasks'` 改为 `['tasks', 'workspace']`。
- 失败或超时时**不显示标记**（不阻塞会话列表渲染）。

## 6. 受影响的既有规则

| 规则 | 现状 | 本次变化 |
| --- | --- | --- |
| 项目会话不限条数 | GLOSSARY / spec-0.4.0 B5 明确写「不限条数」 | **改为分页**（10 + 10）。需同步改文档。 |
| 项目会话不过滤 blank | GLOSSARY 第 75 行 | **改为只保留当前空会话**。需同步改文档。 |
| recentCount 可调 1–20 | PRD US-9 / A2 / A14、README | **整项移除**。需同步改 PRD、README 双语、GLOSSARY。 |
| 设置块注册到 plugins.bundle.config | AGENTS 硬约束 2 | 设置块删除后**不再注册**。硬约束 2 的表述需调整（只说 shell.overlay）。 |

## 7. 测试决策

- 空会话过滤：`projectSessionRows` 与 `deriveSections` 各补用例——当前空会话保留、非当前空会话隐藏。
- 分页：纯函数化的 `visibleSlice(rows, limit)` 或等价逻辑需有边界用例（正好 10、11 条、0 条）。
- 时钟标记：`sessionHasActiveTask(tasks, sessionId)` 的纯函数用例——活跃/暂停/已结束、target kind 两种、involvedSessionIds 命中、无数据。
- 移除项：删除所有 recentCount 相关用例；确认 i18n 键删除后字典仍对齐。
- 真机：三项都要在 Desktop 确认（尤其时钟标记的位置与互斥行为）。

## 8. 不在范围内

- 不改分区结构、整体滚动、视觉 token（0.5.0 已定）。
- 不删除任何真实会话数据。
- 不做「已显示全部」之外的折叠/展开控件。
- 不新增远程服务调用。

## 9. 开放问题（实现时再定）

1. 项目列表分页与「置顶项目/项目/最近会话」三分区的关系：分页按钮放在项目展开区域内（作为该项目的子元素），还是放在分区底部？**倾向后者不对**——项目是独立的，分页按钮应紧跟该项目的会话列表。
2. 多个项目同时展开时，各自独立分页还是共享计数？**倾向前者**（各自独立）。
3. 时钟标记与 `status.warning` 的优先级：宿主是「非 idle 就不显示时钟」，我们照抄，因此 warning 时无时钟。确认这符合预期。
