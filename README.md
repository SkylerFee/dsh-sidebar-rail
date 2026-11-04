# dsh-sidebar-rail

Codex 风格的 DSH 左侧导航栏：折叠后是一条**常驻图标轨**（工作区 / 定时任务 / 插件 / 更多 + 底部用户头像），悬浮图标即在轨旁展开对应列表；展开后回到 DSH 熟悉的纵向结构，并按 `置顶项目 / 项目 / 最近会话(10)` 分组。

- 纯 Client 插件，不改宿主、不新增 RPC、不写宿主存储
- 折叠状态与工作区置顶保存在浏览器 `localStorage`
- 浮层 portal 到 `body`，不受侧栏列 `overflow:hidden` 影响

## 安装

在本机 DSH profile 中安装（需 Full access 审批）：

```
plugin_manager  action: install_bundle
                target: /Users/liufei/Projects/deepseek-harness-plugins/dsh-sidebar-rail
```

安装后**刷新 Web 页面**加载 Client 模块。卸载用 `plugin_manager action: remove_bundle`，或 `set_bundle enabled: false`。

## 功能对照

| 需求 | 实现 |
| --- | --- |
| 折叠态常驻图标：工作区 / 定时任务 / 插件 / 更多 | `Rail` 四个按钮，图标 20px、按钮 36×36 |
| 底部变用户头像图标 | 轨道底部 `dsr-avatar-dot`，点击展开侧栏 |
| 悬浮显示对应列表 | 停留 120ms 展开浮层；移出 200ms 后收起（跨越间隙不闪断） |
| 工作区 → 工作区列表 | 浮层分「置顶项目 / 项目」两段，底部附「最近会话」 |
| 定时任务 → 已创建任务列表 | `remote.schedule.catalog()`，失败降级为"打开面板" |
| 插件 → 当前启用插件列表 | `remote.pluginInventory.list()`，只列 `enabled` 条目 |
| 用户头像 → 账号信息与设置 | 浮层给设置入口与账号说明（Web 端账号数据由宿主设置页提供） |
| 工作区置顶 | 行内图钉按钮，置顶项进「置顶项目」段，`localStorage` 持久化 |
| 展开态恢复 DSH 结构与分组 | 品牌 → 新会话 → 面板行 → 分组列表 → 设置 |
| 折叠状态跨启动保持 | `localStorage['dsh.sidebar-rail.v1'].collapsed`，挂载时校正一次 |

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
   └─ verify.md         # 验证记录（含未验证项）
```

## 已知限制

1. **展开态列表由本插件自绘**。`sidebar` 槽的子槽已被 `ui-sidebar` 声明，重复声明会抛错，因此无法 `renderSlot('sidebar.workspaces')` 复用宿主浏览器——搜索、Show more、拖拽排序、行内菜单不在本版范围内。详见 `docs/design.md` §10。
2. **macOS/Windows 桌面端折叠时列宽为 0**（宿主行为），图标轨不可见；这是 Web 端插件，桌面端需宿主层配合。
3. **账号信息**在 Web 端本身不存在（宿主 `ui-settings-account` 明确 Web 无账号登录），浮层只给设置入口与说明。
4. 定时任务 / 插件列表依赖对应 remote 服务；服务缺失或未授权时浮层降级为空态 + 打开面板。

## 文档

- 需求与验收：`docs/PRD.md`
- 设计与约束：`docs/design.md`
- 验证记录：`docs/verify.md`
