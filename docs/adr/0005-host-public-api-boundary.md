# 0005 分区功能只走宿主公开 API，无法定位到单条任务时就退为打开面板

- 状态：已采纳（2026-11-09）
- 相关：`client.js` 的任务/插件/项目相关交互、`.agents/notes/` 未采用的契约外做法

## 背景

0.4.0 的需求里有几项看起来「宿主应该能直接做」，逐个核实后发现公开面并不覆盖全部。设计阶段把每条都查到了源码级，避免实现到一半才发现走不通，也避免为了「功能完整」去用契约外接口。

查证结果：

| 想要的 | 宿主公开能力 | 结论 |
| --- | --- | --- |
| 项目中新建会话 | `uiWorkspace.startSession(workspaceId)` | 可用 |
| 添加项目 | `pickDirectory()` + `workspaces.create({ path })` | 可用 |
| 项目下的会话 | `WorkspaceView.sessionIds` 已在数据里 | 可用 |
| 任务按状态分区 | `remote.schedule.catalog()` 返回全部状态（内部 `entries()` 只 map+sort，不按状态过滤） | 可用 |
| 插件分区 | `pluginManager/listBundles` 每项带 `enabled` / `installed` | 可用 |
| **定位到单条任务详情** | ❌ 选中任务存在 `TaskManagerPage` 内部的 `useState(selectedId)`；`selectPanel` 只能开面板不能传参；`openRightbar(track, fullscreen)` 不能指定 tab；`openTaskDetail` 只在 ui-schedule 内部组件间流转 | **不可用** |
| **打开设置面板** | ❌ 见 0.3.1 的结论：`settings.launcher` 是 single 槽且被宿主账号插件独占 | **不可用** |

## 决定

1. **功能只依赖上表「可用」一列的公开 API**，不读宿主内部 store、不 `entriesOfSlot(...).inject()` 偷 props、不改宿主 `packages/*`。
2. **任务条目点击退为「打开定时任务面板」**，不做「定位到这一条」。面板内部本来就有详情，只是不能自动选中。这与 0.3.1 处理「设置入口」的方式一致：能力不可达时，把路径给清楚，而不是硬凑。
3. 插件的启用状态**只读展示**，不在浮层内提供开关。写操作要处理审批、失败恢复与重启提示，收益不抵复杂度；宿主插件管理页已经完整。
4. 「未启用」分区**只列 `installed && !enabled`**，不列尚未安装的官方按需插件——后者点了要触发安装流程，属于另一类操作。

## 后果

- 任务浮层与宿主面板之间有一次「多跳一下」的体验代价，换来的是不依赖任何未被 exports 承诺的接口。
- 宿主如果日后暴露「按 id 打开任务详情」，这条决定可以放宽；届时改的只是一处调用。

## 不要做什么

不要因为「看起来能拿到」就去用 `TaskManagerPage` 的内部 state、`sidebar.settings` 的内部 store，或任何 `entriesOfSlot(...).inject()` 的返回值。这些在宿主升级时会静默失效，而插件是装在别人机器上的。
