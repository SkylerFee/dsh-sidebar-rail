# 0005 分区功能只走宿主公开 API，无法定位到单条任务时就退为打开面板

- 状态：已采纳（2026-11-09）
- 相关：`client.js` 的任务/插件/项目相关交互、`.agents/notes/` 未采用的契约外做法

## 背景

0.4.0 的需求里有几项看起来「宿主应该能直接做」，逐个核实后发现公开面并不覆盖全部。设计阶段把每条都查到了源码级，避免实现到一半才发现走不通，也避免为了「功能完整」去用契约外接口。

查证结果：

| 想要的 | 宿主公开能力 | 结论 |
| --- | --- | --- |
| 项目中新建会话 | `uiWorkspace.startSession(workspaceId)` | 可用（**返回 void，拿不到新 id**；需要 id 时用 `connectWorkspace`） |
| 添加项目 | `pickDirectory()` + `workspaces.create({ path })` | 可用，但见下方「pickDirectory 的两条路径」 |
| 项目下的会话 | `WorkspaceView.sessionIds` 已在数据里 | 可用（已是宿主过滤后的结果，见下） |
| 任务按状态分区 | `remote.schedule.catalog()` 返回全部状态（内部 `entries()` 只 map+sort，不按状态过滤） | 可用 |
| 插件分区 | `pluginManager/listBundles` 每项带 `enabled` / `installed` | 可用 |
| **定位到单条任务详情** | ❌ 选中任务存在 `TaskManagerPage` 内部的 `useState(selectedId)`；`selectPanel` 只能开面板不能传参；`openRightbar(track, fullscreen)` 不能指定 tab；`openTaskDetail` 只在 ui-schedule 内部组件间流转 | **不可用** |
| **打开设置面板** | ❌ 见 0.3.1 的结论：`settings.launcher` 是 single 槽且被宿主账号插件独占 | **不可用** |

## 决定

1. **功能只依赖上表「可用」一列的公开 API**，不读宿主内部 store、不 `entriesOfSlot(...).inject()` 偷 props、不改宿主 `packages/*`。
2. **任务条目点击退为「打开定时任务面板」**，不做「定位到这一条」。面板内部本来就有详情，只是不能自动选中。这与 0.3.1 处理「设置入口」的方式一致：能力不可达时，把路径给清楚，而不是硬凑。
3. 插件的启用状态**只读展示**，不在浮层内提供开关。写操作要处理审批、失败恢复与重启提示，收益不抵复杂度；宿主插件管理页已经完整。
4. 「未启用」分区**只列 `installed && !enabled`**，不列尚未安装的官方按需插件——后者点了要触发安装流程，属于另一类操作。

## 三条容易踩错的细节（实现前务必知道）

### `pickDirectory()` 有两条路径，Desktop 走的是另一条

`uiWorkspace.pickDirectory()` 经 Remote `directory-picker/pick` 调 Host，要求挂载的后端具备
`native` 能力（`requireCapability('native')`）；否则以 `directory-picker/unavailable` 拒绝。
后端由 `resolveDirectoryPickerBackend` 决定：非 loopback 绑定、SSH、或 Linux 无 DISPLAY 时退回
`browse`（应用内自绘浏览器，没有 `native` 能力）。

Desktop 用 Web profile、Host 绑 `127.0.0.1`，darwin 上应解析为 `native`。但 Desktop 还有一条
**优先通道**：preload 暴露的 `window.__DSH_DIRECTORY_PICKER__.pick()`（走 `dialog.showOpenDialog`），
`ui-directory-picker-native` 优先用它。

对插件的含义：`uiWorkspace.pickDirectory()` 在 Desktop 上**大概率可用，但没有真机验证过**。
实现时必须 `try/catch`，失败时降级到「展开宿主侧栏，让用户用宿主自带的添加按钮」，不能把
不可用当成必然。

### `sessionIds` 不是「全部会话」，而是宿主过滤后的成员

`entity.ts` 里是 `get sessionIds() { return this.record.sessionIds.filter(id => candidateMatches(id, path)) }`
——存储 header 的 `cwd` 经 realpath 规范化后必须等于 `workspace.path`。路径失效/不匹配的成员会被剔掉。

同时它**包含归档与空白会话**。

> **更正（2026-11-13）**：本 ADR 原文在此写「**不含子代理子会话**……所以插件侧不用再按
> `origin` 过滤一遍」，**该结论已被证伪、不可再采信**。子代理子会话的 header 带着父会话的
> `cwd` 且标记 `origin: 'subagent'`（`subagent/subagent/src/child-agent.ts:144-150`），而工作区
> 启动回填按 canonical `cwd` 归组所有持久化 header 写进 `sessionIds`、**完全不看 `origin`**
> （`workspace/workspace/src/index.ts` 的 `bootstrap`）。因此子代理子会话确实会成为工作区成员。
> 宿主自己在 `ui-workspace/src/client/tree.ts` 的 `sessionVisible` 里对成员做
> `origin === 'subagent'` 过滤，插件必须照做——实现见
> `src/client/model/workspaces.ts` 的 `projectSessionRows`，规则记录在
> [GLOSSARY.md](../../GLOSSARY.md) 的「项目行展开」条目。

`archivedSessionIds` 在 `WorkspaceSnapshot` 顶层（全局集合），**不在 `WorkspaceView` 上**。

### `catalog()` 没有 `nextRunAt`，要自己算

`ScheduleCatalogEntry` 的字段是 `scheduledAt` 加可选的 `deliveryFloorEndsAt`，没有 `nextRunAt`。
宿主自己的算法在 `ui-schedule/src/client/task-record.ts`：

```
nextRun = deliveryFloorEndsAt > scheduledAt ? deliveryFloorEndsAt : scheduledAt
```

现有代码 `client.js` 里写的是 `task.nextRunAt ?? task.next ?? task.scheduledAt ?? task.runAt`——
`nextRunAt` 与 `next` 这两个键在契约里都不存在，只是靠最后回退到 `scheduledAt` 才碰巧能显示。
0.4.0 应改成宿主同款算法。

## 后果

- 任务浮层与宿主面板之间有一次「多跳一下」的体验代价，换来的是不依赖任何未被 exports 承诺的接口。
- 宿主如果日后暴露「按 id 打开任务详情」，这条决定可以放宽；届时改的只是一处调用。

## 不要做什么

不要因为「看起来能拿到」就去用 `TaskManagerPage` 的内部 state、`sidebar.settings` 的内部 store，或任何 `entriesOfSlot(...).inject()` 的返回值。这些在宿主升级时会静默失效，而插件是装在别人机器上的。
