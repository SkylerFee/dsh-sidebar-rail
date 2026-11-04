# dsh-sidebar-rail

给 DeepSeek Harness **macOS Desktop 折叠侧栏**补一条图标轨的**增量插件**。

宿主在 macOS 桌面端把侧栏折到 0 宽时不留任何轨道（`AppFrame: collapsedWidth = darwin ? 0 : 56`，列上还有 `overflow: hidden`）。本插件只在这一种状态下，在窗口左侧渲染一条 56px 图标轨：工作区 / 定时任务 / 插件 / 更多 四个图标 + 底部账号座位；悬停 120ms 打开浮层，离开 200ms 关闭，`Escape` 关闭。

- **增量**：不替换宿主 `sidebar` 槽、不改宿主栅格列宽、不覆盖宿主样式
- **其他所有状态都不渲染**：展开态与 Web 端完全交给宿主
- 工作区置顶保存在浏览器 `localStorage`；折叠状态归宿主，插件只读不写

## 支持范围

| 环境 / 状态 | 行为 |
| --- | --- |
| macOS Desktop，侧栏折叠 | 渲染 56px 浮轨（本插件唯一的渲染分支） |
| macOS Desktop，侧栏展开 | 不渲染。搜索、视图选项、添加工作区、设置座位、账号菜单全部保留为宿主原生侧栏行为 |
| Web（任意平台） | 不渲染。宿主本来就有自己的 56px 折叠轨，插件不重复绘制 |
| Windows / Linux | 未验证，不渲染 |

判据：`document.documentElement.dataset.platform === 'darwin'` 且宿主 frame 带 `data-sidebar-collapsed` 属性；两者任一不成立即 `return null`。

## 安装

安装方式未变（bundle patch + 客户端注入；`package.json` 的 `dsh.client` 不动）。在本机 DSH profile 中安装（需 Full access 审批）：

```
plugin_manager  action: install_bundle
                target: /Users/liufei/Projects/deepseek-harness-plugins/dsh-sidebar-rail
```

安装后**刷新页面**加载 Client 模块。卸载用 `plugin_manager action: remove_bundle`，或 `set_bundle enabled: false`。

## 功能对照

| 需求 | 实现 |
| --- | --- |
| 折叠态常驻图标：工作区 / 定时任务 / 插件 / 更多 | 4 个 36×36 按钮，图标 20px，均有 `aria-label` |
| 底部账号座位 | 轨道底部 `dsr-avatar-dot`，点击交回宿主展开侧栏 |
| 悬停显示对应列表 | 停留 120ms 打开浮层；移出图标与浮层共同区域 200ms 后关闭（跨间隙不闪断）；`Escape` 关闭 |
| 工作区 → 工作区列表 | 浮层分「置顶项目 / 项目」两段，底部附最近会话 |
| 定时任务 → 已创建任务列表 | `remote.schedule.catalog()`，只列未结束/未暂停的任务；失败或空态给「打开面板」 |
| 插件 → 当前启用插件列表 | `remote.pluginInventory.list()`，跳过显式 `enabled: false` 的条目；失败或空态给「打开面板」 |
| 更多 → 其他面板 | 「展开侧栏」+ 宿主 `sidebar.panellist` 的其余条目（只读订阅） |
| 账号 → 账号说明 | 浮层给账号说明与「展开侧栏」；账号信息与设置入口由宿主展开态侧栏提供 |
| 工作区置顶 | 行内图钉按钮，置顶项排前，写入 `localStorage['dsh.sidebar-rail.v1'].pinnedWorkspaceIds` |
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
└─ docs/
   ├─ PRD.md            # 需求、交互规格、验收清单
   ├─ design.md         # 架构、约束、数据来源、已知偏差
   └─ verify.md         # 验证记录（含未验证项与单测结果）
```

## 已知限制

1. **浮轨浮在主内容之上**：宿主折叠列宽为 0 且 `overflow: hidden`，轨道只能以 `createPortal(document.body)` + `position: fixed` 浮在主内容上，无法嵌回宿主栅格。窗口窄于 900px 时整条浮轨 `display: none`，避免压住正文。
2. **顶部 48px 不渲染图标**：macOS 红绿灯（约 x 16–68）与宿主挂在 `shell.leading` 的重开 / 新会话控件（`left: 88px`）占着 `--dsh-frame-top-clearance` 那条窗口 chrome 带，浮轨从 48px 起排。
3. **Windows / Linux 未验证**：不渲染，也不宣称支持。
4. **置顶是插件本地概念**：宿主没有对应字段，换浏览器或清空 `localStorage` 会丢。
5. **定时任务 / 插件列表依赖可选 remote 服务**：服务缺失、未授权或返回空时，浮层显示空态 + 「打开面板」。
6. **不复制账号数据**：账号信息与用量由宿主设置页提供，插件只给说明与回到宿主侧栏的动作。

## 测试

```bash
npm test        # node --test test/data.test.mjs —— 11 个纯逻辑用例
```

覆盖分组 / 置顶 / 最近 10 条 / 数据归一 / 时间文案等纯函数行为，不涉及渲染与槽注册。

## 文档

- 需求与验收：[docs/PRD.md](docs/PRD.md)
- 设计与约束：[docs/design.md](docs/design.md)
- 验证记录：[docs/verify.md](docs/verify.md)
