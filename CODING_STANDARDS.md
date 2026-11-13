# 编码规范（判断类）

本文件给 **review agent** 读，不塞进实现 agent 的上下文。凡是能确定性检查的规则都已经在 `scripts/check-source.mjs`（源码）与 `scripts/check-artifact.mjs`（产物）里（`npm run check` 一次跑全），不要在这里重复描述。

判断标准：**如果一个规则能用正则/脚本判定，它就应该在脚本里，不在本文件。**

实现形态：源码在 `src/`（TypeScript / TSX，按职责分模块），由 `scripts/build.mjs` 生成 `lib/index.js` 与 `lib/client.js`。工具链决定见 [ADR-0006](docs/adr/0006-typescript-source-and-build.md)；`lib/` 是生成目录，不提交 Git、不手工编辑。

## 1. 什么时候必须记录真机验收

任何改变用户可见行为的改动（渲染、交互、样式、加载方式），都要在本次 PR 里追加一轮真机记录，且必须写清四件事：

1. 环境（宿主版本、平台、主题、语言）
2. 操作（怎么复现到那个状态，包括合成输入的命令）
3. 结果（**可核对的量**：像素测量、对比度数值、槽占用者、截图结论）
4. 未验证项（明确写出来，不许用「已验证」概括没做的事）

只改文档或纯逻辑函数时不需要追加验收轮次，但纯逻辑改动必须在对应的 `test/*.test.ts` 有对应用例。

## 2. 测试该写到哪一层

- **纯函数必须单测**：`src/client/model/`、`src/client/host-adapter.ts` 里的纯逻辑由 `test/*.test.ts` 直接 `import` 执行（经 `tsx`），不再靠 `#region` 切片。改这些函数必须同时改测试。
- **可单测的判定要留在纯层**：几何、分组、归一化、状态转换这类逻辑放进 `model/`（不 import React、不访问 DOM），别埋在组件里——组件里的逻辑只能靠真机验收。
- **渲染与样式不进单测**：这个仓库没有 jsdom，也不需要——组件行为靠真机验收确认。若确需组件渲染测试，先说明它能捕获哪个具体风险、为什么更小的流程测试不够。
- **产物协议单独测**：`test/*.test.mjs` 消费已构建的 `lib/`，在只有 `window.__ModuleLoader__` 的 VM 里验证注册、工厂 `require`、`inject` / `apply` 与清理。它证明生成物能被宿主加载，不替代行为单测。

## 3. 异步与失败处理

- 每个异步取数都要有 **loading / ready / failed** 三个确定状态，页面必须能区分它们。
- **禁止静默 catch**：`catch(() => {})` 只能出现在「已经在上层处理并有可见结果」的地方，且要写明为什么。
- **可选的 Host 调用必须有超时**（参见 `REMOTE_TIMEOUT_MS`）：服务不存在、未授权、或不返回，都必须落到失败态，不能永远停在「加载中」。
- 组件卸载后不得再写入状态（用 `live` 标志/清理函数）。

## 4. 依赖、类型与构建边界

- **运行时依赖必须保持为零**：产物里只能从宿主 `require('react')` 与 `require('react-dom')`，其他宿主能力一律通过注入或标准 props 获取；不得新增 `dependencies` 或运行时实现库。
- **开发依赖受 [ADR-0006](docs/adr/0006-typescript-source-and-build.md) 约束**：`devDependencies` 只放 TypeScript / esbuild / tsx / React 与 `@types/*` 这类开发期工具。不得为了「顺手接入」再引入 ESLint、Prettier、Vite、UI 框架或状态管理库——需要新工具先改 ADR-0006 与依赖清单。需要新规则就往 `scripts/check-source.mjs` 或 `scripts/check-artifact.mjs` 里加。
- **构建只有一条路径**：`node scripts/build.mjs`（`npm run build` / `npm run dev` 的 watch）。不得手写 `lib/`、不得提交 `lib/`、不得让源码与产物同时存在两份可修改实现。
- **严格类型**：源码必须在 `tsc --noEmit` 的 `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` 下通过。**禁止 `any` 兜底、`as any`、`@ts-ignore` / `@ts-expect-error`、虚构模块声明**把错误压下去；跨边界输入用 `unknown` 收窄。
- **`skipLibCheck` 只用于第三方 `.d.ts`**：宿主发布包的类型链并不自包含，允许跳过第三方声明文件的检查，但不允许用它掩盖本项目源码的类型错误。
- **宿主类型只 `import type`**：从公开包派生本插件真正用到的 props / 服务形状，宿主数据结构在 `model/` 与 `host-adapter.ts` 里显式声明为本地类型并注释来源；不要把宿主实现代码或类型运行时依赖打进产物。
- **字典要有类型约束**：`zh` / `en` 字典在 `src/client/locales.ts`，以中文键集合约束英文键集合与 `t()` 参数（键联合类型），保持现有 namespace 与文案语义，不因拆文件丢失动态使用的键。

## 5. 提交粒度与证据

- 一个提交只做一件事；跨文件的大改（如重构）单独成提交。
- 提交信息用 conventional commits（`.githooks/commit-msg` 会拦），**body 写清验证方式与未验证项**——尤其是有真机验证的改动，要写测量结果，不要只写「verified」。
- 破坏性改动加 `!`，并在正文说明影响范围、迁移与恢复方式。
- PR 标题保留 Conventional Commits 的英文类型与可选作用域，摘要、正文及验证结论使用简体中文；代码标识符和原始诊断保留原文。按 [PR 模板](.github/pull_request_template.md) 区分实际结果与未验证项。

## 6. 注释、日志与命名

- 每个函数前有中文 JSDoc：用途 + 非显然的行为/参数含义；公开函数补返回值与失败语义。
- **关键判定入口与结果要打日志**，用 `[dsh-sidebar-rail]` 前缀；日志不得包含会话正文、凭据或完整用户数据。
- CSS 类一律 `.dsr-*` 前缀；`localStorage` 只用 `dsh.sidebar-rail.v1`；样式节点带 `data-dsh-sidebar-rail` 标记。CSS 在 `src/client/styles.css`，作为文本打进产物，仍由 `apply` 的 effect 注入与清理。
- 文案走 `src/client/locales.ts` 的 `zh` / `en` 字典（类型与脚本校验两侧对齐），**不要在 JSX 里硬编码中英文**。
- 类型导入用 `import type`；模块职责与依赖方向见 [ADR-0006](docs/adr/0006-typescript-source-and-build.md)，不要新建收纳杂项的 `utils.ts`。

## 7. 渲染层没有单测，靠这些规则兜底

纯逻辑单测只覆盖 `model/` 与 `host-adapter.ts` 的纯函数（第 2 条），
**渲染代码零覆盖**。所以下面这些错误 `npm run check` 抓不到，只能靠 review 与这组规则：

- **不要用与外层同名的 `const` 接住计算中间值。**
  `const sessions = projectSessionRows(row.sessionIds, sessions.byId, …)` 这种写法会命中
  temporal dead zone，在每次渲染时抛 `ReferenceError`，而所有单测仍然全绿。
  中间值另取名字（`sessionRows`）。0.4.0 的 #3 票真实踩过。
- **只在打开态执行的代码路径，单测与静态检查都不会跑到。**
  浮层正文、`projectRow` 这类只在 `open === '…'` 分支里求值的函数，出错只有真机能暴露。
  改动它们时，必须在 review 里逐个调用点核对变量来源，并记录真机结果。
- **新增的 `useState` 要问「谁负责把它重置」。**
  轨组件常驻挂载（`RailColumn` 从不卸载），所以组件 state 会跨浮层开关存活。
  凡是不持久化的 UI 状态，都必须在该浮层关闭时显式清空，否则下次打开会继承上次的状态。

## 相关文档

- 硬约束与导航：[AGENTS.md](AGENTS.md)
- 架构与实现细节：[docs/design.md](docs/design.md)
- 不可逆决定：[docs/adr/](docs/adr/)（工具链见 [ADR-0006](docs/adr/0006-typescript-source-and-build.md)，被取代的旧决定见 [ADR-0002](docs/adr/0002-zero-dependency-no-build.md)）
- 术语表：[GLOSSARY.md](GLOSSARY.md)
