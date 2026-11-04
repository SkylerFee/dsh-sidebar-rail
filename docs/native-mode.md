# 原生展开态（可选）

## 是什么

本插件有两种展开态：

| 模式 | 展开后的列表区 | 触发条件 |
| --- | --- | --- |
| **managed（默认）** | 插件自绘：置顶项目 / 项目 / 最近会话(10)，项目行下挂会话 | 开箱即用 |
| **native（可选）** | **复用宿主原生工作区浏览器**：搜索、Show more、拖拽排序、行内重命名/Fork/归档菜单全部保留；品牌标与设置座位也走宿主 | 需两步显式开启 |

默认走 managed 的原因：`sidebar` 的 7 个子槽由 `@deepseek-ai/dsh-client-ui-sidebar` 声明，**重复声明会抛错**（`slot "…" is already declared`）。只有让宿主侧栏下线，本插件才能接管这些子槽。

## 怎么开

### 第一步：停用宿主侧栏行

编辑 `~/.dsh/profiles/desktop/cordis.patch.yml`，在顶层数组追加：

```yaml
- id: ui-sidebar
  name: "@deepseek-ai/dsh-client-ui-sidebar"
  disabled: true
```

（该文件是用户补丁层，语法与本机现有条目一致；`disabled: true` 即停用该行。）

### 第二步：打开插件开关

在浏览器控制台执行（页面来源 `http://127.0.0.1:65028`）：

```js
const k = 'dsh.sidebar-rail.v1'
localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) || '{}'), nativeExpanded: true }))
location.reload()
```

### 第三步：重启 DSH Web 进程

profile patch 的改动在启动时合成，只刷新页面不生效。

## 怎么回退

1. 删掉上面那段 `ui-sidebar` 补丁条目（或改成 `disabled: false`）；
2. 控制台把开关设回 false：

```js
const k = 'dsh.sidebar-rail.v1'
localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) || '{}'), nativeExpanded: false }))
```

3. 重启 DSH Web。

**兜底**：若开关为 true 但 `ui-sidebar` 仍在（忘了第一步），插件注册子槽会抛错；代码里已 catch 并自动退回 managed 注册，侧栏不会消失，控制台会打印一次 `[dsh-sidebar-rail] native layout unavailable, falling back`。

## 取舍

| | native | managed（默认） |
| --- | --- | --- |
| 宿主浏览器交互 | 全部保留 | 无（仅自绘列表） |
| 事故面 | 宿主侧栏下线，若本插件加载失败侧栏会空 | 宿主侧栏仍在账本里，插件崩溃时会自动让位给原装侧栏 |
| 重启要求 | 需要（profile patch 变更） | 不需要 |

## 验证状态

native 分支的代码路径已实现，但**未在真实页面验证**（本项目开发环境无浏览器控制能力）。启用后如出现列表空白，请检查控制台：
- `[dsh-sidebar-rail] native layout unavailable` → 子槽仍被占用，检查第一步是否生效；
- slot crash 报错 → 说明 `renderSlot` 调用参数与该版本宿主不符，把报错发回即可修。
