# 0001 窄窗判定用纯函数，不用 CSS 媒体查询

- 状态：已采纳（2026-11-04）
- 相关：`client.js` `shouldRenderRail` / `RAIL_MIN_VIEWPORT`

## 背景

浮轨是浮层（`position: fixed`），会盖在主内容左侧。窗口窄到正文放不下时继续显示会压住会话内容，因此需要一个「什么时候不画」的判定。最初用的是 `@media (max-width: 900px) { display: none }`。

900 这个数是拍的：它与轨自身的盒模型无关，也与宿主的断点（drawer 768、自动折叠 1024）没有对应关系，改宽度时没人能解释为什么是 900。

## 决定

判定改为纯函数 `shouldRenderRail(platform, collapsed, viewportWidth)`，阈值 `RAIL_MIN_VIEWPORT = 768`：

```
768 = 680（宿主正文最小可读宽）+ 56（轨宽）+ 32（两侧安全边距）
```

由 `window.innerWidth` + `resize` 监听驱动；不满足时组件直接 `return null`（不是 CSS 隐藏）。

## 后果

- 阈值语义与「正文还放不放得下」直接挂钩，可按宿主的内容宽公式重新推导，而不是拍脑袋。
- 判定可被单测覆盖边界（`test/data.test.ts` 的 `shouldRenderRail` 用例），CSS 媒体查询无法单测。
- 代价：多了一个 `resize` 监听与一次 re-render。轨在阈值以下整体卸载，没有可观察的盒模型，所以不能用 `ResizeObserver`。
- 窄窗下宿主在 `shell.leading` 的重开控件仍在，隐藏浮轨不损失回到侧栏的路径。

## 不要做什么

不要改回 CSS 媒体查询，也不要为了「更保险」把阈值调到 900 以上：那会在 768–900 的白丢一段可用宽度（真机已验证 858 宽时浮轨工作正常）。
