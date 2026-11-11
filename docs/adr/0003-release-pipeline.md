# 0003 发布走 GitHub Release → OIDC trusted publishing

- 状态：已采纳（2026-11-04）；Trusted Publisher 已在后续版本验证生效。2026-11-11 的发布隔离、环境约束及仓库保护规则由 [ADR-0008](0008-github-release-security.md) 补充，以下首发记录保留历史事实。
- 相关：`.github/workflows/publish.yml`、`package.json` `publishConfig`

## 背景

包要发到 npm（`@skylerfee/dsh-sidebar-rail`），且希望发布动作与「哪次提交、哪个版本」严格对应，避免手工 `npm publish` 把未合并的本地状态发出去。同时不希望在本仓库或组织里长期保存 `NPM_TOKEN`。

## 决定

- 发布由 GitHub Release 触发：创建 `v<version>` 的 release 才会跑发布流程。
- 工作流先校验三件事：tag 等于 `v<package.json version>`、被发布的提交是 `origin/main` 的祖先、`npm run check` 通过；再按版本推导 dist-tag（预发布取第一段，如 `alpha`；否则 `latest`）。
- npm 认证用 **OIDC trusted publishing**（`id-token: write`），不存 token。
- `publishConfig` 固定 `access: public` + `registry: https://registry.npmjs.org`。

## 后果

- 版本号与 tag 不一致、或从非 main 提交发布，CI 会直接失败，发布路径只有一条。
- **首发必须人工执行一次 `npm publish`**：npm 只能为「已存在的包」绑定 Trusted Publisher；绑定后 Release 触发才生效。
- 本机 npm 凭据过期（`npm whoami` 401）时发布会失败，需要先 `npm login`。

## 首发实录（2026-11-04）

- 本机 npm CLI 为 11.12.1，`npm publish` 触发 `EOTP`（账号开启 2FA，非交互环境无法完成浏览器授权）。
- 随后由维护者在 npm 侧以 **staged publishing** 方式提交，registry 先出现占位版 `0.0.0-stage`（描述为 "Temporary package placeholder for staged publishing"，内容仅 README + package.json）；批准后 `0.1.0` 上线，`dist-tags.latest` 指向 `0.1.0`。
- 发布内容校验：`dist.shasum = 35db0dc628f759417886ff5fd494a0a639a72bb2`，与本地构建的 tarball 一致；解包后 10 个文件与仓库源码逐字节相同。
- git tag `v0.1.0`（附注 tag）已推送；**未创建 GitHub Release**，避免 `publish.yml` 在「版本已存在」处失败。

Trusted Publisher 已由维护者配置，并用一次受控重发验证过：对已有 `v0.1.0` 建 Release 触发 `publish.yml`，tag 校验、main 祖先校验、`npm run check`、dist-tag 推导全部通过，最后 `npm publish` 返回

```
npm error You cannot publish over the previously published versions: 0.1.0.
```

该错误只在**认证成功之后**由 npm 的版本护栏抛出，因此可判定 OIDC 认证链路已生效；验证用的 Release 与那次失败运行均已删除，tag 保留。`0.2.0` 起可直接走 Release → OIDC 发布，无需 2FA 与 token。

## 0.2.0 首发踩到的权限坑（2026-11-04）

`v0.2.0` Release 第一次触发时，前置步骤全过、OIDC 认证也成功（provenance 已签名并写入 transparency log），但发布被拒：

```
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/@skylerfee%2fdsh-sidebar-rail
npm error 403 OIDC permission denied for this action
```

根因是 Trusted Publisher 的 **Allowed actions** 字段：npm 文档写明 **`npm stage publish` 总是允许**，而**直接 `npm publish` 与 `npm dist-tag` 需要显式勾选**。首配时只保留了默认，所以 stage 能过、直发被拒。

两处需要注意：

1. 该错误出现在 **OIDC token 已经换到之后**，所以 `id-token: write`、工作流文件名、tag 校验这些都没问题——不要往这些方向排查。
2. **现有 trusted publisher 连接不可编辑**，改权限只能删掉重建（文档原文：*"Existing trusted publisher connections cannot be changed. To change them, delete the connection and create a new one."*）。删重建后重跑失败的工作流即可，不必重建 tag 或 Release。

打开 `npm publish` 权限后重跑，`0.2.0` 一次通过（1m54s），产物带 provenance 签名与 attestations。

## 不要做什么

不要在 CI 里加 `NPM_TOKEN` secret 走传统 token 发布；也不要跳过 tag 校验「先发出去再说」——那正好是这套链路要防的事。
