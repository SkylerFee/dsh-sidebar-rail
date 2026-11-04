# dsh-sidebar-rail

[![npm](https://img.shields.io/npm/v/%40skylerfee%2Fdsh-sidebar-rail.svg)](https://www.npmjs.com/package/@skylerfee/dsh-sidebar-rail) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

给 DeepSeek Harness **macOS Desktop 折叠侧栏**补一条图标轨的**增量插件**。

宿主在 macOS 桌面端把侧栏折到 0 宽时不留任何轨道（`AppFrame: collapsedWidth = darwin ? 0 : 56`，列上还有 `overflow: hidden`）。本插件只在这一种状态下，在窗口左侧渲染一条 56px 图标轨：工作区 / 定时任务 / 插件 / 更多 四个图标 + 底部账号座位；悬停 120ms 打开浮层，离开 200ms 关闭，`Escape` 关闭。

- **增量**：不替换宿主 `sidebar` 槽、不改宿主栅格列宽、不覆盖宿主样式
- **其他所有状态都不渲染**：展开态与 Web 端完全交给宿主
- 工作区置顶保存在浏览器 `localStorage`；折叠状态归宿主，插件只读不写

英文说明见 [README.md](README.md)。

## 支持范围

| 环境 / 状态 | 行为 |
| --- | --- |
| macOS Desktop，侧栏折叠，视口 ≥ 768px | 渲染 56px 浮轨（本插件唯一的渲染分支） |
| macOS Desktop，侧栏折叠，视口 < 768px | 不渲染。宿主在 `shell.leading` 保留自己的重开控件，不会失去回头路 |
| macOS Desktop，侧栏展开 | 不渲染。搜索、视图选项、添加工作区、设置座位、账号菜单全部保留为宿主原生行为 |
| Web（任意平台） | 不渲染。宿主 Web 本来就有自己的 56px 折叠轨，插件不重复绘制 |
| Windows / Linux | 未验证，不渲染 |

判定是一个纯函数（`test/data.test.mjs` 有边界用例）：

```
platform === 'darwin'  &&  宿主侧栏已折叠  &&  视口宽度 >= 768
```

768 = 680（宿主正文最小宽）+ 56（轨宽）+ 32（两侧安全）。

## 安装

安装方式是 bundle patch + 客户端注入（`package.json` 的 `dsh.bundle` 与 `dsh.client`）：

```
plugin_manager  action: install_bundle
                target: @skylerfee/dsh-sidebar-rail      # 已发布的包名
                # 或：target: <本仓库的绝对路径>
```

安装后**刷新页面**加载 Client 模块。卸载用 `plugin_manager action: remove_bundle`，或 `set_bundle enabled: false`。

## 功能对照

| 入口 | 行为 |
| --- | --- |
| 工作区 | 36×36 按钮、20px 图标、均有 `aria-label`；浮层分「置顶项目 / 项目」两段，底部附最近会话 |
| 定时任务 | `remote.schedule.catalog()`，只列未结束/未暂停的任务；失败或空态给「打开面板」 |
| 插件 | `remote.pluginInventory.list()`，跳过显式 `enabled: false` 的条目；失败或空态给「打开面板」 |
| 更多 | 「展开侧栏」+ 宿主 `sidebar.panellist` 的其余条目（只读订阅） |
| 账号 | 浮层给账号说明与「展开侧栏」；账号信息与设置入口由宿主展开态侧栏提供 |
| 置顶 | 行内图钉按钮，置顶项排前，写入 `localStorage['dsh.sidebar-rail.v1'].pinnedWorkspaceIds` |
| 最近会话 | `updatedAt` 倒序，排除归档/空白/子代理，上限 10 条；浮层底部渲染前 5 条 |

## 目录

```
dsh-sidebar-rail/
├─ client.js            # 全部 UI 逻辑（__ModuleLoader__ 静态模块）
├─ index.js             # Host 半边（空 apply，仅供安装与展示）
├─ cordis.patch.yml     # bundle patch，插入一行
├─ package.json         # dsh.bundle + dsh.client 声明
├─ locale/{en,zh}.json  # 插件管理页展示用元数据
├─ icon.svg             # 插件图标（原创）
├─ test/data.test.mjs   # 纯逻辑测试（从 client.js 切片）
├─ test/client-registration.test.mjs # 静态脚本按完整包名注册的回归测试
└─ docs/
   ├─ PRD.md            # 需求、交互规格、验收清单
   ├─ design.md         # 架构、约束、数据来源、已知偏差
   ├─ verify.md         # 验证记录（含未验证项与单测结果）
   └─ desktop-validation-2026-11-04.md
```

## 已知限制

1. **浮轨浮在主内容之上**：宿主折叠列宽为 0 且 `overflow: hidden`，轨道只能以 `createPortal(document.body)` + `position: fixed` 浮在主内容上，无法嵌回宿主栅格。视口窄于 768px 时完全不渲染，因此不会压住正文。
2. **顶部 48px 不渲染图标**：macOS 红绿灯（约 x 16–68）与宿主挂在 `shell.leading` 的重开 / 新会话控件（`left: 88px`）占着 `--dsh-frame-top-clearance` 那条窗口 chrome 带，浮轨从 48px 起排。
3. **Windows / Linux 未验证**：不渲染，也不宣称支持。
4. **置顶是插件本地概念**：宿主没有对应字段，换浏览器或清空 `localStorage` 会丢。
5. **定时任务 / 插件列表依赖可选 remote 服务**：服务缺失、未授权或 5s 内不返回，浮层显示失败行 + 「打开面板」。
6. **不复制账号数据**：账号信息与用量由宿主设置页提供，插件只给说明与回到宿主侧栏的动作。
7. **不提供展开态自绘列**：替换宿主侧栏会让宿主的设置壳（`SettingsRoot`）不再挂载，导致设置整体不可达（连快捷键也打不开）。

## 开发与测试

```bash
npm test               # node --test test/*.test.mjs —— 13 个用例
npm run check          # scripts/check.mjs（仓库规则）+ 两个入口 node --check + 单测
npm run hooks:install  # 启用 .githooks：pre-commit 跑 check，commit-msg 校验 conventional commits
```

逻辑测试从 `client.js` 的 `#region` 标记区切片，覆盖分组、置顶顺序、最近 10 条、数据归一、时间文案、语言解析与浮轨渲染判定。独立注册测试使用宿主加载接口执行完整静态脚本，要求工厂 ID 与包含作用域的完整包名一致。渲染与槽注册仍需 Desktop 实测。

能被脚本判定的规则都在 `scripts/check.mjs`（标记区、清单一致性、禁用模式、i18n 对齐）；判断类规则在 [CODING_STANDARDS.md](CODING_STANDARDS.md)，由 review 时阅读。

## 文档

- 需求与验收：[docs/PRD.md](docs/PRD.md)
- 设计与约束：[docs/design.md](docs/design.md)
- 验证记录：[docs/verify.md](docs/verify.md)
- English: [README.md](README.md)

## License

MIT © 2026 SkylerFee — 见 [LICENSE](LICENSE)。
