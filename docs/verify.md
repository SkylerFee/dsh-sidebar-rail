# 验证记录

## 本轮修复与架构收窄（2026-11-04，第 6 轮）

针对 [Desktop 验收报告](desktop-validation-2026-11-04.md) 的 4 个问题：3 项按根因修复，第 3 项在查证后改为架构收窄（用户决策）。

| 问题 | 根因 | 修法 | 状态 |
| --- | --- | --- | --- |
| #1 折叠后没有图标轨 | macOS Desktop 把折叠列宽算成 0，且 `.sidebarCol { overflow: hidden }` 裁掉列内一切内容；宿主 CSS 注释明确「darwin closed sidebar has no rail」 | 插件不再渲染在列内：改为挂载 `shell.overlay` 槽 + `createPortal(document.body)` 的固定浮轨（`left:0 / top:var(--dsh-frame-top-clearance,48px) / width:56px / z-index:60 / no-drag`），窄窗口 `max-width:900px` 隐藏 | 代码完成，Desktop 未复验 |
| #2 深色主题文字近黑 | CSS 用了宿主不存在的 token（`--dsw-alias-text-*`、`-bg-secondary/tertiary/elevated`、`-border-subtle`），全部落回深色 fallback | 换成宿主真实 token（`--dsw-alias-label-*`、`--dsw-alias-interactive-bg-*`、`--dsw-alias-bg-overlay`、`--dsw-alias-border-l1`、`--dsw-specific-sidebar-nav-item-active`），并去掉颜色 fallback；radius/shadow token 宿主不存在，改用字面值 | 代码完成，Desktop 未复验 |
| #3 展开态设置入口不可点 | 表层：`ctx.get('commands')` 在客户端不存在。深层：`SettingsRoot`（侧栏底部触发器 + body 弹窗）注册在 `sidebar.settings` 子槽，插件替换整个 `sidebar` 槽后从不渲染该子槽，导致设置整体不可达（连快捷键也打不开） | 架构收窄为**增量插件**：不再注册 `sidebar` 槽，展开态完全交还宿主（搜索、视图选项、添加工作区、设置座位、账号菜单全部保留）；插件只补 macOS 折叠态浮轨 | 代码完成，Desktop 未复验 |
| #4 中文界面显示英文相对时间 | 宿主 `LocaleSnapshot` 的当前语言字段是 `active`，原代码读 `id`/`locale`，恒为 `en` | 新增纯函数 `resolveLocaleId`（`active` 优先，`id`/`locale` 仅作防御性兼容，空值回退 `en`），locale 快照按宿主字段名暴露 `active` | 单测覆盖，通过 |

### 本轮已执行的检查

| 命令 | 结果 | 覆盖范围 |
| --- | --- | --- |
| `node --check client.js` / `node --check index.js` | 通过 | 脚本语法 |
| `npm test` | 11 项通过、0 失败 | 纯逻辑：分组排序、过滤、数据归一、相对时间、语言解析、hook 替身 |
| `git diff --check` | 通过 | 空白错误 |

### 宿主侧与安装态

| 项 | 方法 | 结果 |
| --- | --- | --- |
| 临时启用 | `plugin_manager set_bundle dsh-sidebar-rail enabled=true` | ✅ `application: applied`、`warnings: []` |
| Host 行生效 | Cordis Inspect `host/Config.listConfigs name=dsh-sidebar-rail` | ✅ 返回 `include:dsh-sidebar-rail`（status `absent`，本插件无配置项，属正常） |
| Client 侧是否加载 | Cordis Inspect `client/Slots.listSubTree` **带 `root` 精确查询**（全树不含占用者明细，不能用全树检索判定） | ✅ 应用重启后 `shell.overlay` 占用者中出现 `{ id: "dsh-sidebar-rail.rail", order: 10, priority: 0, active: true }`，说明客户端 bundle 已加载且注册生效 |
| 未替换宿主侧栏 | `client/Slots.listSubTree root=sidebar` | ✅ 占用者只有 1 个（宿主的 `ui-sidebar`），插件不再注册该槽 |
| 设置座位仍在 | `client/Slots.listSubTree root=sidebar.settings` | ✅ 占用者 active（宿主 `ui-settings` 的 trigger row + 弹窗面板），设置不再因替换侧栏而丢失 |
| 恢复关闭 | `plugin_manager set_bundle enabled=false` | ✅ `changed: true`、`application: applied`，插件已回到关闭状态 |
| 界面视觉证据 | `screencapture` / System Events 可访问性树 | ⚠️ 均被系统权限拒绝（`could not create image from display`、`-10004`），本会话无法截图或读取 a11y 树，折叠浮轨的实际绘制仍需人眼确认 |

### 本轮未验证（用户决定跳过 Desktop 复验）

- 折叠态浮轨的实际可见性、位置（是否避开红绿灯与 `shell.leading` 重开控件）、与正文的遮挡关系。
- 深色/浅色主题下的实际对比度，以及 `@nonamelego/dsh-catppuccin` 皮肤下的表现。
- 中文界面相对时间是否真的显示中文。
- 浮层 120ms/200ms 时序、跨间隙移动、Escape 关闭、键盘遍历。
- 展开态是否完整保留宿主导航（本次改为完全交还宿主，理论上不再依赖插件实现，但未目视确认）。
- 停用/卸载后的宿主恢复、跨进程重启后的状态保持。

## 历史验证说明

本节以下为**替换 `sidebar` 槽时代**（第 1-5 轮）的记录，其架构与当前实现不同：当时的展开态自绘列、native 模式、折叠状态持久化均已在第 6 轮移除，相关条目只用于追溯历史，不代表当前实现。

下文为此前的验证记录，其中的安装状态、端口与工具限制只描述当次环境；当前 Desktop 结果以上述报告为准。

> 依据插件开发规范：无浏览器控制时，验证止于「JS 语法 + 清单合法性 + 实时 Client Slot 注册」，并如实报告视觉验证不可用。

## 已执行

| 项 | 方法 | 结果 |
| --- | --- | --- |
| JS 语法 | `node --check client.js` | ✅ 通过 |
| 契约自检：不声明 `children` | `grep -c "children:" client.js` | ✅ 0 处（避免 `slot already declared`） |
| 契约自检：单槽优先级 | 源码检查 | ✅ `priority: -1` |
| 元数据 JSON | `python3 json.load` 校验 `locale/en.json`、`locale/zh.json` | ✅ 合法，含 `meta.title` / `meta.description` |
| 图标 | `icon.svg` 原创 SVG，包内相对路径 | ✅ 存在，尺寸 viewBox 64 |
| 安装 | `plugin_manager install_bundle` | ✅ `application: applied`，`enabled: true`，无 warnings |
| profile 依赖 | `~/.dsh/profiles/desktop/package.json` | ✅ `"dsh-sidebar-rail": link:...`，且列入 `dsh.profile.bundles` |
| 与既有插件冲突 | 检查 profile 内 `dsh-better-sidebar` | ✅ 那是**右侧栏**工作台，不占左侧 `sidebar` 槽 |

## 补充核查（第 2 轮）

| 项 | 方法 | 结果 |
| --- | --- | --- |
| Host 侧插件行是否激活 | `plugin_manager install_bundle` 结果 | ✅ `application: applied`、`enabled: true`、`warnings: []` |
| 重复安装幂等 | 再次 `install_bundle` | ✅ 返回 `already-installed`（`changed: false`），未破坏既有安装 |
| profile 依赖与 bundle 列表 | 读 `~/.dsh/profiles/desktop/package.json` | ✅ 依赖为 `link:`，且列入 `dsh.profile.bundles` |
| 与既有插件冲突 | 检查 `dsh-better-sidebar` | ✅ 其为右侧栏工作台，不占左侧 `sidebar` 槽 |
| 页面/模块清单直查 | `curl http://127.0.0.1:65028/` | ⚠️ 返回 401（需带 `dsh web` 打印的 token），无法从 HTTP 侧核对模块清单 |
| Cordis Inspect 精确查询 | `Config.listConfigs` / `Slots.listSubTree` 带 `input` | ⚠️ 该 Inspect 通道当前把 `input` 当字符串传入并报 `"input" must be an object`，无法按插件名/槽名过滤 |
| 渲染容错加固 | 代码审查后补充 | ✅ 标准 hooks 缺失时退化为常量读取；`t` 缺失时退化为原文键；避免单个 prop 假定错误导致整列空白 |

## 自查发现的缺陷（第 3 轮，均已修）

| 缺陷 | 影响 | 修法 |
| --- | --- | --- |
| 展开态没有折叠按钮 | 原折叠按钮属于被影子的 `ui-sidebar` 外壳，替换后用户无法收回侧栏（只能靠快捷键） | 品牌行右侧补一个 `aria-label` 折叠按钮，调用 `layout.toggleSidebar()` |
| `renderSlot` 未解构 | `typeof renderSlot` 恒为 `undefined`，原生展开态成为死代码，永远不会激活 | 把 `renderSlot` 加入 props 解构 |
| i18n 键缺失 | 新增折叠文案时 `t('rail.collapse')` 无字典，会显示原始 key | 补 zh/en 两份字典；脚本双向校验通过（27 键、zh/en 对齐） |

自查方式：`node --check` + 解构/分支/重复定义的静态核对 + i18n 键集合比对（正则排除 `ctx.get(` 之类误报）。

## 纯逻辑单测（第 4 轮，可复跑）

`npm test`（即 `node --test test/data.test.mjs`）——**11/11 通过**。测的是 `client.js` 内用 `#region` 标记的两段纯函数，不涉及 React / DOM / 渲染，属于逻辑校验而非视觉校验。

| 用例 | 覆盖的需求 |
| --- | --- |
| pinned workspaces lead, in pin order | 需求 c：置顶项目段在普通项目之前、按置顶顺序 |
| normal rows keep host order | 需求 c：普通项目保持宿主顺序 |
| recent newest-first, dropped archived/blank/subagent, capped at 10 | 需求 c：最近会话仅 10 条、按时间倒序、过滤归档/空白/子代理 |
| workspaceSessions sorted & filtered | 展开态每个项目下挂会话的排序与过滤 |
| normalizeTasks unwraps RemoteResult / tolerates junk | 定时任务浮层的数据归一（含 `{ok,value}` 包裹与脏数据） |
| normalizePlugins keeps only enabled / prefers moduleName | 插件浮层"仅已启用"语义 |
| relativeTime zh/en buckets | 中英文相对时间文案 |
| shortPath two segments | 路径省略显示 |
| selectorHook falls back to constant reader | 标准 props 缺失时的降级不抛错 |

跑法：`cd dsh-sidebar-rail && npm test`

## 验证路径排查（第 5 轮，均为受限）

| 路径 | 结果 |
| --- | --- |
| 启动日志 `~/.dsh/logs/*.log` | ⚠️ 最新一份是 2026-09-29，非当前进程；无本插件记录 |
| 应用内置 `runtime/bin/node` | ⚠️ 是包装脚本，直接执行报 `exec: : not found` |
| 官方启动器 `runtime/cli/bin/dsh` | ✅ 揭示真实入口：`ELECTRON_RUN_AS_NODE=1 <Electron> --expose-internals <cli.js>` |
| 用该入口跑 `--profile desktop --dump-config` | ❌ `error: profile "desktop" is managed exclusively by the Electron application`（桌面 profile 由 App 独占，CLI 不允许导出） |

结论：在本会话可用的工具面内，**页面级/视觉级验证无法完成**。已完成的最高强度验证为：语法 + 纯逻辑单测（11/11）+ 安装结果 `applied` + profile 注册核对 + 宿主源码契约比对。

## 未验证（原因）

| 项 | 原因 |
| --- | --- |
| 折叠轨的视觉呈现、浮层位置与动效 | 本会话无浏览器控制能力，无法截图或点击 |
| 悬浮展开/关闭的时序手感 | 同上 |
| 置顶与折叠状态在真实刷新后的保持 | 同上（逻辑已实现，未经实机复现） |
| 亮/暗主题下的浮层配色 | 同上（全部使用 `--dsw-alias-*` token，未硬编码颜色） |
| 宿主侧栏是否被正确替换 | Slot 树不暴露单槽占用者列表，无法从 Inspect 侧确认；需页面刷新后目视 |

## 复验步骤（人工，当前实现）

前置：在 `~/.dsh/profiles/desktop` 中启用 `dsh-sidebar-rail`，然后**刷新渲染进程**（Desktop 窗口按 `Cmd+R`；宿主进程与本会话不受影响）。

1. 展开态先确认宿主侧栏原样：搜索、视图选项、添加工作区、底部设置座位、账号菜单都在，且点击设置能打开设置面板。
2. 点「收起侧栏」→ 左侧应出现 56px 浮轨，从窗口顶部 48px 处开始（上方是红绿灯与宿主自己的展开按钮），底部是账号座位。
3. 悬浮「工作区」→ 120ms 后右侧出现浮层，含「置顶项目 / 项目 / 最近会话」；移开后 200ms 关闭，Escape 也能关闭。
4. 点项目行图钉 → 移入「置顶项目」；刷新页面后仍在。
5. 深色主题下检查浮轨与浮层文字对比度；中文界面下检查最近会话的相对时间是否显示「5 分钟前」等中文。
6. 把窗口缩到 900px 以下 → 浮轨应隐藏（避免压住正文），宿主折叠态的展开按钮仍可用。
7. 展开侧栏 → 浮轨消失，交给宿主原生侧栏；控制台无 `[dsh-sidebar-rail]` 报错。

## 若出现异常

- 侧栏突然变回 DSH 原样 → 说明 entry 崩溃并 abdicate，查控制台 `[dsh-sidebar-rail] render failed`。
- 侧栏空白 → 检查 `dsh.client` 的 `./client` 导出与 `client.js` 是否被页面加载。
- 需要立即回退：`plugin_manager action: set_bundle target: dsh-sidebar-rail enabled: false`。
