# 0008 浮层高度随锚点与内容，不强行占满全高

- 状态：已采纳（2026-11-11）
- 修正：[ADR-0004](0004-sectioned-flyout.md) 的「浮层占满可用高度、高度不随内容变化」与 [ADR-0007](0007-single-scroll-flyout.md) 中对该条的沿用
- 相关：`src/client/components/flyout-shell.tsx` 的 `makeFlyoutShell`、`src/client/components/flyouts.tsx` 的 `shell()` 调用、`src/client/model/geometry.ts` 的 `flyoutPlacement` / `flyoutSectionedHeight`

## 背景

ADR-0004 决定浮层「顶部从 `--dsh-frame-top-clearance` 之下开始，底部到窗口底」，理由是 0.3.x 的「视口 70% 定高」在分区变多后显得局促。ADR-0007 撤销分区滚动结构时明确保留了这一条。

2026-11-11 的验收报告（`docs/desktop-audit-2026-11-11.md` 的 F3）用真机实测指出：任务浮层实际从 **y≈98** 开始、展开两个空态分区后底边从 **y≈371** 变到 **y≈491**——既没有贴窗口底，高度也随内容变化。工作区顶边约 58px、插件顶边约 138px，都跟着图标锚点走。

核查后确认这不是新增回归，而是一条**从未落地的决定**：

- 0.4.0 的 `client.js` 确实给三个分区浮层传了第七个参数 `topFlush = true`（`flyoutShell(..., stepper, undefined, undefined, true, true)`）；
- TypeScript 迁移（`0ae88d3`）把调用改写成 `props.shell(..., undefined, undefined, undefined, true)`，**6 个参数，漏掉末尾的 `topFlush`**；
- 此后 `flyouts.tsx` 的三处调用一直只传 `sections = true`，`topFlush` 恒为 undefined，于是 `makeFlyoutShell` 走 `flyoutPlacement` 的锚点分支，高度取锚点以下的剩余空间且不设 `height`。

也就是说，代码与 ADR 从迁移那天起就不一致，只是没有人在真机上量过。

## 决定

**接受当前实现为正确行为，不再追求「占满全高」。** 三个分区浮层（工作区 / 任务 / 插件）继续：

1. **按触发图标的位置摆放**：`flyoutPlacement` 用图标矩形算出上边或下边偏移，`maxHeight` 取该位置以下的剩余空间。
2. **高度随内容**：不写内联 `height`，面板由内容撑开，内容变多就变高，受 `maxHeight` 封顶。
3. **不覆盖顶部 chrome 带**：`flyoutPlacement` 仍以 `FLYOUT_EDGE_GAP` 与锚点矩形为界，不会压到 macOS 红绿灯与宿主的重开控件。这条是 ADR-0004 里**仍然有效**的部分。

改这个决定而不是改代码，理由有三：

- **它更贴近宿主**。「浮层跟着触发它的图标走」是弹层的一般预期；把面板强行拉到窗口两侧到底，反而是插件自造的一套版式。
- **它让五个浮层行为一致**。账号浮层本来就底边对齐且高度随内容（实测 `y=584、height=218、bottom=802`）；「更多」浮层同理。只有三个分区浮层被强行拉满，反而是特例。
- **内容变化不再引起跳变**。ADR-0004 当初担心「浮层高度随内容跳动」，但真正造成跳变的是**分区各自的滚动与限高**（ADR-0007 已删）。现在整块内容共用滚动容器、分区折叠只让内容变短，`maxHeight` 封顶之下高度平稳增长，不构成视觉抖动。

## 后果

- `flyoutSectionedHeight` 与 `topFlush` 参数保留在代码里但**三个分区浮层不再使用**；若将来要恢复全高，传 `topFlush = true` 即可，无需改 `flyout-shell`。
- 「最近会话条数 / 分页不影响浮层高度」这条性质**仍然成立**，但成立方式变了：不是靠固定高度，而是靠 `maxHeight` 封顶 + 整体滚动——条目增减只改变滚动内容，不改变面板外框（除非内容跨越了 `maxHeight` 边界）。
- 短浮层（任务、插件）在内容少时明显矮于整屏，下方留白是真实高度差异，不是渲染缺陷。
- 验收口径随之改变：不再要求「浮层底边贴窗口底」，改为要求「不覆盖顶部 chrome 带、不越出窗口、内容超出时内部滚动」。

## 不要做什么

- 不要为了对齐旧 ADR 而补回 `topFlush`。那会把三个浮层拉满全高，与账号 / 更多浮层的观感割裂。
- 不要删掉 `topFlush` 与 `flyoutSectionedHeight`：它们是「将来若要恢复全高」的唯一入口，删了就得重写定位逻辑。
- 不要把「高度随内容」理解成「高度无上限」。`maxHeight` 必须始终按锚点与视口计算，否则短窗口下面板会溢出。
