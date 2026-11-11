# 验证记录

## 0.4.0 发版前复验（2026-11-11，第 25 轮）

> 状态：**功能验收通过**。环境：macOS Desktop `0.2.2-rc.1`、macOS 27.2、中文界面、Catppuccin Latte / Frappé；本地分支 `refactor/typescript-migration`。

**本轮逐项确认（用户真机操作）**

| 项 | 结果 |
| --- | --- |
| 标题滚动显示 | 通过。长标题悬停时滚到末端并停住，离开立刻回位，静止态省略号正常，短标题不动 |
| 窗口焦点门禁 | 通过。切到别的应用后指针扫过左缘不唤出；已展开的轨失焦即收起；回到 DSH 后唤出恢复 |
| 键盘路径 | 通过。`Tab` 到轨仍能唤出（不受焦点与坐标门禁影响） |
| 轨与浮层一起收起 | 通过。`Tab` 到头像展开浮层、再 `Tab` 到页面其他位置时，轨与浮层一起收起 |
| 多屏右缘误唤出 | 通过。DSH 右边框贴屏幕边缘、指针移到另一块屏时不再唤出 |
| 空会话 / 分页 / 时钟 / 标题层级 | 通过（第 24 轮已验，本轮回归无变化） |

**本轮修的三个缺陷**（均由本轮的复验发现并修复）

- 标题既不滚动也没有省略号：`.dsr-row-title` 缺 `min-width: 0`，作为 column flex 的
  flex item 会撑到内容宽度，`clientWidth === scrollWidth`。修复后 `scrollLeft` 实测到达
  197px，两个 `data-` 标记与渐隐遮罩生效。
- 多屏下右缘鼠标把左侧轨拉出：`pointerenter` 由冒泡的 `pointerover` 合成，
  跨屏移出窗口时它带一个**被钳进视口**的 `clientX`，连坐标门禁都拦不住。改为只由
  `pointermove` 连续判定驱动唤出。
- 真实使用者无法安装：`peerDependencies` 的 cordis 范围停在 `~4.0.4 || ~4.0.5-alpha.1`，
  而目标宿主 0.2.2-rc.1 的 SDK 一律要求 `~4.1.0`，导致 `npm install` 报 ERESOLVE。
  改为 `~4.1.0` 并删除 `.npmrc` 的 `legacy-peer-deps` workaround。

**发版前检查（本机实测）**

- `npm run check` 退出码 0：7 条源码规则、96 单测（95 通过 + 1 个 K2 todo）、
  5 条产物规则、3 项产物测试。
- 移除 `.npmrc` 后 `npm ci` 成功（不再需要 `legacy-peer-deps`）。
- 独立目录安装 `npm pack` 产物：不带任何 npmrc 时 `added 10 packages`，
  ERESOLVE 消失；安装后 `lib/client.js` 在 vm 中能被 `__ModuleLoader__` 注册
  （id `@skylerfee/dsh-sidebar-rail`，factory 为函数），`lib/index.js` 是空 `apply()`。
- 打包清单 28 个文件：预构建 `lib/`、双语 README、18 张脱敏图、locale、
  `cordis.patch.yml`；无源码、`tmp/` 或测试。
- 文档：9 份文档无坏链，18 张图全部被引用、无孤儿。

**仍未验证**

- Windows / Linux Desktop（不渲染图标轨，未验证支持）。
- 真实 Web 客户端。
- 真实慢网络 / 远程故障下的失败态展示（仅离线替身覆盖）。
- 未登录账号与有余额账号的全部分支。
- 真实归档与空白会话的逐 ID 对账。

**已知缺陷（不修，已记录）**

- 「添加项目」的系统对话框标题为英文：宿主把 `NSOpenPanel.message` 硬编码成
  `Select Workspace Directory`，AppKit 不本地化该字段；纯 Client 插件无 Node 权限
  自行调起选择器。见 README 与 GLOSSARY。
- 默认收起的分区需要点两次才展开（K2）：按产品要求保持现状、不再作为待修问题跟踪。

## 最新源码验收与文档整理（2026-11-11，第 24 轮）

**尚未通过完整功能验收，文档与截图已完成**。环境、操作与可核对结果见[本轮报告](desktop-audit-2026-11-11.md)：本地 `de05173`，Desktop `0.2.2-rc.1`，macOS 27.2，中文、Catppuccin Latte / Frappé。`npm run check` 退出码 0，85 单测通过、1 个既有 K2 todo、3 产物测试通过。

真机完成最近会话 10→20、项目 10→15 且分页按钮消失、关闭重开保留项目展开并重置分页、方向键进入与 Tab / Shift+Tab 焦点流、全部入口的浅色 / 深色截图。仍复现 Escape 重开、K2、非全高浮层与添加项目失败；任务时钟实际在行尾。任务共享请求永久加载由受控执行实际源码复现，未制造真实慢网络。16 张功能图与两张预览见[使用指南](usage.zh.md)及[截图清单](images/README.md)。已恢复原有主题、会话与侧栏状态；未验证范围详见本轮报告，不用历史轮次代替本轮结果。

## 0.4.0 实现阶段：离线检查（2026-11-10，第 23 轮）

> 状态：**仅离线检查，未做真机验收**。本轮实现 #10（三个缺陷）、#11（整体滚动）、#12（项目展开持久化与原生文件夹）、#13（间距与视觉对齐），真机验收由票 #14 统一执行并记录。

### 环境

- 分支 `refactor/typescript-migration`，Node 26.0.0，macOS。
- `npm run check` 全链路：typecheck → check:source → test:unit → build → check:artifact → test:artifact。

### 结果

| 项 | 结果 |
| --- | --- |
| `tsc --noEmit` | 通过，零错误 |
| 源码规则 | 6 条全通过（banned / runtime-deps / i18n / model-purity / **颜色（新增）** / size） |
| 单元测试 | 68 项：67 通过，1 个 todo（K2 既有缺陷复现） |
| 构建 | `lib/index.js` + `lib/client.js` 生成成功 |
| 产物规则 | 5 条全通过 |
| 产物测试 | 3 项全通过 |

### 三个缺陷的离线结论

| 缺陷 | 离线状态 | 真机待验 |
| --- | --- | --- |
| 浮层定位偏移 | **已修（代码层）**：锚点水平基准改为轨的固定几何 `RAIL_REVEAL_WIDTH`（56），不再读按钮实时 rect；新增纯函数 `flyoutAnchorFrom`，并有 2 条流程测试覆盖「过渡中途 rect 与稳定 rect 得到同一锚点」。 | 需确认轨滑入/收起动画期间悬停图标，浮层位置正确 |
| 幽灵会话行 | **已修（代码层）**：`projectSessionRows` 对 `byId` 缺摘要的成员直接丢弃，不再产出 `title=id` 的占位行；丢弃时只记条数日志。测试改写为「缺摘要成员被丢弃」+「空项目返回零行」。 | 需确认空项目显示空态文案而非假节点 |
| 添加项目不可用（K1） | **已修（代码层）**：删掉把成功值丢成 `undefined` 的中间跳；三态按 `pickDirectory` 的真实契约判定（resolve string = 成功、resolve null = 取消、reject = 失败）；`createWorkspace` 失败单独分支。 | **必须真机验证**：这是唯一需要真实系统目录选择器的项 |

### K2 / K3 结论

- **K2（默认收起的分区首次点击不展开）：仍然存在**。`toggleSection` 仍是 `current[id] !== true`，`sectionIsOpen` 逻辑未变，本轮未触碰该机制。整体滚动改造只是让「点了没反应」的视觉表现从「滚动条变化不明显」变成「内容高度变化不明显」，**没有修复**。测试用例保持 `todo`，未删除、未放宽预期。
- **K3（浮层外框越界 2px）：未验证**。本轮改了边框与圆角（`--dsw-radius-md`、保留 1px border），是否仍越界需真机测量。

### 未验证项

- 全部视觉效果（间距、颜色、圆角、文件夹图标、整体滚动手感）——需真机肉眼对比。
- 项目展开状态跨「关闭浮层再打开」的真实持久化——离线测试覆盖了存储读写，但未经真实浮层开关验证。
- 窄窗 <768px、宿主展开态、Web 三种情况不渲染轨——本轮未改动该路径，按 0.4.0 结论沿用。

## 0.4.0 Desktop 复验（2026-11-10，第 22 轮）

完整逐项结果见当时保存的 B1–B15 功能验证报告（该报告已随历史文档清理移除）。本轮使用 macOS Desktop `0.2.2-rc.1`、本地 link 插件 `0.4.0`（`f88c660`）实机操作；`npm run check` 的 57 项测试通过，未修改实现。

- 已实测独立滚动、当前分区高度封顶、折叠时总高度不变、已有内容会话导航、任务面板导航、置顶刷新持久化和关闭重开恢复默认。
- 发现功能问题：添加项目在真机约 5s 后超时；回调探针另确认成功目录值被丢弃，登记调用为 0。默认收起的「已暂停」分区首次点击无效，第二次才展开。
- 几何记录：957×949 CSS px 视口中浮层顶边 48px、外框高 903px、底边 951px；有 2px 边框越界。三区初始高 126 / 225 / 269px，旧版最近区撑到 566px 的问题未复现。
- Desktop 响应式视口 767px 时轨道卸载，768px 时挂载，展开侧栏后卸载；真实 Web 和原生窗口缩放仍未运行。
- 空项目、真实归档/空白成员对账、新草稿项目归属、已安装但关闭的插件样本尚未补齐；**完整验收未通过**。测试置顶及界面状态已恢复，旧轮次以下保留为历史记录。

## 0.4.0 浮层分区化（2026-11-09，第 21 轮）

规格：spec-historical-0.4.0-sectioned-flyout.md。票：#1 骨架、#2 工作区三分区、#3 项目行展开、#4 新建会话与添加项目、#5 任务三分区、#6 插件两分区、#7 验收（GitHub #1–#7）。

### 改动

- **占满高度**：`flyoutSectionedHeight(viewportHeight, topClearance)` 取代 `workspaceFlyoutHeight`。浮层从 `--dsh-frame-top-clearance` 之下（读宿主 token，读不到退回 48px）占到窗口底；`flyoutShell` 新增 `topFlush` 走这条路径。三个浮层全部改用它，不再有内容自适应的浮层。
- **分区原语**：`.dsr-section` = 固定 `.dsr-section-head`（`flex:none`）+ 独立滚动 `.dsr-section-body`；分区之间 `--dsw-alias-border-l1` 分隔。上限由 JS 算出 `--dsr-section-cap`（`sectionMaxHeight` = 可用高度 1/3 向下取整），CSS 里 `max-height:var(--dsr-section-cap, 33.3333%)` 兜底；`flex:0 1 auto` 让内容少的分区保持自然高度而不撑满。
- **收起**：`FlyoutSection` 的标题是按钮，带 `aria-expanded`；收起时**卸载** body（避免下次展开回到旧滚动位置）。折叠表是组件 state，不写存储，默认值由 `sectionIsOpen` 给出（B14）。
- **工作区三分区**：置顶 / 项目 / 最近会话，全默认展开。置顶项目不在项目区重复——`deriveSections` 本就分区，新增回归测试锁住。
- **项目行**：`ProjectRow` = 始终可见的展开箭头 + 名称 + 新建会话 + 图钉。展开后列出该项目**全部** `sessionIds` 成员（`projectSessionRows`：不过滤、不排序、不限条数），归档行标注「已归档」，缺条目降级为 id 行。
- **新建会话 / 添加项目**：`startSession(workspaceId)` 与 `pickDirectory()` + `workspaces.create({ path })`。`pickedDirectory` 把「选定 / 取消 / 失败」收成一个形状；相对路径判为失败（宿主按绝对路径登记项目）。`inject` 增加了 `workspaces` 服务。
- **任务三分区**：`normalizeTasks` 不再过滤 paused/ended，改为带出 `status`；`taskStatusOf` 把 legacy `inactive` 折成 `ended`、无 status 时按 `active` 布尔翻译、未知状态返回空串（宁可少列也不错列）。`groupTasksByStatus` 恒返回三键。只默认展开「进行中」。
- **插件两分区**：`normalizePlugins` 不再只留 enabled，保留 `enabled` 布尔并由 `groupPluginsByState` 二分；未安装（`installed:false`）仍在归一化阶段被剔除，所以官方按需插件不会落进「未启用」。

### 已完成验证（可在本机复跑）

跑法：`cd dsh-sidebar-rail && npm run check`

| 项 | 结果 |
| --- | --- |
| 仓库规则 4 条（regions / manifest / banned / i18n） | ✅ 全过；i18n **52 key** 中英对齐 |
| 两入口语法（`node --check client.js` / `index.js`） | ✅ |
| 纯逻辑单测 | ✅ **53 项全过**（0.3.3 为 35 项） |
| `flyoutSectionedHeight` | ✅ 1000/48→952、900/48→852；矮于 chrome 带→0；clearance 不可用退回 48 |
| `sectionMaxHeight` | ✅ 900→300、852→284；极小值→0，不产出负值/小数 |
| 高度不随内容变化（0.3.2 性质） | ✅ 单测锁住：同一视口下条数 1 与 20 得到同一高度 |
| `sectionIsOpen` 默认值 | ✅ 三区全展开 / 任务仅「进行中」/ 手动收起覆盖默认 |
| 置顶项目不重复 | ✅ `pinnedRows` 与 `normalRows` 的 id 集合互斥且并集等于全部项目 |
| `projectSessionRows` 不过滤 | ✅ host 顺序（不按时间重排）、归档与空白都保留、未知成员降级、脏输入为空 |
| 任务三状态分组 | ✅ `active`/`paused`/`ended` 各归各位；空输入返回完整三键；未知状态被丢弃 |
| 任务下次运行时间 | ✅ 按宿主同款公式 `deliveryFloorEndsAt > scheduledAt ? floor : scheduledAt`；`ScheduleCatalogEntry` 无 `nextRunAt`，回归测试锁住乱入字段不会胜出 |
| 目录选择被拒 ≠ 取消 | ✅ 后端无 native 能力时报失败态并指向宿主添加按钮；只有 `null` 才是静默取消 |
| 插件二分 | ✅ 归一化把 `installed` 一并带出；分区显式按 `installed && !enabled` 判据，未安装项两侧都不进；宿主自带项在归一化阶段剔除 |
| 目录选择三结局 | ✅ picked / cancelled（静默）/ failed；相对路径判失败；非 Error 拒绝有可读文案 |

### 本轮据调研修正的事实（已核对宿主源码）

| 事实 | 对实现的影响 |
| --- | --- |
| `catalog()` 的条目是 `scheduledAt` + 可选 `deliveryFloorEndsAt`，**没有 `nextRunAt`** | `client.js` 原写 `task.nextRunAt ?? task.next ?? task.scheduledAt`，前两键在契约中不存在；已改为 `taskNextRun`（宿主同款公式） |
| `pickDirectory()` 在 Desktop 大概率可用但未真机验证；后端无 native 能力时被 `directory-picker/unavailable` 拒绝 | 失败态不再是通用文案；`pick` 的拒绝走 `pickedDirectory`，指向宿主自带添加按钮 |
| 宿主无 pick 动词时传 `null` 会被读成「用户取消」 | 已改为抛错，落到失败态——静默取消会吞掉原因 |
| `WorkspaceView.sessionIds` 本就含归档/空白、不含子代理 | `projectSessionRows` 不过滤：与 host 行为一致，未额外按 `origin` 筛选 |
| `SessionSummary` 无 `workspaceId`；`archivedSessionIds` 在 `WorkspaceSnapshot` 顶层 | 反查只走 `WorkspaceView.sessionIds`；`archivedIds` 从 `readWorkspaces(state => state.archivedSessionIds)` 读 |
| `workspaces.create({path})` 只登记已存在目录、幂等、不建目录 | 添加项目不调用任何 `mkdir`/`createDirectory`；重复选同一目录不产生重复行 |

### spec §9 不做什么（逐条核实）

| 非目标 | 核实方式 | 结果 |
| --- | --- | --- |
| 不做 TypeScript 化 | 仓库内无 `.ts` 文件 | ✅ 仍为零构建手写 JS（ADR-0002） |
| 不做会话级置顶 | `grep pinSession` 无命中 | ✅ 只用插件自己的 `pinnedWorkspaceIds` |
| 不做任务详情定位 | `grep openTaskDetail\|selectedId` 无命中 | ✅ 点条目只调 `selectPanel('schedules')` |
| 不做浮层内插件开关 | 唯一的 `setPlugins` 是 `useState` setter（存列表），非开关操作 | ✅ 没有写插件的调用 |
| 不持久化展开状态 | 全文件只有三处存储写入：`writeStore` 定义、`recentCount`、`pinnedWorkspaceIds`；`foldedSections` 与 `expandedProjects` 不碰存储 | ✅ 每次打开回到默认 |

### 高度算式在真机视口下的取值（供验收对照）

以 `docs/verify.md` 早前记录过的 macOS Desktop 视口逻辑高度 982 为例：

| 量 | 值 | 推导 |
| --- | --- | --- |
| 浮层高度 | **934 px** | `flyoutSectionedHeight(982, 48)` = 982 − 48 |
| 每区上限 | **311 px** | `sectionMaxHeight(934)` = ⌊934 / 3⌋ |
| 三区满额合计 | 933 px | 311 × 3，**不超过**面板 934 |

真机验收时可直接比对：浮层顶边应 ≈ 48（chrome 带下沿），底边应 ≈ 982，高度 ≈ 934；某区内容超过约 311px 后应开始自己滚动。

### 两轴 code review 的发现与处置（2026-11-09）

对 `68668f7...HEAD` 做了 Standards + Spec 两轴审查。Standards 轴报出的问题**已全部处置**：

| 发现 | 判定 | 处置 |
| --- | --- | --- |
| **BLOCKER**：`const sessions = projectSessionRows(row.sessionIds, sessions.byId, …)` 同名 `const` 自引用，命中 TDZ，工作区浮层每次渲染抛 `ReferenceError` | ✅ 属实，已复现 | 改名 `sessionRows`。单测测的是纯函数，调用点没覆盖，所以此前 `npm run check` 一直绿 |
| 违反硬约束 #8：`addProject` 没有超时，选择器/Create 卡住会让按钮永久停在「选择中…」 | ✅ 属实 | 整段与 `REMOTE_TIMEOUT_MS` 竞速，超时进失败态 |
| 展开/收起状态在浮层关闭后不重置（`RailColumn` 从不卸载） | ✅ 属实，与 spec「每次打开都是默认状态」和 B14 矛盾 | `dismiss`/`retract` 关闭时清空 `foldedSections`、`expandedProjects`、`projectAction` |
| 新增函数 JSDoc 是英文，违反 §6「每个函数前有中文 JSDoc」 | ✅ 属实 | 本次 diff 新增的 11 个函数全部改为中文（全仓另有 ~117 个英文 JSDoc 属 0.3.x 历史债，不在本票范围） |
| `flyoutShell` 的 JSDoc 因插入 `frameTopClearance` 而失联 | ✅ 属实 | 重排为「`frameTopClearance` 自带 doc → `flyoutShell` 的 doc 紧贴其定义」 |
| 丢弃未知任务状态 / 未安装插件时无日志 | ⚠️ 部分成立 | 纯函数区不允许副作用（§2），改为在 `writer` 归一化边界记录「保留 N / 收到 M」并带 `[dsh-sidebar-rail]` 前缀 |
| 4 个 i18n 键已成死键（`section.tasks`、`section.plugins`、`empty.tasks`、`empty.plugins`） | ✅ 属实 | 删除；`check.mjs` 只校验中英对齐，不校验使用，所以此前没报 |
| 新建会话按钮默认 `opacity:0`，只在悬停时出现，而 spec §3.2 要求「始终显示」 | ✅ 属实（Spec 自查发现） | 改为常显（图钉与新建会话都常显），悬停只加背景 |

Judgement calls（Duplicated Code、Data Clumps、Divergent Change 等）**本轮不处理**：
它们描述的是可读性取舍，改动面覆盖 `renderFlyout` 全部五个分支，风险高于收益。

反面暴露的仓库级问题已写进 [CODING_STANDARDS.md](../CODING_STANDARDS.md) 第 7 条：
渲染层零单测覆盖，所以「同名 `const` 自引用」「只在打开态执行的路径」「新增 state 谁重置」
这三类错误必须靠 review 与规范约束，不能指望 `npm run check`。

### 真机验收（2026-11-09，macOS Desktop 0.2.2-rc.1，外接屏 1920×1080，DPR=1）

**环境突破**：此前判定"无法截图"是错的。机器有 3 个显示器（内建 3024×1964 + 两个 1920×1080），
`screencapture -x` 默认只截主屏（上面是别的应用）；加 `-D 2` 即可截到 DSH 所在的外接屏。
同时 profile 已从 npm `0.3.3` 副本切成本地 link（`cmp` 验证 `client.js` 与本仓库字节一致）。

**渲染进程 `innerHeight` = 1092**（比屏幕 1080 高，含窗口装饰差）。

#### 已实测通过

| # | 用例 | 实测 | 判定 |
| --- | --- | --- | --- |
| B1 | 浮层占满可用高度 | 顶边 y=80（chrome 带下沿），底边 y=1078=屏底，总高 **999px** | ✅ |
| B1 | 三个分区各带固定标题 | 分隔线在 y=237 / 540 / 1029；标题「置顶项目」「项目」「最近会话」齐全 | ✅ |
| B1 | 不覆盖顶部 48px chrome 带 | 浮层顶 80 > chrome 带下沿，红绿灯可见 | ✅ |
| B1 | 「添加项目」在「项目」区标题行右侧 | 可见，文案正确 | ✅ |
| B1 | 项目行 `+` 与图钉常显 | 每行两个按钮都常显（本轮修掉的 `opacity:0` 悬停问题已生效） | ✅ |
| B4 | 底部条数步进器 | 「最近会话条数 − 8 +」，可点 | ✅ |
| B5 | 项目展开列出会话 | `home` 项目展开后列出 3 条会话（含相对时间），宿主顺序 | ✅ |

#### 实测发现 1 个缺陷（B3 违规）

| # | 用例 | 实测 | 判定 |
| --- | --- | --- | --- |
| B3 | 每区 ≤ 可用高度 1/3 | 「最近会话」区 **566px**，而 sections 容器 949px 的三分之一是 **316px** | ❌ 违规 |

**根因**：`max-height: var(--dsr-section-cap, 33.3333%)` 里，百分比 `max-height` 在**高度由内容决定的 flex 项**上不生效（百分比需要父容器有确定高度），所以回退值等于没有；同时 React 的 inline `--dsr-section-cap` 自定义属性也未可靠落到计算样式上。结果最后一个分区撑满了面板剩余空间。

**修复**：改由 JS 内联下发像素值——`sectionBudget = flyoutSectionedHeight(innerHeight, clearance) − FLYOUT_CHROME_HEIGHT`，再 `sectionMaxHeight()` 取三分之一，直接写进每个分区的 `style.maxHeight`。已同步到 profile，`npm run check` 通过。

**验证状态（重要）**：`client-hmr` 只重建 client 模块，**不替换已插入的 `<style>` 节点**（样式由 `apply()` 里的 `ctx.effect` 一次性写入 `document.head`）。因此 CSS 相关改动（包括本次 B3 修复的百分比兜底规则）在 HMR 之后**仍是旧值**，必须手动刷新页面（`Cmd+R`）才生效。上一轮据此误判过「修复未生效」，实际是样式表没更新。`client-hmr` 已确认热重载（事件流捕获到 `{"type":"rebuilt","id":"@skylerfee/dsh-sidebar-rail","rev":"9efe74fd7703"}`，服务端 bundle 含新逻辑），但**已挂载的 React 组件实例未重新渲染**，页面仍在跑旧渲染结果。需要主动刷新一次页面才能看到修复后的分区高度。

**算式与实测的交叉验证**（修复正确性的代码级证据，不依赖刷新）：

| 量 | 计算值 | 实测值 | 一致 |
| --- | --- | --- | --- |
| 渲染进程 `innerHeight` | 1092（由 cap 反解） | — | — |
| 浮层高度 `flyoutSectionedHeight(1092, 48)` | 1044 | 999（含 45px 窗口装饰差） | ✅ 同一基准 |
| 分区预算 `panel − FLYOUT_CHROME_HEIGHT(96)` | 948 | sections 容器 949（±1px 取整） | ✅ |
| 分区上限 `sectionMaxHeight(948)` | **316** | 949 / 3 = **316** | ✅ |

即修复后的 cap 恰好等于实测 sections 容器的三分之一，B3 在数值上成立；刷新后应看到「最近会话」区封顶在 316px 并自行滚动。

### 验收总表（2026-11-09 实时状态）

图例：✅ 真机实测通过 ｜ 🔧 已修复待刷新复测 ｜ ⬜ 未测（代码路径已核实存在）

| # | 用例 | 状态 | 依据 |
| --- | --- | --- | --- |
| B1 | 三分区 + 各有固定标题 + 占满高度且不盖红绿灯 | ✅ | 顶边 y=80、底边 y=1078、总高 999px；分隔线 237/540/1029；红绿灯可见 |
| B2 | 滚动任一分区，标题与其他区不动 | ⬜ | 结构上是 flex:none 标题 + 独立 overflow-y:auto body，未经滚动实测 |
| B3 | 每区 ≤ 可用高度 1/3，不强行撑满 | 🔧 | 实测发现违规（最近会话 566px vs 上限 316px），已两次修复；**待刷新页面复测** |
| B4 | 收起/展开分区不改浮层总高度 | ⬜ | 收起只卸载 body，高度由 shell 定死；未做收起前后的像素对比 |
| B5 | 展开项目显示全部成员、宿主顺序、不限条数 | ✅ | home 展开后列出 3 条会话，含相对时间，宿主顺序 |
| B6 | 空项目显示空态 | ⬜ | empty.projectSessions 文案在；无空项目可实测 |
| B7 | 点项目下会话跳转并收起浮层 | ⬜ | 代码核实：openSessionFromRail 先 retract() 再 openSession |
| B8 | 新建会话后跳转并收起 | ⬜ | 代码核实：startSessionInProject 先 retract() 再 startSession |
| B9 | 添加项目后留在浮层；取消无变化 | ⬜ | 代码核实：addProject 只调 createWorkspace，无跳转无建会话；**native 后端从未真机跑过**（ADR-0005） |
| B10 | 置顶在两区之间移动、刷新后保持 | ⬜ | 持久化沿用 0.3.x 已验证路径；本轮分区移动未目视 |
| B11 | 任务三区、仅「进行中」展开、空区有文案 | ⬜ | 代码核实：active 默认展开，paused/ended 默认收起 |
| B12 | 点任务条目打开面板 | ⬜ | 代码核实：retract(); selectPanel('schedules') |
| B13 | 插件两区、未启用只含已安装但关闭 | ⬜ | 代码核实：groupPluginsByState 两侧都校验 installed，归一化剔除未安装项 |
| B14 | 关闭重开回到默认展开 | ⬜ | 已修：dismiss/retract 清空 foldedSections/expandedProjects；未刷新复测 |
| B15 | 窄窗/展开态/Web 不渲染轨 | ⬜ | shouldRenderRail 单测仍在；本轮未做真机复核 |

**统计：B1（含 5 个子项）与 B5 实测通过；B3 发现缺陷并修复，待复测；其余 12 项未测。**

### 复验步骤（人工，刷新页面后）

1. **Cmd+R 刷新页面** —— CSS 改动只有刷新后生效（见上文 HMR 说明）。
2. 收起侧栏，鼠标移到窗口左缘（约 12px）唤出轨道，悬停「工作区」打开浮层。
3. 量 B3：「最近会话」区高度应封顶在 **316px** 左右并出现内部滚动，而不是撑到 566px。
4. 滚动任一分区，确认该区标题行 y 坐标不变（B2）。
5. 收起「项目」区再展开，确认浮层总高度不变（B4）。
6. 依次核对 B6–B15，每条把可核对的量记进本文件。

### 本节结束时（2026-11-09）的仓库状态

- 7 张票的代码、单测、i18n、README 均已落地；`package.json` 版本 **0.4.0**。
- `npm run check` 通过：57 项单测 + 4 条仓库规则 + 48 个 i18n 键对齐。
- **真机验收只完成 B1（含 5 个子项）与 B5**；B3 的缺陷已定位并修复但未复测；其余 12 项未测。
- **因此 0.4.0 仍不具备发布条件**，直到上表全部转为 ✅。

## 工作区浮层定高与两区等分（2026-11-08，第 20 轮）

用户反馈：调整最近会话条数会改变浮层高度，且希望项目区与最近会话区大小基本一致、各自标题行固定、两区之间有明确分隔线。

### 改动

- **定高**：工作区浮层改为视口比例定高（`0.7 × innerHeight`），并用 `flyoutPlacement` 的预算钳制，保证不越出窗口。新增纯函数 `workspaceFlyoutHeight`（`#region pure-data`），任务/插件/账号浮层仍保持内容自适应。
- **两区等分 + 标题固定 + 分隔线**：浮层 body 改为 `.dsr-split-body`（flex 列），内部分成两个 `.dsr-pane`，各自 `flex:1 1 0` 平分剩余高度；每个 pane 再拆成固定标题 `.dsr-pane-head`（`flex:none`）与独立滚动 `.dsr-pane-scroll`（`overflow-y:auto`）；`.dsr-pane + .dsr-pane` 用宿主的 `--dsw-alias-border-l1` 画出分隔线。
- 采用 `split` 参数时跳过原来的 `.dsr-flyout-body` 滚动包装层——它会把子元素压回内容高度，导致 flex 等分失效。
- 分区改用 flex 而不是 JS 算常数：CSS 知道真实的 head/步进器高度，常数估不准（曾按 `0.38` 视口比例实现，实测偏成 0.76:1）。

### 真机验证（macOS Desktop，折叠态，视口逻辑高度 982）

| 项 | 结果 |
| --- | --- |
| 浮层定高 | ✅ 666 px；条数 6 → 15 时高度不变，只改变是否滚动 |
| 两区等分 | ✅ 上区 314.5 px / 下区 351.0 px = **0.90 : 1**（下区含固定标题行，故略高） |
| 标题行固定 | ✅ 滚轮滚动项目列表时，「工作区」「置顶项目 · 项目」「最近会话」标题不动 |
| 分隔线 | ✅ 「最近会话」上方 1px 分隔线（逻辑 y≈405.5） |
| 空态 | 新增 `empty.recent` 文案：最近会话为空时显示空态而非空标题 |
| `npm run check` | ✅ 仓库规则 4 条 + 两入口语法 + **35 项测试**；i18n 37 key 中英对齐 |

### 未验证

- 矮窗口（可用预算小于 0.7×视口）时的实际观感，仅有 `workspaceFlyoutHeight` 的钳制单测。
- 项目为空 / 最近会话为空两个空态的具体渲染未逐个截图核对。

## 0.2.0 功能复核与交互审查（2026-11-04，第 13 轮）

在 macOS Desktop `0.2.2-rc.1`、插件提交 `0e1a6dd` 上复核：当前加载、组件重挂载、图标轨随折叠显隐、会话跳转、置顶、用户插件过滤和真实头像显示通过，`npm run check` 的 20 项测试通过。含用户反馈后的补充复核，共发现 6 项 P2 问题和 1 项 P3 文档问题；其中矮窗口裁切、常规 Tab 路径不可达、会话标签遮挡已真机复现，切换后的永久加载、结构化失败伪装空列表已通过受控源码探针复现，行状态背景覆盖由源码确认。详见本轮完整报告与复现步骤（该报告已随历史文档清理移除）。

补充确认：会话页折叠导航栏后，首个「对话」标签被左侧 56px 图标轨遮挡，「上下文」「编队」仍可见；切到上下文后无法直接用鼠标点击「对话」返回。可访问性树仍保留该标签，展开侧栏后入口恢复。本项仅记录，未修复；补充复核结束时恢复开始时的侧栏展开与「对话」视图。

本轮未修改实现、未做整个应用冷启动；首次复核的测试置顶已撤销，当时恢复原会话、插件开启、侧栏折叠和大窗口。补充复核的结束状态见上段。未保存临时截图。

## 第 15 轮遗留：图标区域更容易触发轨的反复滑出/隐藏（2026-11-05，第 16 轮）

第 15 轮修掉了热区与轨的 `pointerleave` 互激，但用户复验后反馈**仍会振荡，且在图标区域更容易触发**。

### 根因

`dismiss()` 把两个语义混在一起：**关闭浮层** + **收起轨**。而每个图标容器挂着 `onPointerLeave: scheduleClose`，200ms 后调用 `dismiss()` → 连带 `setRevealed(false)`。

鼠标在图标之间移动时会不断跨过图标边界：每次 `pointerleave` 排队一次收起，轨收起后边缘热区又被指针碰到 → 重新滑出 → 再次跨边界 → 再次收起。**图标区边界最密集，所以那里最容易触发**——正好对应反馈。

### 修复

拆成两个函数，语义各自清楚：

| 函数 | 行为 | 用在哪 |
| --- | --- | --- |
| `dismiss()` | 只关浮层，不动轨 | hover 结束的 200ms 定时器、全局 Escape |
| `retract()` | 关浮层 **并** 收起轨 | 点浮层条目、打开工作区/会话、浮层内 Escape、图标点击导航、账号座位（共 12 处） |

即：**鼠标在轨上移动只影响浮层，不影响轨的显隐**；只有「交互真正结束」的动作才收轨。

### 真机复验（折叠态，判据为轨右边框亮度差：完全滑出 +17.8 / 隐藏 0.00）

| 场景 | 结果 |
| --- | --- |
| 指针移到热区唤出 | ✅ +17.78（完全滑出） |
| 在图标区（y=109/149/189/229）上下扫动 8 次 | ✅ 三帧一致 **+14.46**，轨保持展开、**无振荡** |
| 点浮层条目 | ✅ 会话切换 + 轨收起 |

（扫动后 14.46 与 17.78 的差异来自图标 hover 高亮改变相邻像素，不影响「展开/隐藏」判定。）

### 验证方法教训

第 15 轮曾用「轨内亮像素数」判断滑出，但图标是描边线条、亮像素少（918 主要来自标签文字），导致多次误判；且重载后 `Cmd+B` 会把状态切回展开，未先确认折叠态就测量。本轮改用**轨道右边框竖线亮度差**（滑出 +17.8 / 隐藏精确 0.00）并先确认折叠态，判据可靠。

## 第 14 轮遗留：鼠标靠近时轨反复出现又隐藏（2026-11-05，第 15 轮）

用户反馈：指针放到触发区域后，轨有概率不断出现又隐藏。

### 根因（两条叠加）

1. **`pointerleave` 互相触发**：热区（8px，z-index 59）与滑入的轨（56px，z-index 60）重叠。轨滑入即盖住热区 → 热区收到 `pointerleave` → 收起 → 轨滑出又露出热区 → 再 `pointerenter`，两态互相追逐。
2. **热区落在 macOS 窗口 resize 带内**：8px 热区贴着窗口左缘，指针在 x<8 时是 resize 光标，**事件到不了页面**。这解释了「有概率」——取决于指针落点是否越过不可见的边缘带。

### 修复

- **热区不再处理 `pointerleave`**，只负责「进入即唤出」；收起改由轨自身的 `pointerleave` 驱动，并加 **180ms 防抖**（`RETRACT_DELAY_MS`），指针划过边缘不闪。
- 保留全局 `pointermove` 按坐标兜底：`keepsRailRevealed(clientX, 56)` 判定指针是否仍在轨宽内；浮层打开时该判定让位，指针可自由移向浮层。
- **热区加宽到 12px**，避开 macOS 窗口边缘的 resize 通道（原先 8px 的落点常常收不到事件）。

### 真机复验（判据：轨右边框竖线的亮度差，滑出 +17.8 / 隐藏 0）

| 场景 | 结果 |
| --- | --- |
| 指针移到热区（x=10） | ✅ 轨滑出 |
| 指针在热区内停留，连抓 4 帧 | ✅ 四帧完全一致（+17.78），**无闪烁** |
| 指针移开到 x=500 | ✅ 收起（0.00） |
| 反复进出热区 10 次后停止 | ✅ 终态稳定，不再自激 |
| 滑出 → 打开浮层 → 点击会话 | ✅ 会话切换，轨同时自动收起（0.00），三标签完整可见 |

### 未验证

- 真实触控板/鼠标的 180ms 防抖手感未逐帧核对（合成指针无法复现真实加速度）。
- 触屏与多指针设备未测。

## 第 13 轮遗留：点击浮层项后轨不自动收起（2026-11-05，第 14 轮）

用户真机反馈：从轨唤出浮层、点击浮层里的会话后，轨不收起，必须把鼠标从轨上移开才隐藏。

### 根因

轨的收起只挂在 `onPointerLeave` 上。点击浮层条目时指针位于浮层（x ≥ 64px，不在轨的 0–56px 区域内），浮层卸载后**不会产生任何轨上的指针事件**，于是 `revealed` 保持 true。

### 修复

新增统一入口 `dismiss()`（`setOpen(null)` + `setRevealed(false)`），替换全部 10 处关闭路径：浮层内各行的点击、打开工作区/会话、Escape（全局与浮层内）、200ms 关闭定时器、图标点击后的导航。这样收起不再依赖指针事件，而是**每次关闭浮层的动作都显式收起**。

同时补齐相关 `useCallback` 依赖数组（`[clearTimers, dismiss]`、`[openWorkspace, dismiss]`、`[openSession, dismiss]`、`[open, dismiss]`）。

### 真机复验

折叠态（轨滑出）→ 悬停工作区图标 → 点击「dsh 能力查询与接入」：标题栏与正文切到该会话，**轨在同一帧内自动收起**，窗口左缘只剩内容区；「对话 / 上下文 / 编队」标签完整可见。

### 顺带观察

本轮截图确认 `data-dsr-current` 的**选中底色现在生效**（浮层内当前会话行有 `--dsw-alias-interactive-bg-hover` 底色），与第 12 轮「该宿主版本计数为 0」的记录不同——说明该计数在本次运行时可用。第 12 轮的说明保留为历史，当前状态以此处为准。

## 0.2.0 复核报告修复（2026-11-05，第 13 轮）

针对 0.2.0 Desktop 功能复核与交互审查发现的 6 项 P2 + 1 项 P3，逐项修复。

| # | 问题 | 根因 | 修法 | 复验 |
| --- | --- | --- | --- | --- |
| 1 | 切换到别的浮层再切回，永久停在「加载中」 | `loadRemote` 的 cleanup 只把 `live` 置 false，没重置 `started.current[key]`；切回时提前 return，旧请求结果也被丢弃 | cleanup 里同步重置 `started.current[key] = false`，切回可重试 | 单测覆盖状态机 |
| 2 | `{ok:false}` 失败帧与服务缺失被当成空列表 | Promise resolve 即进 `ready`，未判 `ok`；服务不存在返回 `null` 也落进同一空态 | 新增 `remoteOutcome`：`ready` / `failed` / `unavailable` 三态；`unavailable` 归入失败态（带「打开面板」出口） | 单测覆盖四种输入 |
| 3 | 矮窗口浮层越出底部，最近会话被截 | `max-height: calc(100vh - 32px)` 没减去浮层自身的 `top` | 新增 `flyoutPlacement`：按锚点算实际可用高度，`top`/`bottom`/`maxHeight` 一起给出；不越界优先于最小高度 | 单测覆盖 4 种窗口/锚点组合 |
| 4 | Tab 逐个换掉浮层，进不去列表 | 图标 `onFocus` 各开浮层，Tab 顺序把列表换掉 | 图标上 `ArrowDown`/`ArrowRight` 移焦进浮层首个可交互项；浮层 `Escape` 把焦点交回触发按钮；图标补 `aria-haspopup`/`aria-expanded` | 键位与焦点路径按实现核对 |
| 5 | 行内 `background: transparent` 压过 hover/current/focus 底色 | `Row` 始终写行内背景，优先级高于 CSS | 去掉行内背景，状态底色交还 CSS；同时让 `focus-visible` 保留可见焦点 | 源码确认 |
| 6 | 折叠后 56px 浮轨盖住会话页首个「对话」标签 | 宿主折叠时主区占满窗口，标签行无左侧避让；浮轨常驻覆盖 | **轨默认隐藏**（`translateX(-100%)`），8px 左边条热区或键盘焦点唤出 | 真机确认：折叠后「对话 / 上下文 / 编队」三标签完整可见；指针移到左缘轨滑出 |
| 7 | `design.md` 保留已修 bug 的旧 API 示例 | 文档滞后于实现 | 改为 `pluginManager.listBundles()` 与裸 `SessionId`，并写明「不要传对象」的原因 | 文档核对 |

### 代价与取舍（问题 6）

轨从「常驻」改为「默认隐藏、靠近滑出」    —— 这**背离了原 PRD 的「常驻图标轨」语义**，已同步修改 `PRD.md` 与 `AGENTS.md`（新增第 4 条硬约束，禁止改回常驻）。原因是宿主这一版不给标签行留左侧空间，常驻必然遮挡；两条路只能选一条，本次选「不遮挡」。

### 检查

`npm run check` 通过：仓库规则 4 条 + 两个入口语法 + **22 项测试**（新增 `remoteOutcome`、`flyoutPlacement` 各 1 条）。

### 未验证

- 问题 1、2 的修复来自受控探针与单测，**未在真实网络故障下复验**（本轮未制造真实 RPC 失败）。
- 问题 3 的真机复验需要把窗口缩到屏幕上半区，本轮先改了实现与单测，**矮窗口真机回归留待下一轮**。
- 问题 4 的键盘路径按实现核对，**未做完整 Tab/Escape 焦点遍历审计**。
- 滑出动画的 160ms 手感、以及滑出状态与浮层交互（指针离开轨但浮层仍开）未逐帧验证。

## 账号浮层的设置入口（2026-11-05，第 19 轮）

用户要求：头像浮层现在只有账号信息，需要一个设置入口。

### 为什么不是按钮，而是一行路径说明

先按「新行为优先使用宿主公开扩展点」核对了三条可能路径，**都不成立**：

| 设想的做法 | 结论 |
| --- | --- |
| `ctx.layout.selectPanel('settings')` | ❌ 设置不是 main panel。`MainPanelId` 只含已注册的中央面板（`layout.selectPanel` 会 `throw` 未注册 id），设置是 `sidebar.settings` 里的一个 dialog，不进 `main` 槽 |
| `ctx.shortcuts` 派发 `settings.open` | ❌ `Shortcuts` 接口只暴露 `register` / `registerFixed` / `describeBinding` / `edit` 等，**没有 dispatch/invoke**；命令的 `run` 闭包在宿主 `ui-settings-general` 内部 |
| 复用 `settings.launcher` 的 `openSettings` | ❌ 该槽是 **single** 且已被宿主账号插件 `ui-settings-account` 独占（`ctx.remoteAccess.whenAccess('account/watch', …)` 注册 `AccountMenu`）；注册会顶替宿主条目。其 `openSettings` 只作为 owner prop 下发给那一个占位者 |

（`sidebar.settings` 内部 store 的 `actions.open()` 与 `entriesOfSlot(...).inject()` 属契约外，未采用。）

因此按用户选定的方案 C 实现：**不新增按钮，只把路径说明写清楚**。

### 改动

- 新增 i18n key `account.settingsPath`（zh/en）：`设置：展开侧栏后点左下角「设置」。` / `Settings: expand the sidebar, then choose Settings at its foot.`
- 账号浮层在原有 `account.hint` 之下渲染该行；紧接着仍是既有的「展开侧栏」动作（复用已验收的 `toggleSidebar()`，未改动其行为）。

### 真机验证（macOS Desktop 0.2.2-rc.1，折叠态，中文界面）

账号浮层实际渲染，自上而下：

```
账号与设置
余额  ¥0.00
赠金  ¥0.00
查询用量  充值
账号信息与用量由设置中的账号页提供。
设置：展开侧栏后点左下角「设置」。        ← 本轮新增
展开侧栏
```

- ✅ 新增行文案完整、未截断（像素核对：物理 y≈1790 行内文字清晰）。
- ✅ `npm run check` 通过，i18n 从 35 key 增至 **36 key**，zh/en 对齐。
- ✅ 宿主入口位置核实：侧栏展开后左下角确有「设置」按钮，宿主自身绑定 `⌘,`（`ui-settings-general` 的 `settings.open`，`desktop:macos` 默认 `Comma + primary`）。

### 未验证

- 本轮未能逐帧确认「展开侧栏」点击后的展开结果：合成鼠标在这台机器上多次落到被前台遮挡的其他窗口，窗口层序不稳定。该动作调用的是「更多」浮层里**同一个** `toggleSidebar()`，那条路径已在第 16 轮验收过，本次未改其代码。
- 英文界面下该行的实际渲染未截图核对（仅确认字典两侧对齐、`check.mjs` 通过）。

## 0.3.1 三项优化的验收修复（2026-11-05，第 18 轮）

第 17 轮的三项功能经真机 + 代码链路复核后，发现并修复 4 个缺陷。**上一轮「真机验证」表里的两项结论不成立，已在本轮更正**，详见文末。

### 修复 1（P0）：会话状态标识完全没有接线

`sessionStatusOf` 定义完整、单测 4 条全绿，但**全仓库零调用点**；`deriveSections` 加了 `statuses` 形参却在函数体内一次都没用；行对象没有 `status` 字段，`row.status` 恒 `undefined`，`StateMark` 永不渲染。即：**功能完全不存在，测试却全绿**。

- `deriveSections` 现在逐行写 `status: sessionStatusOf(entry, statusOf(entry.id))`（`client.js`，`recentRows.push` 处）。
- `statuses` 按宿主真实契约读取：`ReadonlyMap<SessionId, SessionStatus>`；普通对象形状也容忍，缺失时退化为「无状态事实」而非崩溃。
- `sessionStatusOf` 同步修正两个与宿主的偏差：
  - 只把 `approval` / `plan-review` / `question` 视为 visible pending（对齐 `tree.ts#visiblePendingKind`），其他 kind 不再误染 warning；
  - 去掉 `summary.completed` 分支 —— 宿主 `SessionSummary` 没有该字段，是永不成立的条件。
- 新增回归锁：`deriveSections: recent rows carry the host status mark` 直接断言生产路径输出的 `status` 值，不再只测纯函数。

### 修复 2（P1）：`recentCount` 跨入口状态陈旧且会丢数据

两个入口各自 `useState` + 仅在挂载时读一次，无 `storage` 监听。真机复现：详情页设 8 → 浮层仍显示 6 → 在浮层按 `+` 后，**localStorage 里的 8 被覆盖成 7**（实测序列 `…6,7,8,7`）。

- 改为模块级共享存储（`subscribeRecentCount` / `getRecentCountSnapshot` / `setRecentCount`），两个入口都用 `useSyncExternalStore` 订阅同一值；写入前重新夹取，不再回写内存里的陈旧值。
- 真机复验：详情页 7 → `+` 变 8 → 折叠后打开浮层**立即显示 8**、列表渲染 8 条；在浮层点 `+` 变 9 后，**同一屏右侧详情页同步为 9**；leveldb 持久值 9，序列末端无回退。

### 修复 3（P1）：负数余额进位溢出到分位以上

`String(Number(truncated)+1).padStart(2,'0')` 在 `truncated === '99'` 时产出三位小数。对照从 asar 取出的宿主 `formatBalance`（用 `Big`）实测：插件 `-0.999 → -¥0.100`、`-99.999 → -¥99.100`，宿主应为 `-¥1.00` / `-¥100.00`。

- 负数分支改为「绝对值进位 + 整元进位」：`bumped === 100` 时整数位 +1、分位置 `00`；新增 `incrementDecimalDigits` 做纯字符串进位（不经过 `Number`，大额不丢精度）。
- 回归对照 28 条（含 `-0.995`、`-999.994`、`-1234.566`、指数记法）与宿主 Big 语义**逐条一致**。
- 注意：用 `Math.abs(x).toFixed(2)` 做对照会因二进制浮点把 `-0.995` 算成 `0.99`，那是错基准；宿主是精确十进制 half-up。

### 修复 4（P1）：未登录账号浮层丢失用量/充值链接；账号读取无超时

`client.js` 的 `accountSeat` 在 `!signedIn`、无 `getProfile`、`metadata === null` 三条早退分支直接 `return accountSeatState(...)`，从未调用 `accountLinks`，而宿主 `getState` 无论登录态都返回 `links` → 未登录用户永远看不到那两个入口。另外整段读取没有超时，违反 AGENTS.md 硬约束 8。

- 新增 `withAccountExtras(seat, viewAnswer, balanceAnswer)`，所有返回路径统一经过它，`balances` / `links` 恒存在。
- 整段读取与 `REMOTE_TIMEOUT_MS` 赛跑，超时落到明确的失败态并打 `[dsh-sidebar-rail] account read timed out` 日志。
- 新增回归锁：`withAccountExtras: every account path keeps the usage and top-up links`。

### 真机复验（macOS Desktop 0.2.2-rc.1，折叠态，判据为像素/文案）

| 项 | 结果 |
| --- | --- |
| 状态标识接线 | ✅ 最近会话首行右侧出现 `ongoing` 14px 圆环（轨道 + 弧线）；此前同一位置完全空白 |
| 跨入口同步（详情→浮层） | ✅ 详情页 8 → 浮层立即显示 8 且列表 8 条 |
| 跨入口同步（浮层→详情） | ✅ 浮层 9 → 同屏详情页同步 9；leveldb 末值 9，无回退 |
| 账号浮层 | ✅ 余额 `¥0.00`、赠金 `¥0.00`、「查询用量」「充值」、真实头像 |
| `npm run check` | ✅ 仓库规则 4 条 + 两入口语法 + **33 项测试**全过 |

### 未验证

- 未逐帧核对 `ongoing` 旋转动画的观感（只确认形态为圆环）。
- 未在**真实有余额**的账号上验证主余额行与进位分支（当前账号主钱包为空）。

### 已决定不实现（2026-11-09，不再是待办）

以下两项曾被列为未完成，经确认**放弃**，并已写进 [PRD 非目标](PRD.md#非目标)：

- **子代理运行状态标识**（`runningSubagentCount > 0`）：需要 `projectionsBySession.subagentCatalog`，当前行投影不携带；会话自身的运行/待处理/完成未读已覆盖主要场景。
- **登录态变化的实时刷新**：账号数据保持在挂载时读取一次，不订阅 `account/watch`；完整账号信息以宿主账号页为准。

### 对第 17 轮记录的两处更正

- 第 17 轮「会话状态标识 ✅ 运行中的会话行出现 `ongoing` 圆环」：**当时不可能成立**（该功能零调用、组件永不渲染）。当时看到的大概率是宿主展开侧栏自己的 `StateDot`。本轮修复后才真正出现。
- 第 17 轮「两处写同一个键，不会互相矛盾」：只在持久层成立，UI 层当时会互相陈旧并互相覆盖。本轮已改为共享存储。

## 0.3.1 三项优化（2026-11-05，第 17 轮）

### 1 最近会话条数设置 + 独立滚动

- 新增偏好 `recentCount`（范围 1–20，默认 5），存在插件自己的 `localStorage['dsh.sidebar-rail.v1']`，保持纯 Client、不引入 host 半边。
- **两个入口**：插件详情页（注册到 `plugins.bundle.config`，`key` 为包名，与宿主 cot-translation / voice-input 同槽）+ 工作区浮层底部的步进器。两处写同一个键，不会互相矛盾。
- 最近会话改为**独立滚动容器**（`max-height:38vh`），工作区列表再长也不会把它挤没。
- 修掉一处历史不一致：`RECENT_LIMIT` 曾固定 10，而浮层又 `slice(0,5)` 只渲染 5 条。

### 2 会话状态标识（复用宿主样式）

按宿主 `ui-workspace/Rows.tsx` 的 `sessionStatuses` 同优先级实现 `sessionStatusOf`：

```
pendingInteraction（approval / plan-review / question） → warning
running                                               → ongoing
completionUnread                                      → done
否则                                                   → idle
```

视觉逐项对齐宿主 `StateDot`：`ongoing` 是 14px 旋转环（`--dsw-alias-label-tertiary`），其余是 10px 容器内的 6px 实心点（`--dsw-alias-state-success/warn/idle-primary`）。图标是**重绘**而非引入组件——静态模块只能 require react/react-dom。真机已见 `ongoing` 圆环出现在运行中的会话行上。

### 3 账号浮层：宿主原有项 + 余额

只读展示 + 跳转（不做退出登录/付款）。余额实现按调研报告修正了 **5 个真实缺陷**：

| # | 缺陷 | 后果 | 修法 |
| --- | --- | --- | --- |
| 1 | `balanceRows` 把 `answer.value` 当数组 | **真机恒为空**（真实契约是 `{status, value, bonusWallets}`），而按数组写的 mock 让单测通过 | 按三层契约解析 |
| 2 | 负数也截断 | `-12.345` 显示 `-¥12.34`，宿主是 `-¥12.35` | 负数 half-up 四舍五入，正数仍截断 |
| 3 | 不支持指数记法 | `0E-16` / `1e+3` 整行丢弃 | 先展开指数再定点运算 |
| 4 | 零余额被过滤 | 与宿主「渲染收到的全部钱包」不一致 | 保留 `¥0.00` |
| 5 | 未用 `bonusWallets` / `links` | 赠金、查询用量、充值入口缺失 | 都接上；链接只接受绝对 http(s) |

余额格式化与宿主 `formatBalance.ts` 的**官方 fixture 逐条对齐**（含 `0E-16`、`-12.345`、`1e+3`）。

### 一个必须记录的教训

本轮出现了两次「多处脚本改同一文件互相覆盖」，导致 `deriveSections` 的调用与签名不一致、`recentCount` 声明在 `useMemo` 之后（TDZ 崩溃，界面显示 `Sidebar rail unavailable`）。定位方式是**让 Boundary 把真实错误信息渲染出来**（`Cannot access 'recentCount' before initialization`），一步命中。该诊断能力已保留在 `Boundary` 里。

### 真机验证

| 项 | 结果 |
| --- | --- |
| 崩溃修复 | ✅ 无 `Sidebar rail unavailable`，界面正常 |
| 会话状态标识 | ✅ 运行中的会话行出现 `ongoing` 圆环 |
| 账号浮层赠金行 | ✅ 显示「赠金 ¥0.00」+ 真实头像 |
| 设置页（插件详情） | ⏳ 未真机打开核对（需进入插件管理页→详情） |
| 余额主行 | ⏳ 本轮窗口为展开态，未在折叠浮层上核对最终样子 |

### 未验证

- 插件详情页设置面板的**视觉与交互**未真机核对（仅确认注册未引发崩溃）。
- `recentCount` 改动后需要重新挂载浮层才生效（值在组件挂载时读取），跨入口即时同步未验证。
- 真实有余额的账号下的主余额行未验证（当前账号主钱包为空）。

## 0.3.0 发布（2026-11-05）

| 项 | 结果 |
| --- | --- |
| 合并 | `fix/audit-0.2.0` 经 `--no-ff` 合入 `main`（`50f6f78`），分支历史保留 |
| tag / Release | `v0.3.0` 指向 `50f6f78`，等于 `origin/main`；GitHub Release 已建 |
| CI 运行 | `42006232697` **success**（2m8s），OIDC 发布一次通过 |
| registry | `dist-tags.latest = 0.3.0`；versions `0.0.0-stage, 0.1.0, 0.2.0, 0.3.0` |
| 产物 | shasum `2f2f1d4bfec96ea75bc01681264fe75dee1b1b7d`，10 文件，解包 94,659 字节，**provenance + 2 个签名** |
| 内容一致性 | ✅ 解包 10 个文件与 `main` **逐字节相同** |
| 版本语义 | minor：轨默认隐藏是可见行为变更，PRD / AGENTS / 两份 README 已同步 |

### 顺带修的工程问题

`git merge --no-ff -m "merge: ..."` 被仓库自己的 `commit-msg` hook 拒绝——hook 原先只放行大写的 `Merge `，而 `-m` 传入的是小写 `merge:`。已改为同时放行 `Merge `、`merge:`、`Revert `、`revert:`，并用三种输入验证（merge/revert 放行、普通不合规信息仍拒绝）。

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