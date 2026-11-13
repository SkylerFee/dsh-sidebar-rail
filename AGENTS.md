# dsh-sidebar-rail 项目规则

DeepSeek Harness 的 **折叠态增量图标轨**（适用于宿主把折叠列压到零宽的平台，目前是 macOS 与 Windows Desktop）。开工前读 [README](README.md) 与[设计说明](docs/design.md)；需求见 [PRD](docs/PRD.md)，判断类编码规范见 [CODING_STANDARDS.md](CODING_STANDARDS.md)。

实现细节（注册写法、observer、z-index、token 清单、数据来源、分组规则）一律以 [docs/design.md](docs/design.md) 为准，本文件不再重复，只保留**否决性约束**与**导航**。

## 范围

- 纯 Client 插件：源码在 `src/`（TypeScript / TSX，按职责分模块），由 `esbuild` 生成 `lib/client.js`（`window.__ModuleLoader__.load()` 的单份静态模块）与 `lib/index.js`（空 `apply()` 的 Host 入口）；`cordis.patch.yml` 插一行。`lib/` 是生成目录，不提交 Git，改完 `src/` 必须 `npm run build`。运行时依赖仍为零——客户端只向宿主 `require` `react` / `react-dom`；开发依赖与构建步骤按 [ADR-0006](docs/adr/0006-typescript-source-and-build.md) 允许。
- 图标轨只在 **Desktop 应用 + 宿主侧栏折叠 + 视口 ≥ 768px** 时渲染；其他状态轨组件一律 `return null`。**是否接管由宿主折叠列的实际宽度决定，不按平台名**（`hostCollapsedColumnIsEmpty` + `useHostSidebarWidth`）：宿主把折叠列算成 `drawer || darwin || windowsTitlebar ? 0 : SIDEBAR_COLLAPSED`，归零的平台（macOS / Windows Desktop）折叠后没有任何轨可点，本插件补一条；仍保留 56px 的平台（Linux Desktop、Web）宿主自己画着轨，本插件必须保持为空，否则会叠成双轨。读不到列宽时同样不接管——重复绘制比缺一条更糟。禁止改回按平台名判断：宿主一调整就会悄悄变成双轨。Windows 已在 Windows 11 真机验证通过（轨的滑出与点击、顶部标题栏避让、鼠标热区、浮层位置均正常）。插件没有插件详情页设置块（唯一的设置项已随分页整项移除）。
- 安装/启用插件、改用户 profile、发布 npm，都只在任务明确授权时执行。

## 硬约束（违反即否决）

1. **不得重新引入替换 `sidebar` 单槽的实现**。单槽替换会让 `sidebar.settings` 一起消失，宿主 `SettingsRoot` 不再挂载，设置（账号、主题、插件管理）整体不可达；搜索、视图选项、添加工作区、账号菜单也会丢。这是硬性否决理由，不是风格取舍。
2. **图标轨只通过 `shell.overlay` 增量注册**（`id: 'dsh-sidebar-rail.rail'`），不声明 `children`。不注册 `plugins.bundle.config`——插件已无自己的设置项（可调的 `recentCount` 在 0.4.0 被分页取代，设置块与其注册一并删除）。
3. **不得改宿主栅格列宽，不得用 `!important` 覆盖宿主样式**；浮轨只能 `createPortal(document.body)` + `position: fixed`。
4. **轨默认隐藏（`translateX(-100%)`），由 12px 左边条热区或键盘焦点唤出，不得改回常驻显示**。宿主折叠时主区占满窗口，而标签行没有左侧避让（只有标题行应用了 `--dsh-frame-leading-clearance`），常驻会把会话页首个「对话」标签连同点击区域一起盖住。
5. **窄窗判定不得改回 CSS 媒体查询**。阈值与推导见 [ADR-0001](docs/adr/0001-narrow-viewport-predicate.md)；判定必须是可单测的纯函数。
6. **折叠状态归宿主**：只读 `data-sidebar-collapsed`，不持久化、不在挂载时纠正。插件偏好只写 `localStorage['dsh.sidebar-rail.v1']` 的 `pinnedWorkspaceIds` 与 `expandedProjectIds`；分区折叠态与列表水位（分页）都不落盘。
7. **运行时依赖必须保持为零**：客户端运行期只向宿主 `require` `react` 与 `react-dom`，不得新增 `dependencies` 或任何运行时实现库。**构建步骤与开发依赖按 [ADR-0006](docs/adr/0006-typescript-source-and-build.md) 允许**：`devDependencies` 仅限 TypeScript / esbuild / tsx / React 与 `@types/*`，构建由 `scripts/build.mjs` 负责；新增工具链或运行时依赖必须先改 ADR-0006，不得「顺手接入」。机械规则加进 `scripts/check-source.mjs`（源码约束）或 `scripts/check-artifact.mjs`（产物约束），判断类写进 `CODING_STANDARDS.md`。
8. **可选的 Host 调用必须有超时与失败态**，不得把「服务不存在/不返回」呈现成永久加载。
9. **账号浮层只通过宿主服务读取头像、余额与跳转链接，不向插件本地存储写入账号数据**。登录、退出、付款及完整账号设置留给宿主或目标网页。

## 命令

脚本以 [package.json](package.json) 的 `scripts` 为唯一事实来源；当前入口：

```sh
npm ci                 # 安装开发依赖（package-lock.json 锁定）
npm run typecheck      # tsc --noEmit -p tsconfig.json，严格类型检查
npm run build          # node scripts/build.mjs，生成 lib/index.js 与 lib/client.js
npm run dev            # 同一构建脚本的 --watch 模式，改 src/ 自动重建
npm run test:unit      # tsx --test test/*.test.ts，直接导入 src/ 源码
npm run test:artifact  # node --test test/*.test.mjs，消费已构建的 lib/（需先 build）
npm test               # typecheck 之外的常规链路：单元测试 → build → 产物测试
npm run check:source   # scripts/check-source.mjs，源码约束与字典检查
npm run check:artifact # scripts/check-artifact.mjs，入口、白名单、外部模块与注册元数据检查
npm run check          # typecheck → check:source → test:unit → build → check:artifact → test:artifact
npm run hooks:install  # 启用 .githooks（pre-commit 跑 check，commit-msg 校验 conventional commits）
```

本地 checkout 改完 `src/` 必须 build 或保持 watch；`lib/` 是生成目录，不提交 Git。发布走 `npm publish --ignore-scripts`，因此发布前必须已完成完整 `npm run check`。

提交信息用 conventional commits。UI/加载/注册变更必须按 [CODING_STANDARDS.md](CODING_STANDARDS.md) 第 1 条在 PR 里留一轮真机记录（环境/操作/结果/未验证项）。

## 导航

| 想知道 | 看 |
| --- | --- |
| 支持范围、安装、已知限制 | [README.md](README.md) / [README.zh.md](README.zh.md) |
| 架构、约束、数据来源、trade-off | [docs/design.md](docs/design.md) |
| 需求与验收清单 | [docs/PRD.md](docs/PRD.md) |
| 判断类编码规范（review 用） | [CODING_STANDARDS.md](CODING_STANDARDS.md) |
| 源码结构与构建协议 | [ADR-0006](docs/adr/0006-typescript-source-and-build.md) |
| 不可逆决定 | [docs/adr/](docs/adr/) |
| 统一用词 | [GLOSSARY.md](GLOSSARY.md) |
| 机械检查规则 | [scripts/](scripts/)（`check-source.mjs` 管源码约束，`check-artifact.mjs` 管产物约束） |

## Agent 技能导航

### 问题跟踪

问题与规格使用本仓库的 GitHub Issues，在仓库内通过 `gh` 操作。详见[问题跟踪规则](docs/agents/issue-tracker.md)。

### 分流标签

五类分流角色对应同名标签，具体含义见[标签说明](docs/agents/triage-labels.md)。

### 领域文档

本仓库使用根目录 `GLOSSARY.md` 与 `docs/adr/` 统一术语和架构决定，阅读规则见[领域文档导航](docs/agents/domain.md)。
