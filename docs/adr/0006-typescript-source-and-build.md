# 0006 源码改为 TypeScript / TSX，由 esbuild 生成 ModuleLoader 客户端

- 状态：已采纳（2026-11-10）
- 取代：[ADR-0002](0002-zero-dependency-no-build.md) 的「无构建、无 devDependency」**工具链决定**——只在工具链维度取代。ADR-0002 的历史理由与其余约束继续有效，原文保留不删。
- 相关：`src/`、`scripts/build.mjs`、`scripts/check-source.mjs`、`scripts/check-artifact.mjs`、`tsconfig.json`、`.npmrc`、`package-lock.json`、`package.json`（`devDependencies` / `exports` / `files`）、`lib/`（生成目录）、[TypeScript 迁移执行指南](../typescript-migration.md)

## 背景

0.4.0 的客户端是一个 2,953 行的手写 `client.js`：`RailColumn` 单组件约 927 行，纯逻辑靠 `#region pure-helpers` / `#region pure-data` 标记，测试从 `client.js` 里切片执行。这带来三个只有重构才能解决的问题：

- 没有类型：宿主 props、服务返回值、状态联合全靠 review 与真机验收兜底，错误只能在运行时暴露。
- 模块边界由注释标记承担：切片机制一旦标记漂移，单测会在更少的代码上继续全绿。
- 单文件承载全部交互：浮层、点击区域、定时器与清理逻辑互相纠缠，改动一处很难判断影响面。

[ADR-0002](0002-zero-dependency-no-build.md) 的前提是「客户端是单文件手写成品，安装即生效」。这个前提成立时，「不构建」是正确的取舍。迁移要把源码拆成按职责组织的 TypeScript / TSX 模块，前提变了：源码不再是宿主可以直接加载的成品，构建步骤因此不可避免。按仓库惯例（`docs/agents/domain.md`：与既有 ADR 冲突要显式说明），新决定单独成文，旧 ADR 只标注被取代，不删除历史理由。

## 决定

1. **源码分层**：客户端源码放 `src/`，按职责拆成 `client/index.tsx`（组织注册与清理）、`client/host-adapter.ts`（宿主服务调用与公开类型适配）、`client/contracts.ts`（组件契约与宿主输入形状）、`client/preferences.ts`、`client/locales.ts`、`client/styles.css`、`client/jsx.ts`（classic JSX 工厂垫片）、`client/model/*`（不依赖 React / DOM 的纯逻辑）、`client/hooks/*`、`client/components/*.tsx`；`src/index.ts` 仍是空的 Host `apply`。具体文件划分以迁移指南 §3 为准，不为凑文件数机械拆分。
2. **类型检查与转换分离**：`tsc --noEmit -p tsconfig.json` 负责类型检查（`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 等），esbuild **只做转换与打包**，不承担类型检查。两者都是必跑项，不能互相替代。
3. **产物**：`scripts/build.mjs` 生成 `lib/index.js`（ESM，保留空的 Host `apply` 导出）与 `lib/client.js`（单个静态脚本）。包入口（`exports` / `files`）指向 `lib/`；`dsh.bundle.patch`、`dsh.client` 的 `platform` / `immediately` / `inject` 语义保持现值。
4. **加载协议不变**：`lib/client.js` 调用一次 `window.__ModuleLoader__.load({ id, factory })`，`id` 为完整包名 `@skylerfee/dsh-sidebar-rail`；工厂经传入的 `require` 取得宿主 `react` / `react-dom`，返回客户端的 `inject` 与 `apply`。包内相对模块静态打进这一份文件，首期不做动态 import 或拆 chunk。
5. **JSX 用 classic 转换**：生成 `React.createElement`，运行时只请求已有的 `react` / `react-dom`，不额外请求 `react/jsx-runtime`。宿主按平台种子模块提供 React，插件不私有打包一份，否则会出现两份 React 实例。
6. **CSS 仍由插件生命周期管理**：`client/styles.css` 作为文本进入产物，仍由 `apply` 的 effect 创建带 `data-dsh-sidebar-rail` 标记的 `<style>`，卸载时删除。不改成不受生命周期管理的顶层样式注入。
7. **`lib/` 是生成目录**：已收录进 `.gitignore`，不提交 Git、不手工编辑；编辑 `src/` 之后必须重新 build（开发时用 watch）。源码不再承诺「改完即生效」。

## 依赖与工具链事实

`devDependencies` 以 `package.json` 实际声明为准（迁移落地时读到的值，锁文件解析版本见括号）：

| 依赖 | 声明范围 | 作用 |
| --- | --- | --- |
| `typescript` | `^5.9.3`（5.9.3） | `tsc --noEmit` 类型检查 |
| `esbuild` | `^0.28.2`（0.28.2） | 只做转换与打包 |
| `tsx` | `^4.23.15`（4.23.15） | 直接运行 TypeScript 单测 |
| `react` / `react-dom` | `^18.3.1` / `^18.3.1`（18.3.1） | 仅供本地类型与测试；客户端运行时仍用宿主实例 |
| `@types/node` | `^22.20.5`（22.20.5） | Node 类型 |
| `@types/react` / `@types/react-dom` | `^18.3.31` / `^18.3.7` | React 类型 |

- **仍然没有 `dependencies`**：本次不新增任何运行时实现库，客户端运行的依赖只有宿主提供的 `react` / `react-dom`。
- **仍然使用 npm**：不因迁移切换包管理器，新增并提交 `package-lock.json`（当前 `lockfileVersion` 为 3），CI 与本地一律 `npm ci`。`engines.node` 保持 `>=22.19.0`。
- **新增 `.npmrc` 的 `legacy-peer-deps=true`**：本项目 `peerDependencies` 里 cordis 的范围是 `~4.0.4 || ~4.0.5-alpha.1`，而目标宿主 0.2.2-rc.1 的 `@deepseek-ai/dsh-client-*` 0.2.2-rc.1 声明 `@deepseek-ai/cordis: ~4.1.0`（已核对该代发布包元数据）。这个差异是**既有事实**：迁移只让开发安装按 legacy 模式解析、避免 `ERESOLVE` 阻断本地与 CI 构建，**不扩大也不缩窄**发布包的 peer 范围。`.npmrc` 只影响开发安装，不进入发布语义。
- 构建必须能在干净的独立目录完成：不依赖相邻项目的 `node_modules`、个人机器的全局包或宿主仓库的私有脚本。

## 类型事实与 SDK 边界

宿主发布包 `@deepseek-ai/dsh-client-ui-*/client` 的 `exports` 确实带类型（指向 `./lib/types/client/index.d.ts`），但这些 `.d.ts` 不是自包含的：它们继续 import `@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-brand`、`@deepseek-ai/dsh-client-ui-theme/client`、`@deepseek-ai/dsh-client-runtime/client`、`@deepseek-ai/dsh-client-ui-settings/client` 等，而这条链上存在**取不到的包**：`@deepseek-ai/dsh-api-remotes`（`dsh-client-ui-workspace` 的类型链会用到）依赖 `@deepseek-ai/dsh-type-meta`，后者在 npm registry 上返回 404。此外若干包当前代只发在非 `latest` 的 dist-tag 下（例如 `@deepseek-ai/dsh-client-ui-settings` 的 `0.2.2-rc.1` 挂在 `next`），直接安装解析到的可能是另一代，而 `dsh-client-locale/client` 的类型引用了它。

因此本项目的类型策略是：

- **只从公开包派生本插件真正用到的 props / 服务形状**，不整条引入宿主类型依赖链，也不为此把这些包塞进 `devDependencies` 假装自包含。
- 宿主数据结构在 `src/client/model/` 与 `src/client/host-adapter.ts` 里**显式声明为本地类型**，并在代码注释里标明对应的宿主来源（包名 + 源码位置），按目标宿主版本核对。
- **`skipLibCheck` 只对第三方 `.d.ts` 生效**，不得用来掩盖本项目源码的类型错误；禁止用 `any` 兜底、`as any`、`@ts-ignore` / `@ts-expect-error` 或虚构模块声明把错误压下去。
- 宿主版本以实际验收的已发布包为准；本地 DSH 主仓库源码可能与已发布包不同代，本地编译通过不能当作已发布 App 兼容证据。

## 不随本决定改变的约束

本次只换源码形态与工具链。以下产品与宿主约束**全部继续有效**，写进 `AGENTS.md` 硬约束，不因引入构建而放宽：

1. 不替换宿主 `sidebar` 单槽；轨只通过 `shell.overlay` 增量注册，条目 ID 仍是 `dsh-sidebar-rail.rail`，设置块仍注册到 `plugins.bundle.config`。
2. 不改宿主栅格列宽，不用 `!important` 覆盖宿主样式；浮轨只能 `createPortal(document.body)` + `position: fixed`。
3. 轨默认隐藏（`translateX(-100%)`），由 12px 热区或键盘焦点唤出，不得改回常驻显示。
4. 窄窗判定仍是可单测的纯函数（阈值 768），不得改回 CSS 媒体查询。
5. 折叠状态归宿主：只读 `data-sidebar-collapsed`，不持久化、不在挂载时纠正；插件偏好键仍是 `dsh.sidebar-rail.v1`。
6. 可选 Host 调用必须有超时与失败态，不把「服务不存在 / 不返回」呈现成永久加载。
7. 账号只经宿主服务读取，不向插件本地存储写入账号数据。

## 后果

- 本地 checkout 不再「装好即跑」：首次要 `npm ci`，改完源码要 `npm run build` 或跑 `npm run dev`（watch）。这是为了换来模块边界与类型检查，代价明确。
- 消费者（npm / tgz 安装）不受影响：发布包里是预构建的 `lib/`，**安装者不需要编译器，也不在本地构建**。发布流程仍需在 publish 之前完成完整 `check`（`.github/workflows/publish.yml` 用 `npm publish --ignore-scripts`，不会自动触发构建脚本）。
- CI 需要安装依赖（`npm ci`）并执行构建步骤；`npm run check` 变成「类型检查 → 源码检查 → 单测 → 构建 → 产物检查 → 产物测试」的一条链。
- 测试不再依赖 `#region` 切片：纯逻辑由 `test/*.test.ts` 直接 import 源码模块，产物协议由 `test/*.test.mjs` 在只有 `window.__ModuleLoader__` 的 VM 里验证。切片机制与相关规则检查随之删除，不保留空 region 让旧检查继续通过。
- 机械事实：`package.json` 的 `exports["."]` / `exports["./client"]` 与 `files` 已指向 `lib/index.js`、`lib/client.js`，`devDependencies` 与 `package-lock.json` 已随迁移进入仓库，`lib/` 已在 `.gitignore` 中忽略。这些一致性由 `scripts/check-source.mjs` 与 `scripts/check-artifact.mjs` 持续兜底，不靠人工记忆维持。

## 不要做什么

- 不要为了「工具链完整」再引入 ESLint、Prettier、Vite、UI 框架或状态管理库；要加先改本 ADR 与依赖清单，不要「顺手接入」。
- 不要新增 `dependencies` 运行时实现库，也不要把 React 打进产物、不要在产物里 `require` 宿主 Client 内部包。
- 不要用 `skipLibCheck`、`any`、`as any`、`@ts-ignore` 或虚构模块声明掩盖本项目自己的类型错误；宿主类型一律 `import type`，不进入产物。
- 不要提交 `lib/`、不要手改生成文件；不要在源码与产物之间同时维护两份可修改实现。
- 不要删除或改写 [ADR-0002](0002-zero-dependency-no-build.md) 的历史理由：它记录的是「单文件手写成品」前提下的正确取舍，本 ADR 只说明前提已变。
