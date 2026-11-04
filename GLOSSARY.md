# 术语表

本仓库统一用词。写 issue、spec、ticket、测试名、代码命名时，用这里的词，不要换同义词。

## 轨 rail / sidebar

- **sidebar**：宿主的左侧导航列，归宿主所有（`ui-sidebar` 是它的占用者）。侧栏的展开/折叠状态、宽度、内部座位都由宿主决定。
- **rail（轨）**：本插件在 macOS 折叠态补出来的 56px 图标条。**它不是 sidebar，也不是 sidebar 的替代品**——它浮在 frame 之上，只出现在宿主折叠、且视口够宽的时候。

用错的表现：把 rail 说成「侧栏」、或在文档里暗示插件接管了 sidebar。

## 浮层 flyout

悬停轨上某个图标后弹出的列表面板（`.dsr-flyout`）。它是 `role="dialog"` 的浮层：120ms 悬停打开、移出 200ms 关闭、`Escape` 关闭。

**不是** modal（不阻塞页面）、**不是** dropdown（不依附于表单控件）、**不是** popover 里的菜单项集合。

## 折叠 collapsed

宿主侧栏处于收起状态。判定依据是宿主发布在 frame 元素上的 `data-sidebar-collapsed` 属性。

**折叠状态归宿主**：插件只读，不持久化、不在挂载时纠正。本仓库里说「折叠态」时，指的是宿主的状态，不是插件自己的开关。

## 浮层座位 overlay seat

`shell.overlay` 槽——ui-layout 声明的 frame 级 `list` 槽，宿主用来放全局浮动表面（toast、菜单、本插件的轨）。条目自带 `id`、`order`，彼此并列而非替换。

关键含义：注册进这个座位是**增量**的，不需要声明 `children`，也不会抢占宿主已有的 UI。轨就挂在这里（`id: 'dsh-sidebar-rail.rail'`）。
