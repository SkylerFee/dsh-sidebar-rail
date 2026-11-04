# 编码规范（判断类）

本文件给 **review agent** 读，不塞进实现 agent 的上下文。凡是能确定性检查的规则都已经在 `scripts/check.mjs` 里（`npm run check` 一次跑全），不要在这里重复描述。

判断标准：**如果一个规则能用正则/脚本判定，它就应该在脚本里，不在本文件。**

## 1. 什么时候必须更新 `docs/verify.md`

任何改变用户可见行为的改动（渲染、交互、样式、加载方式），都要在 `docs/verify.md` 追加一轮记录，且必须写清四件事：

1. 环境（宿主版本、平台、主题、语言）
2. 操作（怎么复现到那个状态，包括合成输入的命令）
3. 结果（**可核对的量**：像素测量、对比度数值、槽占用者、截图结论）
4. 未验证项（明确写出来，不许用「已验证」概括没做的事）

只改文档或纯逻辑函数时不需要追加验收轮次，但纯逻辑改动必须在 `test/data.test.mjs` 有对应用例。

## 2. 测试该写到哪一层

- **纯函数必须单测**：写在 `client.js` 的 `#region pure-helpers` / `#region pure-data` 区内，由 `test/data.test.mjs` 切片执行。改这些函数必须同时改测试。
- **渲染与样式不进单测**：这个仓库没有 jsdom，也不需要——组件行为靠真机验收（`docs/verify.md`）确认。
- **不要为了「覆盖率」把 React 组件塞进纯函数区**：切片区里的代码不允许 import React 或访问 DOM。

## 3. 异步与失败处理

- 每个异步取数都要有 **loading / ready / failed** 三个确定状态，页面必须能区分它们。
- **禁止静默 catch**：`catch(() => {})` 只能出现在「已经在上层处理并有可见结果」的地方，且要写明为什么。
- **可选的 Host 调用必须有超时**（参见 `REMOTE_TIMEOUT_MS`）：服务不存在、未授权、或不返回，都必须落到失败态，不能永远停在「加载中」。
- 组件卸载后不得再写入状态（用 `live` 标志/清理函数）。

## 4. 依赖与构建禁区

- **不得新增运行时依赖**：`client.js` 只能 `require('react')` 与 `require('react-dom')`，其他宿主能力一律通过注入或标准 props 获取。
- **不得新增 devDependency 来「顺手接入」工具链**（ESLint/Prettier/打包器）——这会打破[零依赖、无构建](docs/adr/0002-zero-dependency-no-build.md)的取舍。需要新规则就往 `scripts/check.mjs` 里加。
- **不得引入构建步骤**：`client.js` 必须是宿主可以直接加载的成品静态模块。

## 5. 提交粒度与证据

- 一个提交只做一件事；跨文件的大改（如重构）单独成提交。
- 提交信息用 conventional commits（`.githooks/commit-msg` 会拦），**body 写清验证方式与未验证项**——尤其是有真机验证的改动，要写测量结果，不要只写「verified」。
- 破坏性改动加 `!` 并在 body 说明影响范围（当前包未发布，`!` 用于记录语义变化）。

## 6. 注释、日志与命名

- 每个函数前有中文 JSDoc：用途 + 非显然的行为/参数含义；公开函数补返回值与失败语义。
- **关键判定入口与结果要打日志**，用 `[dsh-sidebar-rail]` 前缀；日志不得包含会话正文、凭据或完整用户数据。
- CSS 类一律 `.dsr-*` 前缀；`localStorage` 只用 `dsh.sidebar-rail.v1`；样式节点带 `data-dsh-sidebar-rail` 标记。
- 文案走 `client.js` 内的 `zh`/`en` 字典（脚本会校验两侧对齐），**不要在 JSX 里硬编码中英文**。

## 相关文档

- 硬约束与导航：[AGENTS.md](AGENTS.md)
- 架构与实现细节：[docs/design.md](docs/design.md)
- 不可逆决定：[docs/adr/](docs/adr/)
- 术语表：[GLOSSARY.md](GLOSSARY.md)
