# dsh-sidebar-rail TypeScript 迁移执行指南

> 日期：2026-11-10。状态：待实施，供后续执行 Agent 使用。本次只生成文档，没有迁移源码、修改规则、安装依赖或改变用户 profile。
>
> 迁移目标：将单文件手写 JavaScript 改为按职责组织的 TypeScript / TSX 源码，以轻量构建生成宿主可直接加载的客户端文件。保留现有产品行为和宿主集成方式；既有功能缺陷单独跟踪。

## 1. 执行范围与前提

目标仓库：`/Users/liufei/Projects/deepseek-harness-plugins/dsh-sidebar-rail`。父目录不是 Git 仓库，不要在父目录执行提交或清理操作。

本文是后续实施方案，不代表当前已经完成迁移，也不替代用户对安装、profile 修改、提交、推送或发布的授权。后续收到明确的迁移实施任务后，按本文阶段推进；本地源码重构、构建和离线检查属于实施范围。

### 1.1 开始前必读

- [项目规则](../AGENTS.md)、[中文说明](../README.zh.md)、[编码规范](../CODING_STANDARDS.md)、[术语表](../GLOSSARY.md)。
- [ADR-0002：零依赖、无构建](adr/0002-zero-dependency-no-build.md)。
- [ADR-0004：分区浮层](adr/0004-sectioned-flyout.md)、[ADR-0005：宿主公开 API](adr/0005-host-public-api-boundary.md)。
- [0.4.0 分区规格](spec-0.4.0-sectioned-flyout.md)、[最新验证记录](verify.md)、[2026-11-10 Desktop 审计](desktop-audit-0.4.0-2026-11-10.md)。
- [现有设计说明](design.md)：其中仍有旧布局描述，应结合上述规格、ADR 和当前源码核对，不能按旧文档把布局改回 70% 高度或两区等分。

### 1.2 范围内

- 拆分源码、补充严格类型、将组件迁为 TSX。
- 建立独立可复现的构建、类型检查、源码检查、产物检查及测试入口。
- 迁移既有行为测试，补充与本次模块边界、生命周期和加载方式相关的必要测试。
- 更新包入口、文件白名单、CI、发布前检查和开发说明。
- 用新的架构决策替代“禁止开发依赖和构建”的限制；同步受影响的项目规则。

### 1.3 范围外

- 新增产品功能、重做视觉设计、支持 Windows / Linux Desktop。
- 修改 DSH 主仓库或其他插件，升级用户正在运行的宿主。
- 引入状态管理框架、组件库或完整前端应用脚手架。
- 修改用户数据格式、会话、账号、凭据、定时任务或其他插件的启停状态。
- 将已有缺陷静默合并进重构，或把离线检查通过写成完整真机验收通过。

## 2. 基线与必须保留的事实

### 2.1 本文核对时的基线

| 项目 | 记录 |
| --- | --- |
| 分支 / 提交 | `main` / `f88c6600451f7209f1fb7e46543b8e6edb8f1987` |
| 插件版本 | `@skylerfee/dsh-sidebar-rail@0.4.0` |
| 当前入口 | `index.js` 为 8 行空 Host 入口；`client.js` 为 2,953 行客户端 |
| 主组件规模 | `RailColumn` 约 927 行，包含多类浮层与交互逻辑 |
| 现有工具链 | 无依赖安装、无编译；`npm run check` 执行仓库规则、语法检查和测试 |
| 本会话实际检查 | 2026-11-10 执行 `npm run check`，57 项测试通过；48 个中英文键对齐 |
| 最近真机报告 | macOS Desktop `0.2.2-rc.1`；报告结论为完整验收未通过 |

开始实施时重新执行 `git status --short`、`git rev-parse HEAD` 和现有 `npm run check`。以上是文档创建时的快照，不保证未来工作树和宿主版本相同。

P0 就要只读核查目标 profile 是否 link 本 checkout，以及插件是否正在运行。审计报告中的 Desktop profile 使用过这种 link；若仍在使用且没有改变该运行环境的授权，先建立独立 worktree，再开展任何源码、过渡产物或包入口编辑。无法确认运行状态时同样先隔离，不能等到 P4 才保护运行中的加载文件。

当时已存在以下其他任务的改动，不能覆盖、删除或混入自己的提交：

```text
 M docs/verify.md
?? docs/desktop-audit-0.4.0-2026-11-10.md
```

本指南也是当前新增文档。不要使用 `git reset --hard`、`git clean` 或全仓库 `git restore` 来准备工作区；如需隔离，使用单独分支或 worktree，并显式携带阅读所需的未提交报告。

### 2.2 既有缺陷与证据边界

| 编号 | 已知问题 | 证据 | 迁移处理原则 |
| --- | --- | --- | --- |
| K1 | 添加项目真机约 5s 后失败；成功选择值还会被丢弃 | 审计报告；基线 `client.js` 的 `.then((picked) => undefined, (error) => error)` | 不把类型检查通过当作修复。目录选择后端为何不返回仍未定位；丢值是另一个已证实问题 |
| K2 | 默认收起的「已暂停」分区第一次点击不展开 | 真机与原回调探针均复现；`toggleSection` 未计入默认态 | 需要状态转换测试；TypeScript 不会自动证明首次切换正确 |
| K3 | 浮层外框越过视口底边 2px | 957×949 CSS px 视口中的真实尺寸测量 | 需要 CSS 和实际几何验收，不属于类型问题 |

默认只做结构迁移。若后续任务同时授权修复，给 K1 / K2 / K3 各自保留独立的改动说明、回归证据和验收状态。若暂不修复，则记录迁移后的复现结果，不改变断言或隐藏失败来制造“全功能通过”。

### 2.3 产品与宿主约束

1. 包名保持 `@skylerfee/dsh-sidebar-rail`；客户端 ModuleLoader ID 与包名完整一致。
2. 保持 `shell.overlay` 的增量注册，条目 ID 为 `dsh-sidebar-rail.rail`；设置块仍注册到 `plugins.bundle.config`，key 为完整包名。
3. 不替换 `sidebar` 槽，不改宿主列宽，不用 `!important` 覆盖宿主布局。
4. 轨仍是 body 级 portal，默认隐藏；12px 热区、键盘路径和顶部窗口 chrome 避让保持原语义。
5. 轨只在 macOS Desktop、宿主折叠且视口宽度至少 768px 时渲染。Web 不绘制轨；插件设置块不受轨显隐限制。
6. 宿主折叠状态只读；监听器、定时器、观察器、样式和槽贡献都必须能完整清理。
7. 只使用宿主公开服务与标准 props。任务条目打开任务面板，不增加内部详情定位；插件列表不增加启停开关。
8. 工作区 / 会话来自宿主标准 hooks；任务与插件每次打开浮层重新取数；账号保持现有读取时机。迁移不顺带重写这些数据通道。
9. 项目成员按宿主顺序，不额外过滤、不限条数；最近会话继续按其独立规则过滤和限量。不要混用两个列表的规则。
10. localStorage 键保持 `dsh.sidebar-rail.v1`，继续只保存 `pinnedWorkspaceIds` 和 `recentCount`；不持久化分区和项目展开状态。

## 3. 目标源码结构

以下是建议的最小职责边界。可按实际可读性合并小文件，不为达到文件数量或行数指标机械拆分。

```text
src/
  index.ts                       # 空 Host 入口
  client/
    index.ts                     # 导出 inject / apply，组织注册与清理
    host-adapter.ts              # 宿主服务调用、公开类型与 UI 回调适配
    preferences.ts               # 偏好读取、写入、共享快照与订阅
    locales.ts                   # 原 zh / en 字典及键类型
    styles.css                   # 原 CSS，仍由插件生命周期注入
    model/
      workspaces.ts              # 工作区、项目成员、最近会话与状态转换
      tasks-plugins.ts           # 任务及插件归一化、分组
      account.ts                 # 账号展示数据、金额与链接转换
      geometry.ts                # 显隐判据、浮层位置和分区预算
      remote.ts                  # 远程结果归一化及插件内部结果类型
    hooks/
      use-rail-visibility.ts     # 宿主折叠、视口与轨显隐相关逻辑
      use-flyout.ts              # 打开、关闭、焦点、计时器和临时状态复位
      use-remote-list.ts         # 请求状态、重开刷新及过期结果处理
    components/
      RailOverlay.tsx
      RailColumn.tsx             # 编排各浮层，不再承载所有实现细节
      RailSettings.tsx
      primitives.tsx             # 行、分区、图标、空态、错误边界等
      WorkspaceFlyout.tsx
      TasksFlyout.tsx
      PluginsFlyout.tsx
      AccountFlyout.tsx
      MoreFlyout.tsx
scripts/
  build.mjs                      # 生成两个发布入口，支持 --watch
  check.mjs                      # 源码规则与产物规则，分开执行
test/
  *.test.ts                      # 直接导入源码的逻辑与流程测试
  *.test.mjs                     # 执行生成 JS 的工厂、注册和清理测试
lib/                             # 生成目录，不手工维护、不提交 Git
  index.js
  client.js
  *.js.map                       # 如启用，明确纳入发布白名单
```

### 3.1 搬迁对应关系

| 当前区域 / 入口 | 目标职责 | 注意事项 |
| --- | --- | --- |
| `pure-helpers` / `pure-data` | `model/*`、`locales.ts` | 不依赖 React 或 DOM；常量放进真实所有者模块，不复制多份 |
| `readStore` / `writeStore` / recentCount 订阅 | `preferences.ts` | 两个设置入口共享同一实例；写入仍合并已有字段 |
| CSS 模板字符串 | `styles.css` | 按文本打包，保留样式节点标记及 `ctx.effect` 清理 |
| `Row` / `ProjectRow` / `FlyoutSection` 等 | `components/*` | 用明确的 props；纯展示组件不直接读取 `ctx` |
| `RailColumn` 的异步和计时逻辑 | `hooks/*` 与必要的可测流程函数 | 按状态所有权拆，不按代码片段长度拆 |
| `apply` 中的 `injectProps` 和远程调用 | `host-adapter.ts` | UI 获得数据和回调，不获得整个宿主 Context |
| locale / style / 两处槽注册 | `client/index.ts` | 保留 effect 所有权和正确卸载顺序 |

依赖方向：入口组织适配器与组件；组件调用自身交互逻辑及纯模型；模型不反向依赖入口或 UI。避免 `index.ts` 大量转导出造成循环，也不新建收纳所有杂项的 `utils.ts`。

## 4. 类型与构建设计

### 4.1 类型约束

- 开启 `strict` 和 `noEmit`，检查生产源码与 TypeScript 测试；`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 建议同时开启，并逐项处理由此暴露的真实问题。
- 状态用判别联合表达，例如 `idle / loading / ready / failed`；只有 ready 状态携带成功数据，失败携带可展示原因。保留各业务不同的取消和降级语义，不强行套成同一状态机。
- 宿主 props 从公开类型派生；服务输入和返回值使用目标版本的公开声明。类型导入使用 `import type`，不要把宿主实现代码打入产物。
- 可选服务和真实跨边界输入仍要检查。`unknown` 需要收窄；禁止靠大范围 `any`、`as any`、`@ts-ignore` 或虚构模块声明把错误压下去。
- 字典以中文键集合约束英文键集合及 `t()` 参数；保留现有 namespace 和文案语义。不要因拆文件丢失动态使用的键。
- 新增或改写函数附中文说明，公开函数说明参数、返回值和失败语义。日志保持 `[dsh-sidebar-rail]` 前缀，不打印账号敏感信息或会话正文。

开发 SDK 版本以实际验收的已发布宿主为准。本文引用的 Desktop 报告为 `0.2.2-rc.1`；本地 DSH 主仓库源码可能是不同版本，不能把本地编译通过当作已发布 App 兼容证据。不得借迁移自动扩大或缩窄当前 peer 范围。

### 4.2 开发依赖与执行环境

继续使用 npm，新增并提交 `package-lock.json`，CI 使用 `npm ci`。不因迁移切换包管理器或调整 Node 支持下限。

最小工具组合为 TypeScript、esbuild、tsx、匹配宿主的 React / React DOM 及其类型、Node 类型，以及确有类型导入的 DSH SDK 包，均声明为开发依赖。具体版本由实施时核实后锁定；React 仅供本地类型和测试，客户端运行时仍使用宿主实例。

本项目不新增 `dependencies` 运行时实现库。不要依赖相邻项目的 `node_modules`、个人机器的全局包或宿主仓库的私有构建脚本；构建应能在独立干净目录完成。

esbuild 只负责转换和打包；`tsc --noEmit` 单独负责类型检查。首期不接入 ESLint、Prettier、Vite 或新的 UI 库。

### 4.3 发布产物与加载协议

构建输出必须满足：

1. `lib/index.js` 为 ESM，保留空的 Host `apply` 导出。
2. `lib/client.js` 是一个静态脚本，调用一次 `window.__ModuleLoader__.load({ id, factory })`。
3. ID 从包元数据取得或经检查保证一致，值为 `@skylerfee/dsh-sidebar-rail`。
4. 注册脚本执行时不读取 React、DOM、localStorage，也不执行插件副作用；这些工作保持在工厂物化、`apply` 或对应 effect 内。
5. 工厂经传入的 `require` 取得宿主 React / React DOM；返回客户端的 `inject` 和 `apply`。不能留下浏览器无法直接运行的顶层 ESM import / export。
6. 包内部相对模块静态打入单份 `client.js`，首期不做动态 import 或拆 chunk。
7. JSX 首期使用 classic 转换生成 `React.createElement`，保持运行时只请求现有的 `react` / `react-dom`；不额外引入 `react/jsx-runtime` 请求。
8. CSS 作为文本进入产物，仍由 `apply` 的 effect 创建带 `data-dsh-sidebar-rail` 标记的 style，卸载时删除；不要改成不受插件生命周期管理的顶层样式注入。

可以用 esbuild 的 CJS 输出配合很小的工厂包装实现上述协议。包装中的 `module` / `exports` 必须是工厂局部变量。借鉴本地其他插件时，只参考协议，不整段复制它们的依赖和构建配置。

`package.json` 的目标变化：

| 字段 | 当前 | 目标 |
| --- | --- | --- |
| `exports["."]` | `./index.js` | `./lib/index.js` |
| `exports["./client"]` | `./client.js` | `./lib/client.js` |
| `files` 的入口项 | 根目录两份 JS | `lib/index.js`、`lib/client.js`，以及实际生成并需要发布的 map |
| 其他资源 | patch、locale、icon、README 引用的图片 | 继续包含并逐项验证 |
| 包名 / `dsh.bundle` / `dsh.client` | 现有声明 | 保持现有值和加载语义，尤其 `immediately` 与 `inject` |
| 版本号与 tag | `0.4.0` | 本次结构迁移不自动决定发布版本；正式发布另按项目流程 |

生成文件默认不入 Git；在 `.gitignore` 忽略 `lib/`。验证完成后移除不再使用的根目录手写入口，避免同时存在两份可修改实现。不能先删旧入口，再让未构建状态破坏仍使用本 checkout 的 profile。

Source map 使用相对源码路径，避免泄露机器绝对路径；发布清单必须与实际 map 引用一致，不留下引用存在而文件缺失的状态。

### 4.4 开发命令与安装路径

下表是需要新增或调整的脚本约定，当前仓库尚不存在这些完整入口：

| 命令 | 目标职责 |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.json` |
| `npm run build` | `node scripts/build.mjs`，生成并检查两个入口 |
| `npm run dev` | 同一构建脚本的 `--watch` 模式；退出时释放 watcher |
| `npm run test:unit` | 通过 tsx 运行 `test/*.test.ts`，直接导入源码 |
| `npm run test:artifact` | Node 执行 `test/*.test.mjs`，消费已构建的 JS |
| `npm run test` | 依次执行单元测试、构建、产物测试 |
| `npm run check:source` | 源码约束与字典检查 |
| `npm run check:artifact` | 入口、白名单、外部模块、语法和 ModuleLoader 元数据检查 |
| `npm run check` | typecheck → source 检查 → unit 测试 → build → artifact 检查 → artifact 测试 |

同一次 `check` 不重复构建或重复执行已经通过的测试；独立运行 `test:artifact` 前先 build。

- 本地 checkout：`npm ci` 后 build；开发时运行 watch。编辑 `src/` 后不再承诺“未构建即可生效”。
- npm / tgz：消费者拿到预构建的 `lib/`，不应需要安装编译器或本地构建。
- `prepack` 调用 build，保障常规打包路径；Git 源码安装如继续支持，配置 `prepare` 构建并实际验证目标 DSH 包管理器的构建脚本许可机制。脚本被禁时要给出明确的本地构建 / tgz 安装说明，不能宣称 Git 安装已通过。
- 发布工作流使用 `npm publish --ignore-scripts`，因此必须在发布命令之前显式执行 `npm ci` 和完整 check，不能依赖 `prepare`、`prepack` 或 `prepublishOnly` 在这条路径自动运行。

## 5. 测试与检查迁移

### 5.1 保留既有行为断言

将现有 57 项测试的行为清单映射到新测试文件，纯逻辑测试直接 import 对应源码。允许合理合并或拆分测试，但交付时要说明覆盖的对应关系，不能只比较测试数量。

移除 `#region` 切片和 `new Function` 提取业务函数的机制。工厂协议的 VM 测试保留，它验证的是最终 JS 能否按宿主方式执行，不是业务函数切片。

重点覆盖：项目分组与置顶、项目成员和最近会话的不同规则、任务时间与状态、插件安装/启用过滤、账号与金额转换、字典键、偏好读取以及几何边界。

### 5.2 生命周期与流程测试

用固定替身和可控时间验证本次移动的逻辑，避免真实网络和镜像实现：

- 浮层打开请求一次；切走后旧响应不写入；重开能重新取数。
- 服务缺失、结构化失败、拒绝和超时各有确定状态；清空列表不应冒充请求成功。
- 关闭、卸载及重新挂载后，timer / listener / observer 不累积。
- recentCount 在轨和设置块之间共享；旧存储可读，更新条数不覆盖置顶数据。
- 目录选择成功、取消、失败的流程可以独立复现，K1 的丢值问题不被 normalizer 的宽类型隐藏。
- 默认展开与默认收起分区的首次切换均可复现，K2 与纯读取 `sectionIsOpen` 的测试分开。

K1 / K2 的期望修复用例可作为单独运行的缺陷复现，但不得在未修复时写成通过。迁移检查结果和既有缺陷状态分别报告；不能为了保留绿色结果删除断言、放宽预期或静默跳过失败。

### 5.3 最终产物测试

现有注册测试只验证脚本登记了工厂，未调用工厂或 `apply`。迁移后至少扩展以下检查：

1. 在仅有 ModuleLoader 收集器的 VM 中执行发布客户端，恰好注册一次、ID 正确，注册阶段不需要 React 或 DOM。
2. 显式调用工厂，记录所有 require 请求；仅允许约定的宿主模块，证明 React 未被私有打包、没有 Node 模块或相对 chunk 请求。
3. 检查工厂导出的 `inject` / `apply`，用槽、locale、DOM 的小型替身执行 apply，验证两个槽注册的名字与 ID。
4. 显式执行 disposer，验证样式、locale、槽贡献及本次新增资源都能释放；重挂载不重复注册。
5. 从 npm pack 的实际 tgz 在独立目录安装，import Host 入口，并读取已安装包的 `./client` 文件重复上述注册及工厂检查。不能只检查工作区中的 lib。

不为迁移默认加入大型 DOM 测试框架。若确需组件渲染测试，先说明它能捕获哪个具体风险及为什么更小的流程测试不足。

### 5.4 调整机械规则

`scripts/check.mjs` 目前依赖根目录 `client.js`、固定引号格式、字典文本位置和 region 标记，不能直接复用于打包产物。

- 源码规则扫描 `src/` 的真实文件，继续检查 CSS 作用域、禁止接管 sidebar、禁止 `!important` 和危险 DOM 写入等约束。
- 字典检查直接使用可导入数据或 TypeScript 类型约束；不再靠截取源码字符串定位字典。
- 产物规则通过实际求值和包元数据验证 ModuleLoader ID / exports / patch / files 一致性。
- 外部依赖检查结合构建 metafile 与工厂实际 require，不能只查一条 `require('...')` 正则。
- 原 region 检查在单测全部迁移后删除，不保留空 region 来让旧检查通过。

## 6. 分阶段执行清单

每个阶段完成后记录改动和验证结果。只有需要用户决定行为变化、使用未授权 profile 或执行发布时才等待对应条件；不因完成一个内部步骤就反复申请同一迁移任务的授权。

| 阶段 | 工作 | 完成条件 |
| --- | --- | --- |
| P0 基线 | 读规则和报告；检查工作树、版本及运行中 link；必要时先建立独立 worktree；运行原 check；列出 K1–K3 | 基线证据、运行环境隔离、已有改动保护范围和测试清单可核查 |
| P1 决策与工具链 | 新增下一顺序 ADR，解释为何替代 ADR-0002；同步 AGENTS / 编码规范；声明开发依赖、锁文件和构建配置 | 旧 ADR 保留历史理由并链接新决定；新规则明确允许本次工具链，其他产品约束继续有效 |
| P2 数据与测试 | 提取纯模型、字典、偏好；既有测试改直接导入；临时保持旧入口仍能工作 | 既有行为断言完整，类型检查覆盖新模块；没有两份独立维护的业务逻辑 |
| P3 UI 与适配 | 拆组件和交互；补宿主类型；实现 ModuleLoader 包装；迁移生命周期 | 严格类型、单元和工厂/注册/清理检查通过；K1–K3 状态明确 |
| P4 入口与发布链 | 切换 exports/files；移除旧入口；更新 CI / publish、源码规则、README 和设计 | 独立干净安装、构建、tgz 消费检查通过；发布仍走原 Release/OIDC 流程 |
| P5 宿主验收与交付 | 经对应授权使用实际产物验证目标宿主；记录 B1–B15、回归和遗留问题 | 明确结构迁移、功能验收和发布准备各自状态，提供最终交接报告 |

执行细节：

- P1 的新 ADR 替代的是工具链决定，不撤销其他 ADR。不要抹掉旧决定的背景；对旧规格中“不做 TS”标明其历史适用范围，当前行为说明同步更新。
- P2 需要过渡入口时，通过构建接入同一份源码，过渡文件必须标明生成属性并在 P4 移除；不要复制纯函数让新旧实现长期并存。
- P3 逐类浮层搬迁；先完成一类的类型、测试与清理，再继续下一类，不同时重做全部交互。
- P4 切换前再次确认 P0 的隔离仍有效；若期间有 profile 改为 link 实施目录，先停止影响该运行环境的文件切换并恢复隔离。没有对应授权时，不要让用户运行中的插件切到新入口或缺失的 lib。
- 双语 README 同步更新安装、构建、watch、测试和发布说明；本迁移指南不要求另建英文副本。

可并行的部分是纯模型、UI 和构建测试，但必须先明确共享接口。入口、`host-adapter.ts`、package / 锁文件 / CI 各设单一修改者，避免多个 Agent 同时编辑。

## 7. 验收与交付

### 7.1 离线与安装验收

以下是迁移后的目标跑法，不表示当前已经执行或脚本已经存在：

```sh
npm ci
npm run check
mkdir -p tmp/output
npm pack --pack-destination tmp/output
```

随后在 `tmp/deps/` 下的独立临时消费者目录安装上述真实 tgz，完成 Host import、客户端工厂与资源清单检查。使用临时 npm 缓存时放 `tmp/` 内；只清理自己创建的文件。

还需从干净源码快照验证一次“不存在 node_modules 和 lib 时，npm ci + check + pack 能完成”。不要删除当前工作区已有目录来模拟干净环境。

| 验收项 | 通过标准 |
| --- | --- |
| 类型 | 生产与测试严格检查通过，宿主关键接口未用 any 或忽略指令绕过检查 |
| 模块 | 纯逻辑可独立导入，组件不直读整个 Context，无循环依赖或新的杂项巨型模块 |
| 构建 | 干净环境生成正确 Host / Client 产物；客户端注册阶段无浏览器副作用 |
| 外部依赖 | React 来自宿主，无宿主内部实现或 Node 模块被带进浏览器产物 |
| 包 | exports 指向包内真实文件；patch、locale、icon、README 图片及需要的 map 齐全，无 tmp、测试夹具、依赖目录或敏感数据 |
| 测试 | 原行为覆盖有映射，新增边界与产物测试通过；既有缺陷复现单列 |
| CI | 明确安装依赖和执行构建；`npm publish --ignore-scripts` 之前已完成全套检查 |

### 7.2 真机验收

有目标宿主操作授权后，使用最终 tgz 或明确已 build 的独立 checkout 验证。仅 build 成功、文件里出现某个字符串或 VM 通过都不足以替代本节。

- 对照分区规格 B1–B15，逐项记“通过 / 部分 / 失败 / 未执行”，写清宿主版本、插件提交、语言、主题和视口。
- 检查折叠显隐、767 / 768px 边界、顶部窗口控件避让、独立滚动、焦点与 Escape、置顶持久化及两个设置入口同步。
- 检查工作区会话导航、新建会话归属、目录选择、任务 / 插件分区、账号降级和请求重试。
- 检查插件停用 / 启用及允许的重载路径，无残留样式、观察器、计时器或重复槽贡献。
- 补真实 Web 的“不绘制轨”路径；Desktop 中的响应式视口模拟不能算 Web 验收，也不能替代原生窗口缩放。
- 不为测试擅自发送模型请求、切换其他插件、修改定时任务、登录退出账号或持久化测试数据；必要的可逆准备完成后恢复现场。

遇到未授权的 profile / App 操作，完成全部不依赖该操作的工作，列明已构建的可验收产物和剩余步骤。不能自行安装到用户正在使用的 profile。

### 7.3 完成状态与回退

交付报告必须分开写：

| 状态 | 含义 |
| --- | --- |
| 结构与离线迁移完成 | TS 模块、工具链、测试、产物和独立安装检查完成 |
| 用户路径验收状态 | 真机实际覆盖、K1–K3 及其他残留问题；未通过时不能写全功能验收完成 |
| 发布状态 | 是否具备发布前检查证据；未获授权不提交、推送、创建 Release 或发布 npm |

构建失败、工厂无法物化、重复 React、槽注册或清理失效时，停止将迁移产物交给用户 profile 使用。离线阶段在隔离分支修正；若已经获准安装到 profile，先记录原依赖 spec、实际解析版本和 link 目标，回退到该确切原状态并重新验证，不能猜测“上一个版本”。

不迁移 localStorage，因此回退不应删除或重置偏好。不要覆盖既有 npm 版本、tag 或 Release 资产，不用全仓库回滚命令覆盖其他任务的改动。

交付内容包括改动文件与职责、实际命令结果、旧测试映射、新测试覆盖、实际 tgz 路径、宿主验收记录、已知缺陷和未执行项，以及本次临时文件清单。任务结束后询问是否清理本次临时文件，不连带清理历史 tmp。

## 8. 给执行 Agent 的启动指令

后续可将以下文字连同明确的实施授权交给执行 Agent：

> 请在 `/Users/liufei/Projects/deepseek-harness-plugins/dsh-sidebar-rail` 按 `docs/typescript-migration.md` 实施 TypeScript 迁移。先重新核对当前规则、工作树、宿主版本与基线测试，再依 P0–P5 推进。保留其他任务的未提交改动，先解决 ADR-0002 与新工具链的规则冲突；目标是多模块 TS/TSX 源码和单份 ModuleLoader 客户端产物。不要修改 DSH 主仓库或其他插件，不要扩大功能范围。K1–K3 单独报告，不把迁移当作缺陷已修复。完成源码、离线测试、构建和独立 tgz 安装验证；需要操作用户 profile 或 App 时按已有授权范围执行。提交、推送、发布及额外环境操作必须有对应授权。最终交付按“离线迁移 / 真机功能验收 / 发布状态”分别说明。

## 9. 依据与文档维护

- 方案依据：本会话的维护性评估，以及文档创建时的当前源码和包元数据；没有做分支差异分析，也没有执行迁移。
- 技术核对参考：[TypeScript JSX](https://www.typescriptlang.org/docs/handbook/jsx.html)、[esbuild TypeScript 支持及类型检查边界](https://esbuild.github.io/content-types/#typescript)。版本选择仍以实施时目标宿主及工具要求为准。
- 57 项测试通过属于本会话迁移评估时运行旧版 `npm run check` 的结果；本次文档生成没有重复跑测试。它不证明本指南中的新结构或新脚本已通过验证。
- 目标版本、工作树或产品行为发生变化时，先更新基线及其影响，再执行后续阶段；不得用本文的历史快照覆盖新事实。
