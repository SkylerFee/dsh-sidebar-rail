# 验证记录

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

## 未验证（原因）

| 项 | 原因 |
| --- | --- |
| 折叠轨的视觉呈现、浮层位置与动效 | 本会话无浏览器控制能力，无法截图或点击 |
| 悬浮展开/关闭的时序手感 | 同上 |
| 置顶与折叠状态在真实刷新后的保持 | 同上（逻辑已实现，未经实机复现） |
| 亮/暗主题下的浮层配色 | 同上（全部使用 `--dsw-alias-*` token，未硬编码颜色） |
| 宿主侧栏是否被正确替换 | Slot 树不暴露单槽占用者列表，无法从 Inspect 侧确认；需页面刷新后目视 |

## 复验步骤（人工）

1. 刷新 `http://127.0.0.1:65028` 页面。
2. 收起左侧栏 → 应看到 4 个功能图标 + 底部头像。
3. 悬浮「工作区」→ 120ms 后左侧出现浮层，分「置顶项目 / 项目 / 最近会话」。
4. 点项目行的图钉 → 该项目移入「置顶项目」；刷新页面后仍在。
5. 展开侧栏 → 品牌行 / 新会话 / 面板行 / 分组列表 / 底部设置。
6. 收起侧栏后刷新 → 应保持收起状态。
7. 打开控制台确认无 `[dsh-sidebar-rail] render failed` 与 slot crash。

## 若出现异常

- 侧栏突然变回 DSH 原样 → 说明 entry 崩溃并 abdicate，查控制台 `[dsh-sidebar-rail] render failed`。
- 侧栏空白 → 检查 `dsh.client` 的 `./client` 导出与 `client.js` 是否被页面加载。
- 需要立即回退：`plugin_manager action: set_bundle target: dsh-sidebar-rail enabled: false`。
