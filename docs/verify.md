# 验证记录

## 第 9 轮遗留问题的定位与修复（2026-11-04，第 10 轮）

第 9 轮报告详情页报错：`Plugin metadata for dsh-sidebar-rail: Error: …/dsh-sidebar-rail/icon.svg: icon must remain inside its package directory`。

### 根因

宿主的插件元数据读取（`packages/boot/app-boot/src/package-meta.ts`）对图标有两条互斥分支：

1. `package.json` 声明了顶层 `icon` → 走 manifest 分支：只校验「图标必须在 manifest 所在目录内」。
2. 未声明 `icon` → 走导出分支：解析 `exports["./icon"]`，再 `assertPackageOwned(realpath(icon), barePackageName(specifier))`——**从图标目录往上找 `package.json`，要求它的 `name` 等于 specifier 推出的包名**。

`specifier` 取自 bundle patch 行的 `name`（仍是旧值 `dsh-sidebar-rail`），而第 8 轮把 `package.json` 的 `name` 改成了 `@skylerfee/dsh-sidebar-rail`。两者不等，`assertPackageOwned` 一路走到文件系统根都没找到匹配的 `package.json`，于是抛出该错误。

即：**包名改了、bundle patch 行与本地安装键没跟着改**。

### 修复

`package.json` 增加顶层 `icon: "./icon.svg"`，让宿主走 manifest 分支（该分支不比对包名）。这对已安装的旧键、以及将来按 scoped 名安装都成立，属于防御性修复。

### 验证方式（复刻宿主算法，用 Node 真实 ESM 解析器）

在临时目录建 `node_modules/dsh-sidebar-rail` 与 `node_modules/@skylerfee/dsh-sidebar-rail` 两条符号链接，按 `package-meta.ts` 的分支逻辑各跑一遍：

| 场景 | 结果 |
| --- | --- |
| specifier `dsh-sidebar-rail`，**不声明** icon（第 8 轮状态） | ❌ 精确复现线上错误：`…/icon.svg: icon must remain inside its package directory` |
| specifier `dsh-sidebar-rail`，**声明** icon（本次修复） | ✅ 通过，图标读成 `data:image/svg+xml;base64,…` |
| specifier `@skylerfee/dsh-sidebar-rail`（正确终态安装键），不声明 icon | ✅ 通过（`packageName === manifest.name`，包名校验满足） |

`npm run check` 通过（仓库规则 + 两入口语法 + 12 项单测）。

### 仍未处理（需授权）

`cordis.patch.yml` 的行 `name` 仍是 `dsh-sidebar-rail`，而 scoped 插件的惯例是写完整包名（对照 `@nonamelego/dsh-catppuccin`、`@skylerfee/dsh-llm-opencode-go-live`）。改成 scoped 名后，**当前 profile 的旧安装键会解析不到**，必须同时按新名字重装，否则插件加载失败。这属于修改用户 profile，未在本轮执行。

在本轮修复后，详情页的元数据错误应当消失（仍待在真实界面复验一次）。

## 独立 Desktop 复验（2026-11-04，第 9 轮）

结论：前次验收的 4 个界面问题在当前 macOS Desktop 的深色中文环境下未复现，已测的折叠轨、浮层、置顶、键盘和原生设置路径通过；插件详情页仍显示图标元数据错误，因此安装状态不能判为完全通过。

### 环境与方法

- 宿主：已安装的 DeepSeek Harness Desktop `0.2.1-rc.5`，原生窗口页面 `dsh-app://app/`，中文界面，深色外观，Catppuccin 插件启用。
- 项目：提交 `8042115`，`package.json` 名称为 `@skylerfee/dsh-sidebar-rail`、版本 `0.1.0`；Desktop 当前仍以 `dsh-sidebar-rail` 的本地 `link:` 安装记录加载。开始时插件已开启、侧栏折叠，源码工作区干净。
- 方法：通过 Computer Use 原生应用接口操作，结合可访问性树和窗口截图核对。浮层指针进入路径使用从页面空白区域拖向图标的原生操作，另用坐标点击、Tab 和 Escape 验证交互；未使用外部 Web 页面代替 Desktop。
- 通过原生窗口缩放操作切换宽窗与窄窗，并在各状态读取截图和可访问性树；未读取 CSS 视口宽度，不把本轮窗口复验视为 768px 精确边界测量。

### 实际结果

| 检查 | 结果 | 本轮观察 |
| --- | --- | --- |
| 折叠态浮轨 | 通过 | 宽窗中实际显示工作区、定时任务、插件、更多和底部账号座位；顶部避开窗口控制区域。 |
| 工作区浮层及语言 | 通过 | 出现项目、路径和 5 条最近会话，时间为“16 分钟前”“1 小时前”等中文；浮层标题、项目名和路径均可辨认。 |
| 深色可读性 | 通过当前外观的视觉复核 | 上轮近黑文字未复现，文字在深色浮层上清晰可辨；本轮没有重新测量颜色或对比度数值。 |
| 置顶与重挂载保持 | 通过 | 在浮层置顶一个现有工作区后出现“置顶项目”；关闭并重新启用插件后该置顶仍在。验收结束已取消该测试置顶。 |
| 定时任务取数 | 通过空态路径 | 浮层显示“还没有定时任务”及“打开面板”；点击轨道定时任务图标能进入宿主“自动化任务”面板。没有创建测试任务。 |
| 插件取数与跳转 | 通过 | 浮层列出真实已启用条目，如 `@deepseek-ai/dsh-plugin-manager`；未停在永久加载。点击轨道插件图标能进入管理面板。 |
| 更多与账号浮层 | 通过 | 更多浮层包含展开侧栏、MCP 连接器入口；账号浮层显示说明与展开侧栏入口，未复制账号数据。 |
| 展开态保留宿主导航 | 通过入口保留及设置路径 | 点击账号图标后浮轨消失，宿主工作区树、搜索、视图选项、添加工作区和账号菜单都在。账号菜单中的“设置”可完整打开设置面板，关闭后按 `Command+,` 也可重新打开。 |
| 窄窗隐藏及动态恢复 | 通过实际窗口状态 | 原生窗口缩放后浮轨与其可访问性节点消失，宿主打开侧栏按钮仍能使用；恢复原宽窗后浮轨自动重新出现，无需重启。 |
| 键盘操作 | 通过已测路径 | 从定时任务按钮按 Tab，依次打开插件、更多和账号浮层；Escape 后浮层节点消失。未做完整焦点循环审计。 |
| 停用与重新启用 | 通过可见清理与恢复 | 关闭后浮轨节点消失，重新启用后恢复；最终关闭插件并展开宿主侧栏，未见残留浮轨。未检查物理卸载和样式节点。 |
| 插件包元信息 | **不通过** | 详情页同时显示组件“运行中”及 `Plugin metadata for dsh-sidebar-rail: Error: …/dsh-sidebar-rail/icon.svg: icon must remain inside its package directory`；关闭再开启后仍可复现。 |

### 尚需处理的元数据问题

`icon.svg` 在当前源码包目录内存在且不是符号链接；当前包名与 Desktop 旧安装键不同。两项是本地核实结果，尚不能据此确定错误由包名变更、宿主路径解析还是旧安装缓存导致。需要针对当前 `link:` 安装记录继续定位并复验；本轮没有修改实现、重新安装或清理用户 profile。

### 检查与限制

- `npm run check` 通过：仓库机械规则、两入口语法检查和 12 项逻辑测试全部通过。
- `Command+R` 后没有观察到足以确认渲染进程重新加载的变化，因此不计为刷新持久化通过；置顶证据仅覆盖关闭再启用。
- 未精确测量 120ms 打开与 200ms 关闭时序、快速划过和跨间隙手感，未测亮色、其他皮肤、Web、Windows/Linux、真实 remote 故障、完整进程重启和物理卸载。
- 搜索、视图选项和添加工作区只确认入口保留；未创建或修改工作区，未从浮层打开业务会话。
- 按会话中已确认的验收偏好，结束时将插件设回关闭、侧栏展开，并恢复原窗口大小。其他插件、主题和业务数据未修改；本轮未保存临时截图文件。

## 本轮修复与架构收窄（2026-11-04，第 6 轮）

针对 [Desktop 验收报告](desktop-validation-2026-11-04.md) 的 4 个问题：3 项按根因修复，第 3 项在查证后改为架构收窄（用户决策）。

| 问题 | 根因 | 修法 | 状态 |
| --- | --- | --- | --- |
| #1 折叠后没有图标轨 | macOS Desktop 把折叠列宽算成 0，且 `.sidebarCol { overflow: hidden }` 裁掉列内一切内容；宿主 CSS 注释明确「darwin closed sidebar has no rail」 | 插件不再渲染在列内：改为挂载 `shell.overlay` 槽 + `createPortal(document.body)` 的固定浮轨（`left:0 / top:var(--dsh-frame-top-clearance,48px) / width:56px / z-index:60 / no-drag`），窄窗口 `max-width:900px` 隐藏 | ✅ 第 7 轮 Desktop 复验通过（见下） |
| #2 深色主题文字近黑 | CSS 用了宿主不存在的 token（`--dsw-alias-text-*`、`-bg-secondary/tertiary/elevated`、`-border-subtle`），全部落回深色 fallback | 换成宿主真实 token（`--dsw-alias-label-*`、`--dsw-alias-interactive-bg-*`、`--dsw-alias-bg-overlay`、`--dsw-alias-border-l1`、`--dsw-specific-sidebar-nav-item-active`），并去掉颜色 fallback；radius/shadow token 宿主不存在，改用字面值 | ✅ 第 7 轮 Desktop 复验通过（见下） |
| #3 展开态设置入口不可点 | 表层：`ctx.get('commands')` 在客户端不存在。深层：`SettingsRoot`（侧栏底部触发器 + body 弹窗）注册在 `sidebar.settings` 子槽，插件替换整个 `sidebar` 槽后从不渲染该子槽，导致设置整体不可达（连快捷键也打不开） | 架构收窄为**增量插件**：不再注册 `sidebar` 槽，展开态完全交还宿主（搜索、视图选项、添加工作区、设置座位、账号菜单全部保留）；插件只补 macOS 折叠态浮轨 | ✅ 第 7 轮 Desktop 复验通过（见下） |
| #4 中文界面显示英文相对时间 | 宿主 `LocaleSnapshot` 的当前语言字段是 `active`，原代码读 `id`/`locale`，恒为 `en` | 新增纯函数 `resolveLocaleId`（`active` 优先，`id`/`locale` 仅作防御性兼容，空值回退 `en`），locale 快照按宿主字段名暴露 `active` | ✅ 单测覆盖 + 第 7 轮 Desktop 复验通过 |

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

### Desktop 真实界面复验（2026-11-04，第 7 轮）

环境：macOS Desktop `0.2.1-rc.5`，中文界面、深色外观、`@nonamelego/dsh-catppuccin` 皮肤；插件通过 `plugin_manager` 启用后重启应用。方法：`screencapture` 截图 + 像素测量（Retina 截图 → CSS px）+ CGEvent 合成 `⌘B` 折叠侧栏、悬停浮层、`Esc`、`⌘R`，逐项核对；窗口约 1060 CSS 宽、844 CSS 高。

| 问题 | 结果 | 实测证据 |
| --- | --- | --- |
| #1 折叠后图标轨 | ✅ 通过 | 点 `⌘B` 折叠后左侧出现常驻轨：宽度实测 **56.5 CSS px**（含 1px 右边框），图标横向中心 x=120.8 对轨中心 120.5，纵向按钮间距 40px（首钮中心 y≈156）；顶部不遮盖红绿灯，也不与 `shell.leading` 的重开按钮重叠；底部有账号座位；再按 `⌘B` 展开后浮轨消失、无残留 |
| #2 深色可读性 | ✅ 通过 | 浮层底 `RGB(66,69,88)`：标题 **6.19:1**、次级文字 **4.26:1**、轨内图标对轨底 **9.04:1**；改前次级文字为 3.49:1（同为实测）。浮层标题已提到 `label-primary`，空态/提示提到 `label-secondary` |
| #3 展开态设置入口 | ✅ 通过 | 展开态完全由宿主侧栏接管；点底部账号行弹出「设置 / 意见反馈 / 退出登录」，点「设置」（或 `⌘,`）**完整打开设置面板**（账号与余额、通用设置、模型、内置插件、Agent 预设、Catppuccin、通知提醒、桌面版重启）。改造前该面板因 `SettingsRoot` 不挂载而整体不可达 |
| #4 中文相对时间 | ✅ 通过 | 最近会话显示「2 分钟前 / 46 分钟前 / 2 小时前 / 4 小时前」，项目与章节标题均为中文（工作区 / 项目 / 最近会话 / 已启用插件 / 还没有定时任务） |
| 浮层交互 | ✅ 通过 | 悬停 120ms 后浮层出现在轨右侧（左缘实测 x≈149，即 `anchor.right + 8`）；`Esc` 关闭（关闭后浮层底色像素 365 vs 打开时 37510）；插件列表加载出真实数据；定时任务显示空态 |
| 窄窗隐藏 | ✅ 通过（第 8 轮） | 改为纯函数阈值 768 后已在真机验证：窗口 525 CSS 宽时浮轨不渲染、858.5 CSS 宽时渲染（详见第 8 轮） |

### 本轮额外修复：两个浮层永久停在「加载中…」

真实界面验收发现的新缺陷（旧代码即存在，此前未在界面里点开过这两个浮层）：

- 现象：悬停「插件」/「定时任务」后，正文停在「加载中…」永不结束；`Esc` 后再次悬停仍是加载中。
- 根因：懒加载 `useEffect` 的依赖里含 `phase`，而 effect 体内先 `setState({phase:'loading'})`。这次 setState 触发重渲染 → React 先执行上一次 effect 的 cleanup（`live = false` + `clearTimeout`）→ 本次 effect 又因 `phase !== 'idle'` 直接 return。结果是 promise 回调全部被 `live` 丢弃、超时定时器被清掉，**数据永远写不进去**。
- 修法：effect 依赖收窄为 `[open]`；loader 通过 `useRef` 读取（注入 props 每次渲染都是新对象，函数 identity 进依赖会重演同一问题）；每次打开只发起一次加载，关闭时重置；保留 5s 超时兜底，把「Host 调用不返回」转成失败态而不是永久加载。
- 复验：修复后「已启用插件」列出真实数据（cordis:include、@deepseek-ai/dsh-plugin-manager、@deepseek-ai/cordis-plugin-timer 等），「定时任务」显示「还没有定时任务」空态，两者都有「打开面板」出口。

### 第 8 轮：沟通过的改造 + 真机复验

本轮先做了一轮设计追问（产品形态、窄窗策略、排版层级、发布策略共 16 个决策），再按结论改实现与元数据。

**行为改动**

| 项 | 改前 | 改后 |
| --- | --- | --- |
| 窄窗判定 | CSS `@media (max-width: 900px) { display: none }` | 纯函数 `shouldRenderRail(platform, collapsed, viewportWidth)`，阈值 `RAIL_MIN_VIEWPORT = 768`（680 正文最小宽 + 56 轨宽 + 32 安全），由 `window.innerWidth` + `resize` 监听驱动；不满足即 `return null` |
| 文字层级 | 标题 `label-primary`、元信息 `label-secondary`、章节/提示 `label-tertiary` | 全部 `label-primary`；层级只靠字号与字重（标题 13px/600 vs 元信息 11px/400） |

**发布形态（未发布，只改成可发布状）**

- 包名 `@skylerfee/dsh-sidebar-rail`，去掉 `private`，`version` 仍 `0.1.0`
- 补 `license`/`LICENSE`（MIT © 2026 SkylerFee）、`repository`/`homepage`/`bugs`/`keywords`/`engines`（node >=22.19.0）、`publishConfig`（access public + registry）
- `peerDependencies`：`@deepseek-ai/cordis`（`~4.0.4 || ~4.0.5-alpha.1`）+ 5 个 client 包（`>=0.2.1-rc.5 <0.3.0-0 || >=0.2.2-0 <0.3.0-0`，后段是为了让将来的 `0.2.2-rc.x` 满足 semver 预发布规则）
- `files` 只含运行必需文件（不含 docs）；`exports` 补 `./package.json`
- 脚本：`test`、`check`（两入口 `node --check` + 单测）、`prepublishOnly`（= `check`）
- `.github/workflows/ci.yml`（push main / PR 跑 `npm run check`）+ `publish.yml`（Release 触发、校验 tag==`v<version>`、OIDC trusted publishing、按版本推导 dist-tag）
- README 拆成英文主 `README.md` + `README.zh.md`；`AGENTS.md` 保留

**真机复验（同一 Desktop 会话，macOS 0.2.1-rc.5）**

| 用例 | 方法 | 结果 |
| --- | --- | --- |
| 宽窗 + 折叠 | `⌘B` 折叠（窗口接近全屏） | ✅ 左侧浮轨显示：文件夹/时钟/插件/更多 + 底部 AI，位于红绿灯下方 |
| 窄窗 + 折叠 | 拖窗口右缘缩到 **525 CSS** 宽 | ✅ 浮轨完全不渲染，内容贴窗口左缘 |
| **区分性用例** | 拖到 **858.5 CSS** 宽（768–900 之间） | ✅ 浮轨显示 —— 旧的 `max-width:900px` 媒体查询在这里会隐藏，因此这条证明**跑的是新的 JS 判定**而非旧 CSS |
| 动态响应 | 在 525 ↔ 858 之间来回拖窗口 | ✅ 浮轨随宽度出现/消失，说明 `resize` 监听路径工作，无需刷新 |
| 排版 | 858 宽悬停工作区，读浮层像素 | ✅ 浮层底色 `RGB(66,69,88)`，区域内所有文字核心色均为 `RGB(200,208,242)` = `label-primary`，对比度 **6.19:1**（改前元信息为 4.26:1）—— 与新排版一致 |
| 页面重载 | `⌘R` 后观察 | ✅ 重载后行为与重载前一致（窄窗仍不渲染），无报错可见 |

测量方法说明：窗口边界用「标题栏那一行的亮天空 vs 暗窗口」判定（早期用壁纸大面积亮度判断会被深色水面/红色大桥误导，曾误读成 1401 CSS，已纠正）。

### 仍未验证

- 阈值两侧的精确边界（767 vs 769）：真机只覆盖了 525 / 858.5 两个点，边界本身由 `shouldRenderRail` 单测覆盖。
- 浮层跨间隙移动的 200ms 关闭时序手感、键盘 Tab 遍历。
- 亮色主题、其他皮肤下的对比度。
- 停用/卸载后的宿主恢复（本次只在启用态验证，未卸载）。
- Web 端确认不出现第二条轨（依据平台判定走查，未在浏览器中实测）。

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
