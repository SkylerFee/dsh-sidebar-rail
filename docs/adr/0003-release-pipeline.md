# 0003 发布走 GitHub Release → OIDC trusted publishing

- 状态：已采纳（2026-11-04）；**首发 0.1.0 已人工执行**（经 npm staged publishing 批准上线），Trusted Publisher 待配置，Release 自动发布从下一个版本开始
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

## 不要做什么

不要在 CI 里加 `NPM_TOKEN` secret 走传统 token 发布；也不要跳过 tag 校验「先发出去再说」——那正好是这套链路要防的事。
