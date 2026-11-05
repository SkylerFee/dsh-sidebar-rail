# dsh-sidebar-rail 项目规则

DeepSeek Harness 的 **macOS Desktop 折叠态增量图标轨**。开工前读 [README](README.md) 与[设计说明](docs/design.md)；需求见 [PRD](docs/PRD.md)，判断类编码规范见 [CODING_STANDARDS.md](CODING_STANDARDS.md)。

实现细节（注册写法、observer、z-index、token 清单、数据来源、分组规则）一律以 [docs/design.md](docs/design.md) 为准，本文件不再重复，只保留**否决性约束**与**导航**。

## 范围

- 纯 Client 插件：`client.js` 是手写静态模块（`window.__ModuleLoader__.load()`），`index.js` 是空 `apply()` 的 Host 入口，`cordis.patch.yml` 插一行。没有构建步骤，没有依赖。
- 只在 **macOS Desktop + 宿主侧栏折叠 + 视口 ≥ 768px** 时渲染；其他状态一律 `return null`。Web 端宿主自带折叠轨，不得重复绘制；Windows/Linux 未验证，不得宣称支持。
- 安装/启用插件、改用户 profile、发布 npm，都只在任务明确授权时执行。

## 硬约束（违反即否决）

1. **不得重新引入替换 `sidebar` 单槽的实现**。单槽替换会让 `sidebar.settings` 一起消失，宿主 `SettingsRoot` 不再挂载，设置（账号、主题、插件管理）整体不可达；搜索、视图选项、添加工作区、账号菜单也会丢。这是硬性否决理由，不是风格取舍。
2. **只通过 `shell.overlay` 增量注册**（`id: 'dsh-sidebar-rail.rail'`），不声明 `children`。
3. **不得改宿主栅格列宽，不得用 `!important` 覆盖宿主样式**；浮轨只能 `createPortal(document.body)` + `position: fixed`。
4. **轨默认隐藏（`translateX(-100%)`），由 8px 左边条热区或键盘焦点唤出，不得改回常驻显示**。宿主折叠时主区占满窗口，而标签行没有左侧避让（只有标题行应用了 `--dsh-frame-leading-clearance`），常驻会把会话页首个「对话」标签连同点击区域一起盖住。
5. **窄窗判定不得改回 CSS 媒体查询**。阈值与推导见 [ADR-0001](docs/adr/0001-narrow-viewport-predicate.md)；判定必须是可单测的纯函数。
6. **折叠状态归宿主**：只读 `data-sidebar-collapsed`，不持久化、不在挂载时纠正。插件只写 `localStorage['dsh.sidebar-rail.v1'].pinnedWorkspaceIds`。
7. **不得新增运行时依赖、devDependency 或构建步骤**（见 [ADR-0002](docs/adr/0002-zero-dependency-no-build.md)）。机械规则加进 `scripts/check.mjs`，判断类写进 `CODING_STANDARDS.md`。
8. **可选的 Host 调用必须有超时与失败态**，不得把「服务不存在/不返回」呈现成永久加载。
9. **账号浮层不得复制账号数据**，设置入口由宿主原生侧栏提供。

## 命令

```sh
npm run check          # scripts/check.mjs（仓库规则）+ 两个入口 node --check + 单测
npm test               # 仅纯逻辑单测
npm run hooks:install  # 启用 .githooks（pre-commit 跑 check，commit-msg 校验 conventional commits）
```

提交信息用 conventional commits。UI/加载/注册变更必须按 [CODING_STANDARDS.md](CODING_STANDARDS.md) 第 1 条在 [docs/verify.md](docs/verify.md) 留一轮真机记录（环境/操作/结果/未验证项）。

## 导航

| 想知道 | 看 |
| --- | --- |
| 支持范围、安装、已知限制 | [README.md](README.md) / [README.zh.md](README.zh.md) |
| 架构、约束、数据来源、trade-off | [docs/design.md](docs/design.md) |
| 需求与验收清单 | [docs/PRD.md](docs/PRD.md) |
| 已验收/未验收的真实环境证据 | [docs/verify.md](docs/verify.md) |
| 判断类编码规范（review 用） | [CODING_STANDARDS.md](CODING_STANDARDS.md) |
| 不可逆决定 | [docs/adr/](docs/adr/) |
| 统一用词 | [GLOSSARY.md](GLOSSARY.md) |
| 机械检查规则 | [scripts/check.mjs](scripts/check.mjs) |

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in this repo; use the `gh` CLI from inside the clone. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Five canonical triage roles, each label string equal to its role name. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Single-context: `GLOSSARY.md` at the repo root plus `docs/adr/`. See [docs/agents/domain.md](docs/agents/domain.md).
