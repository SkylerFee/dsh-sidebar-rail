# dsh-sidebar-rail 项目规则

本项目提供 DeepSeek Harness **macOS Desktop 折叠侧栏**的增量图标轨。修改前阅读 [README](README.md) 和[设计说明](docs/design.md)；交互要求见 [PRD](docs/PRD.md)。需求与当前实现存在差异时，先核对源码及设计中记录的限制，不把需求清单当作已实现能力。

## 项目入口与范围

- `client.js` 是手写的客户端静态模块，通过 `window.__ModuleLoader__.load()` 注册，模块 ID 为 `dsh-sidebar-rail`；它不是生成文件。
- `index.js` 是空 `apply()` 的 Host 入口；`cordis.patch.yml` 插入插件行。保持纯 Client 定位，新增服务端功能、RPC 或宿主修改前先明确任务范围。
- `package.json` 声明 ESM、bundle patch、客户端注入与包导出；当前只有 `test` 脚本，没有构建步骤。入口、模块 ID 和清单变更必须保持一致。
- 只修改本项目需要的文件。安装或启用插件、修改用户 profile，仅在任务授权包含这些操作时执行。

## 挂载与折叠检测

- 只通过 `shell.overlay`（ui-layout 声明的 `kind: 'list'`、frame 级浮动层）增量注册，条目 `id: 'dsh-sidebar-rail.rail'`、`order: 10`，用 `ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({ … }, Comp)))` 注册。不注册 `sidebar` 单槽、不声明 `children`。
- **不得重新引入替换 `sidebar` 的实现**：`sidebar` 是单槽，替换后它声明的 `sidebar.settings` 一并消失，宿主 `SettingsRoot` 不再挂载，设置（账号、主题、插件管理）整体不可达；搜索、视图选项、添加工作区、账号菜单也会一起丢。这不是风格取舍，是硬性否决理由。
- overlay 条目拿不到 `collapsed / width / drawer` owner props。折叠状态从宿主发布在 frame 元素上的 `data-sidebar-collapsed` 读取，frame 通过 `[data-shell-overlay]` 的父元素定位（不要依赖 hash 化的 CSS Module 类名）。
- 折叠订阅必须用属性范围限定的 `MutationObserver`（`attributeFilter: ['data-sidebar-collapsed']`），卸载时 `observer.disconnect()`；不得用常驻轮询，也不得让无关 re-render 唤醒组件。
- 平台判定用 `<html>` 的 `data-platform === 'darwin'`。**只在 darwin + 折叠时渲染**，其余状态 `return null`；Web 端宿主已有自己的 56px 折叠轨，不得重复绘制。
- 会话、工作区和当前面板通过宿主提供的标准 hooks 读取；面板列表只读订阅 `ctx.slots.entriesOfSlot('sidebar.panellist')`，不注册、不声明该槽。导航动作通过注入的 `layout`、`uiWorkspace` 等接口执行，不直接操作宿主内部状态。
- 静态模块只从平台种子模块加载 `react` 与 `react-dom`；其他宿主能力通过注入或标准 props 获取。引入新模块前核实宿主加载能力并更新清单，不直接 `require` 宿主客户端内部包。
- 保留组件错误边界和注册失败诊断；`apply` 的注册必须 `try/catch`，失败只记录一次 `[dsh-sidebar-rail]` 错误，宿主导航不受影响。

## 定位与样式边界

- 轨本体用 `createPortal(document.body)` + `position: fixed`：`left: 0; top: var(--dsh-frame-top-clearance, 48px); bottom: 0; width: 56px; z-index: 60`，并显式 `-webkit-app-region: no-drag`。
- 顶部 48px 是窗口 chrome 带（macOS 红绿灯约 x 16–68、宿主 `shell.leading` 重开控件 `left: 88px`）。调整起点、宽度或 z-index 时，必须重新验证这两处不被遮挡、点击不拖窗口。
- 窄窗口 `max-width: 900px` 时浮轨 `display: none`，避免浮层压住正文；宿主在 `shell.leading` 保留重开入口，隐藏浮轨不得移除该兜底。
- **不得改宿主栅格列宽，不得用 `!important` 覆盖宿主布局或样式**：列宽由宿主按 `collapsedWidth` 与折叠动画计算，插件只做浮层。
- 样式使用宿主主题 token：文字 `--dsw-alias-label-primary/secondary/tertiary`，悬停 `--dsw-alias-interactive-bg-hover/active`，浮层底 `--dsw-alias-bg-overlay`，边框 `--dsw-alias-border-l1/l3`，当前态 `--dsw-specific-sidebar-nav-item-active`，浮轨底色 `--dsw-specific-sidebar-fill`。圆角用 `--dsw-radius-sm/lg`、阴影用 `--dsw-shadow-lv3`（宿主 HoverCard 同款组合）；这些变量由 ui-theme 全局注入，但不在 Theme token 注册表里，所以 `cordis_inspect_query` 的 `Theme.listTokens` 查不到，不要据此判定「token 不存在」。
- 保留 `.dsr-*` 作用域与 `<style data-dsh-sidebar-rail>` 标记，避免影响其他插件。

## 数据与持久化

- 会话归属由工作区的 `sessionIds` 关联，归档状态来自 `archivedSessionIds`；不要假定会话摘要有 `workspaceId`、归档或置顶字段。
- 工作区置顶属于插件本地状态。置顶区按本地置顶顺序排列，普通项目保持宿主顺序；最近会话按 `updatedAt` 倒序、上限 10 条（浮层底部渲染前 5 条），并排除归档、空白和子代理会话。变更这些规则时同步测试及设计说明。
- 状态只写入 `localStorage['dsh.sidebar-rail.v1']`，当前只含 `pinnedWorkspaceIds`，写入使用合并语义。**折叠状态归宿主**：不得再持久化 `collapsed`、不得在挂载时调用 `toggleSidebar()` 校正、不得写回 `nativeExpanded`（该模式已移除）。
- 存储不可用或内容损坏时保持界面可用，不把本地偏好写入宿主存储。
- 定时任务和插件列表来自可选 remote 服务。保留加载、失败、空态及打开面板入口；不得假定服务始终存在，也不得把失败报告成有数据的成功结果。

## UI、语言与资源清理

- 产品文案通过 `client.js` 内 `zh`、`en` 字典和 `sidebarRail` 命名空间提供，两侧键保持一致。`locale/zh.json`、`locale/en.json` 用于插件元数据，不替代界面字典。
- 保留图标按钮的可访问名称、当前面板标记（`aria-current="page"`）、浮层语义（`role="dialog"` + `aria-label`）、`Escape` 关闭和减少动态效果设置。悬浮 120ms 打开、移出 200ms 关闭（跨间隙不闪断）行为变更时，验证图标与浮层之间移动、快速划过和键盘操作。
- 定时器、keydown 监听、订阅、MutationObserver、字典和样式均需随组件或插件释放；异步请求在清理后不得更新已失效的界面。新增日志使用 `[dsh-sidebar-rail]` 前缀，避免记录用户会话正文。
- 账号浮层不得复制账号数据：只给说明与「展开侧栏」，设置入口由宿主原生侧栏提供（原 `openSettings` 命令探测已删除，不要恢复）。

## 修改与验证

1. 在本仓库检查 `git status --short` 和相关差异；保留用户已有改动，编辑后读回完整段落。
2. 纯逻辑修改同步更新 [test/data.test.mjs](test/data.test.mjs)。测试从 `client.js` 的 `pure-helpers`、`pure-data` 标记区提取代码；保留成对标记，测试所调用的纯函数不依赖 React 或 DOM。
3. 代码变更后运行下列检查；仅修改文档时检查链接、格式与陈述依据即可。

```sh
node --check client.js
node --check index.js
npm test
git diff --check
```

4. UI、加载或注册方式变更，另行在目标宿主验证：macOS Desktop 折叠态渲染、悬浮浮层、置顶、点击后展开宿主侧栏、Escape、语言与主题切换、空态 / 服务缺失、窄窗口隐藏、卸载恢复；Web 端确认不出现第二条轨。Windows 未验证，不得宣称支持。
5. 同步更新受影响的 README、设计或 PRD；需要记录本次验收时更新 [docs/verify.md](docs/verify.md)，明确环境、操作、结果和未验证项。

`npm test` 只验证提取出的纯逻辑，不证明模块加载、槽注册、React 渲染或视觉交互。[既有验证记录](docs/verify.md)中的安装结果、端口和工具限制属于当次环境，不能当作当前验证结论；本次未执行的页面或桌面检查应明确说明。
