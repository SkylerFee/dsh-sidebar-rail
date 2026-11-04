# 验证记录

## 0.2.0 发布（2026-11-04）

走 [ADR-0003](adr/0003-release-pipeline.md) 的 Release → OIDC 链路，首次因 Trusted Publisher 权限失败，修正后一次通过。

| 项 | 结果 |
| --- | --- |
| tag / Release | `v0.2.0`（附注 tag，指向 `60d584e`，是 `origin/main` 祖先）+ GitHub Release |
| CI 运行 | 第一次 `41854950620` 失败；补权限后重跑同一运行 **success**（1m54s） |
| 失败原因 | `403 OIDC permission denied for this action`：Trusted Publisher 的 Allowed actions 默认只给 `npm stage publish`，需显式勾选 `npm publish`；连接不可编辑，删重建后生效 |
| registry | `dist-tags.latest = 0.2.0`；versions `0.0.0-stage, 0.1.0, 0.2.0` |
| 产物 | shasum `3e20eb4b395840aaa1ce14ec849f399dbc4dbab6`，10 个文件，解包 81,441 字节，**含 provenance 签名与 attestations** |
| 内容一致性 | ✅ 解包后 10 个文件与仓库 HEAD **逐字节相同** |
| 包元数据 | `license: MIT`、`dependencies: 0`、`peerDependencies: 6` |

## 0.2.0 三项交互优化（2026-11-04，第 12 轮）

需求来自用户对折叠态的反馈，逐项在真实 Desktop 复验。

### 1 工作区浮层与会话跳转

| 项 | 改前 | 改后 | 复验 |
| --- | --- | --- | --- |
| 工作区行 | 名称 + 路径副标题（两行） | 只显示名称，保留行尾置顶图钉 | ✅ 浮层内 9 个工作区均为单行名称 |
| 点击最近会话 | 传 `{kind:'session', sessionId}` → 宿主按「无会话」处理，落到新建会话 | 传**裸 SessionId** | ✅ 点第 2 条后标题栏与正文都切到该会话 |
| 会话选中态 | 无 | `aria-current="page"` + 宿主同款底色 | ⚠️ 见下方「未达成」 |

**会话跳转根因**（源码核实）：`SessionTarget` 是 `SessionId | SubagentAddress`（`api/session-controller/.../contract/sessions.d.ts:20`），即裸字符串。旧代码传对象 → 宿主 `resolveTarget` 得到 `undefined` 且不抛错 → `selectPanel(null)` 释放原会话 → 主视图落回空态，表现为「点了变成新会话」。另修正：`openSession` 是**同步抛错**，已用 `try/catch` 而非 `.catch()`。

**未达成：当前会话高亮不显示。** 判据用的是宿主自己的写法（`sessions.byId[*].retainedBy.mainView > 0`，见 `ui-workspace/tree.ts:38-41`、`ui-session/index.ts:463-469`），但在这个 Desktop `0.2.2-rc.1` 上：**宿主自己的侧栏在会话打开时同样不高亮**，且该计数读为 0。因此插件与宿主行为一致（都不高亮），属于数据源在该版本未维护，不是插件判断错误。代码里已注释记录该事实；待宿主恢复维护该计数时两侧会一起亮起。

### 2 插件浮层只列用户自己的插件

数据源从 `pluginInventory/list`（条目无 `official` 字段）改为 `pluginManager/listBundles`，过滤条件：`enabled === true && official !== true && installed !== false`。

- ✅ 复验：浮层标题「我的插件」，列出 `@nonamelego/dsh-catppuccin`、`@skylerfee/dsh-llm-opencode-go-live`、`@skylerfee/dsh-sidebar-rail`、`dsh-better-sidebar`、`dsh-context`、`dsh-macos-restart`、`dsh-mcp-connector`、`dsh-notify-me`，**无任何 `@deepseek-ai/*` 宿主自带插件**。

### 3 账号头像与浮层位置

| 项 | 改前 | 改后 | 复验 |
| --- | --- | --- | --- |
| 头像 | 硬编码 `'AI'` 两字母 | 先 `remote.account.getState()` 判登录态，登录后再 `getProfile` 取 `avatarUrl`；未登录用**原生同款省略号**，登录无图用原生人形图标 | ✅ 底部显示人形图标，与宿主原生账号行一致（见下方说明） |
| 账号浮层位置 | 一律 top 对齐 + `clamp(innerHeight-200)`，头像在底部导致浮层飞到上方很远 | 账号浮层改为**底对齐**头像底边，水平间距仍 8px | ✅ 浮层紧贴头像上方展开 |

**实现依据宿主源码，三处按宿主原样对齐**：

1. **登录态判据**：只有 `view.status === 'credential-stored'` 算登录（`ui-settings-account/AccountMenu.tsx:37`）。
2. **未登录形态**：宿主该状态下**不渲染头像槽**，而是省略号图标 + 「更多」文案（`AccountMenu.tsx:67-72`）。插件窄态无文案，故只渲染省略号。原实现用 `'AI'` 字母，与原生不符。
3. **`version` 来源**：`AccountClientMetadata.version` 必填且 Host 用 strict schema 校验。手写静态模块**没有 `process`**（渲染进程 `contextIsolation`、无 node 集成，`process.env.X` 的内联只作用于宿主自己的构建产物），所以改从页面全局 `window.__DSH_BOOT__.release.version` 取（`client-modules/manifest.ts:86-98`，页面注入处 `index.ts:673`），`process.env` 仅作兜底。上一版实现用 `process.env` → 恒为 `undefined` → `metadata === null` → 头像永远取不到。

**本轮无法从界面区分的一点**：该账号本身没有头像 URL，宿主原生账号行显示的也是人形图标，所以「`version` 已能取到」与「`version` 仍取不到」在界面上表现相同。已用单测固定 `clientBuildVersion` 的取值顺序（`__DSH_BOOT__` 优先、无 release 时返回 undefined 不抛错）；真实头像渲染需在有头像的账号上验证。



| 项 | 改前 | 改后 | 复验 |
| --- | --- | --- | --- |
| 头像 | 硬编码 `'AI'` 两字母 | `remote.account.getProfile` 取 `avatarUrl`；无图/失败用宿主同款人形占位 | ✅ 底部显示原生人形占位（当前未登录） |
| 账号浮层位置 | 一律 top 对齐 + `clamp(innerHeight-200)`，头像在底部导致浮层飞到上方很远 | 账号浮层改为**底对齐**头像底边，水平间距仍 8px | ✅ 浮层紧贴头像上方展开 |

账号调用按宿主 `accountClientMetadata` 同形构造 `{ version, locale, timezoneOffsetSeconds }`（`getTimezoneOffset` 符号翻转），缺 `DSH_CLIENT_VERSION` 时不发请求、直接降级占位。

### 本轮验证方法

`screencapture` + 像素定位图标坐标 + CGEvent 合成 `⌘B`/悬停/点击/`⌘R`；每次改动后 `npm run check`（19 项测试 + 4 条仓库规则）。

## 首发发布（2026-11-04，0.1.0）

发布链路见 [ADR-0003](adr/0003-release-pipeline.md)。结论：`@skylerfee/dsh-sidebar-rail@0.1.0` 已上线为 `latest`，内容与仓库一致，tag 已推送。

| 步骤 | 结果 |
| --- | --- |
| 本会话 `npm publish` | ❌ `EOTP`：账号开启 2FA，非交互执行无法完成浏览器授权 |
| 维护者以 staged publishing 提交 | ✅ registry 先出现占位版 `0.0.0-stage`（"Temporary package placeholder for staged publishing"） |
| 网页端批准 | ✅ `0.1.0` 上线，`dist-tags = {"latest":"0.1.0"}` |
| 发布内容一致性 | ✅ `dist.shasum 35db0dc6…` 与本地构建一致；解包 10 个文件与仓库源码逐字节相同（LICENSE、两份 README、client.js、cordis.patch.yml、icon.svg、index.js、两份 locale、package.json） |
| 包元数据 | ✅ `license: MIT`、`peerDependencies` 6 项、`dependencies` 0 项、`fileCount: 10`、`unpackedSize: 65964` |
| tag | ✅ `v0.1.0` 附注 tag 已推送；未建 GitHub Release（避免 CI 重复发布） |
| 敏感信息 | ✅ 打包内容扫描无 token/手机号/本机绝对路径 |

### 发布链路验证（Trusted Publisher）

维护者配置 Trusted Publisher 后，用**受控重发**验证链路（不改动 npm 内容）：

| 项 | 结果 |
| --- | --- |
| 手段 | 对已存在的 `v0.1.0` 建 GitHub Release，触发 `publish.yml`（运行 `41844630538`），预期在最后一步被 npm 的版本护栏拒绝 |
| 通过的前置步骤 | ✅ tag 与 `package.json` 版本一致、✅ 被发布提交是 `origin/main` 祖先、✅ `npm run check`、✅ dist-tag 推导 |
| `Publish` 步骤输出 | `npm error You cannot publish over the previously published versions: 0.1.0.` |
| 结论 | ✅ 该错误在**认证之后**才出现，说明 OIDC 信任发布已生效；npm 未被改动 |
| 清理 | ✅ 验证用 Release 与那次失败运行均已删除，`v0.1.0` tag 保留 |

此后发布新版本的流程：改 `package.json` 版本 → 提交推送 → 建 `v<version>` Release → CI 校验后自动 OIDC 发布（无需 2FA、无需 token）。



## 作用域包名启动失败修复（2026-11-04，第 11 轮）

结论：修正客户端工厂 ID 后，Desktop `0.2.1-rc.5` 的渲染进程启动恢复正常；插件详情显示完整包名 `@skylerfee/dsh-sidebar-rail`、组件“运行中”，且无此前的图标元数据错误。折叠轨、工作区浮层和中文相对时间均已在真实窗口复验。

### 错误与根因

用户提供的 `crash-2026-11-04T13-33-42-871Z-web-boot.log` 记录了北京时间 2026-11-04 21:33:42 的启动失败。顶层错误为 `@skylerfee/dsh-sidebar-rail: import failed`，其 renderer console 的直接原因是 `duplicate factory registration for "dsh-sidebar-rail"`。

`package.json.name`、bundle patch 的模块 `name` 和 Desktop 安装键已经使用完整作用域包名，但 `client.js` 仍以旧短名 `dsh-sidebar-rail` 注册工厂。宿主按完整包名导入时查不到工厂，随后再次执行脚本，在旧短名上触发重复注册。此前的 `scripts/check.mjs` 主动去掉包名作用域，错误地接受了这个不一致。

本轮核实 profile 只有一个 scoped 依赖与 bundle 声明，旧短名仅余孤立链接；没有通过删除链接、修改用户 profile 或屏蔽宿主重复注册错误来处理本次失败。

### 修复与回归验证

| 项 | 结果 |
| --- | --- |
| 静态工厂注册 | `client.js` 的 ID 改为 `@skylerfee/dsh-sidebar-rail`，与宿主导入名一致。 |
| 自动检查 | 改为比较完整包名，并检查 bundle patch 的模块 `name`；槽条目 ID、本地存储键和界面行为保持原值。 |
| 注册回归 | 新增 `test/client-registration.test.mjs`，在没有 React 和 DOM 的环境执行完整静态脚本，验证只登记一个工厂且注册 ID 等于包名。 |
| 正常路径 | `npm run check` 通过：仓库规则、两入口语法和 13 项测试全部通过。 |
| 无效模块 ID | 在隔离目录把工厂 ID 改回旧短名，仓库检查和新注册测试均失败。 |
| 无效补丁模块名 | 在隔离目录把 patch 的模块 `name` 改回旧短名，仓库检查失败。隔离文件已自动移除。 |

### Desktop 真实复验

环境为已安装的 macOS Desktop `0.2.1-rc.5`，页面 `dsh-app://app/`，中文、深色外观和 Catppuccin 皮肤。通过 Computer Use 原生窗口操作和可访问性树、截图观察；源码由现有 `link:` 安装直接加载，未重新安装依赖。

1. 修复前窗口停在 `HARNESS Loading plugins…`；修改源码后按 `Command+R`，完整侧栏、会话页面和操作控件出现，启动不再阻塞。
2. 打开插件详情，显示 `@skylerfee/dsh-sidebar-rail@0.1.0`，开关开启、一个组件运行中，图标正常，未出现包元信息错误。
3. 收起侧栏，实际显示工作区、定时任务、插件、更多和底部账号图标。将指针从页面空白区拖入工作区图标后，浮层出现项目和最近会话，相对时间为中文；Escape 可关闭。
4. 展开侧栏后浮轨消失，原生导航仍在。结束时保持插件原有的启用状态，侧栏恢复展开。

本轮验证了渲染进程重新启动及真实客户端加载，未重启整个 Electron/Host 进程，未遍历全部交互、测试其他平台或执行发布。未保存临时截图文件。

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

### 命名对齐（已执行，2026-11-04）

对齐到 scoped 包名，三处一起改：

| 位置 | 改前 | 改后 |
| --- | --- | --- |
| `package.json` `name` | `dsh-sidebar-rail` | `@skylerfee/dsh-sidebar-rail`（第 8 轮已改） |
| `cordis.patch.yml` 行 `name` | `dsh-sidebar-rail` | `@skylerfee/dsh-sidebar-rail`（本轮） |
| Desktop profile 安装键 | `dsh-sidebar-rail`（`link:`） | `@skylerfee/dsh-sidebar-rail`（`link:`，本轮重装） |

按 scoped 插件惯例写作完整包名（对照 `@nonamelego/dsh-catppuccin`、`@skylerfee/dsh-llm-opencode-go-live`）。

重装结果：

- `plugin_manager install_bundle` 返回 `application: applied`、`bundle: @skylerfee/dsh-sidebar-rail`、`version: 0.1.0`、`warnings: []`。
- profile 的 `dsh.profile.bundles` 现为 `['@skylerfee/dsh-sidebar-rail']`；`node_modules/@skylerfee/dsh-sidebar-rail` 为指向本仓库的符号链接。
- 宿主侧确认行已生效：`host/Config.listConfigs name=@skylerfee/dsh-sidebar-rail` 返回 `include:dsh-sidebar-rail`（`status: absent`，本插件无配置项，属正常）。
- pnpm 对 `link:` 安装提示「peerDependencies 不会从目标 node_modules 解析」——本插件的 peer 只用于宿主的兼容性声明，运行时能力全部由宿主注入，因此不影响加载。

遗留：profile 里仍保留旧的 `dsh-sidebar-rail` 依赖键（与 scoped 键指向同一目录）。它已不被任何 bundle 引用，若需清理可执行 `plugin_manager action: remove_bundle target: dsh-sidebar-rail`（或手改 profile 的 `dependencies` 后重装依赖）；本轮未动，避免误伤正在使用的 scoped 安装。

### 干净重装（2026-11-04，用户先移除旧安装）

用户把原插件从 Desktop profile 移走（依赖键与 bundles 均已清空），随后按本地路径重新安装：

| 项 | 结果 |
| --- | --- |
| `plugin_manager install_bundle target=<本仓库绝对路径>` | ✅ `application: applied`、`bundle: @skylerfee/dsh-sidebar-rail`、`version: 0.1.0`、`warnings: []` |
| profile 依赖 | ✅ 只有 `@skylerfee/dsh-sidebar-rail => link:<本仓库>`，无旧键 |
| `dsh.profile.bundles` | ✅ `['@skylerfee/dsh-sidebar-rail']`（启用） |
| 宿主行解析 | ✅ `host/Config.listConfigs name=@skylerfee/dsh-sidebar-rail` → `include:dsh-sidebar-rail` |
| 客户端注册 | ⏳ 安装后未重载页面，`shell.overlay` 占用者中尚无 `dsh-sidebar-rail.rail`；需重载渲染进程才会加载 client bundle |
| 残留 | 起初 `node_modules/dsh-sidebar-rail` 还有旧短名的孤立符号链接（无依赖记录引用）；已按用户要求在 scoped 安装稳定后清理，见下 |

### 旧短名链接清理（2026-11-04）

`node_modules/dsh-sidebar-rail` 是旧安装键留下的孤立符号链接，`package.json`、`pnpm-lock.yaml`、`node_modules/.modules.yaml` 都不再引用它。清理过程与结果：

| 步骤 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline`（插件管理器同款 pnpm 11.28.5） | ⚠️ 输出 `EPERM … node_modules/_tmp_…`，未能写入 profile（会话沙箱只允许写工作区），lockfile 与依赖均未变；pnpm 判定 `Already up to date`，也不会主动摘掉这个不在 lockfile 里的链接 |
| 删除该符号链接本身（`rm` 单条链接，已核实 `readlink` 指向本仓库、非实体目录） | ✅ 顶层不再有 `sidebar-rail` 链接；`node_modules/@skylerfee/dsh-sidebar-rail` 仍在 |
| 清理后核对 | ✅ `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` 与清理前逐字一致；`node_modules/.modules.yaml` 无短名引用；抽查 `dsh-context`、`dsh-notify-me`、`@nonamelego/dsh-catppuccin`、`@skylerfee/dsh-llm-opencode-go-live` 均完好；宿主行 `host/Config.listConfigs name=@skylerfee/dsh-sidebar-rail` 仍返回 `include:dsh-sidebar-rail` |

### 界面复验（已完成，见第 11 轮）

元数据错误已在真实界面确认消失，结论与完整证据见本轮顶部的「作用域包名启动失败修复（第 11 轮）」——那一轮不仅确认了详情页，还发现并修复了随后暴露的另一个启动失败（客户端工厂 ID 仍是短名，宿主按完整包名导入失败）。

本会话补充的独立证据：修复生效后，`client/Slots.listSubTree root=shell.overlay` 的占用者中出现
`{ id: "dsh-sidebar-rail.rail", order: 10, priority: 0, active: true }`，说明 client bundle 已按完整包名加载、增量注册生效。

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
