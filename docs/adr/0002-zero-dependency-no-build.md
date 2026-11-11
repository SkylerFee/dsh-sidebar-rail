# 0002 零依赖、无构建：客户端是手写静态模块

- 状态：已被 [ADR-0006](0006-typescript-source-and-build.md) 取代（工具链维度）
- 历史状态：已采纳（2026-11-04）
- 相关：`client.js`、`package.json`（无 `dependencies`/`devDependencies`）、`scripts/check.mjs`（迁移后拆为 `scripts/check-source.mjs` 与 `scripts/check-artifact.mjs`，见 [ADR-0006](0006-typescript-source-and-build.md)）

## 背景

宿主通过 `window.__ModuleLoader__.load()` 加载客户端半边，并把 `exports["./client"]` 指向的文件组合进启动脚本。插件的能力边界全部由宿主注入（`inject: ['slots', 'locale', 'layout', 'uiWorkspace', 'remote']`）与标准 props 提供；样式用宿主主题 token。

也就是说：这个插件不需要编译，也不需要在自己的 `node_modules` 里带任何东西。

## 决定

- 运行时只 `require('react')` 与 `require('react-dom')`（平台种子模块），不引入其他运行时依赖。
- 不引入构建步骤，`client.js` 是可直接加载的成品；`package.json` 没有 `build` 脚本。
- 不引入 ESLint/Prettier 等 devDependency；机械规则写在 `scripts/check.mjs`（纯 Node，无依赖），由 `npm run check` 统一调用。迁移后这一步由 `scripts/check-source.mjs`（源码约束）与 `scripts/check-artifact.mjs`（产物约束）承担。
- 提交前检查用仓库内 `.githooks` + `git config core.hooksPath`，不用 husky。

## 后果

- 安装即生效：profile 里 `link:` 到本目录就能跑，没有「先构建」的失败模式。
- 检查能力受限：没有类型检查，语义错误靠单测 + 真机验收 + review。这是自觉的取舍，不是遗漏。
- 新增规则的成本落在「自己写一段 Node」上；相应地，规则必须真的能拦住错误，否则不如不写。

## 不要做什么

不要为了「工具链完整」引入打包器或 lint 框架。若某个规则确实无法用脚本表达，写进 [CODING_STANDARDS.md](../../CODING_STANDARDS.md)——那是 judgement 类，不是机制问题。
