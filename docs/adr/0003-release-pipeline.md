# 0003 发布走 GitHub Release → OIDC trusted publishing

- 状态：已采纳（2026-11-04，**尚未执行首发**）
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

## 不要做什么

不要在 CI 里加 `NPM_TOKEN` secret 走传统 token 发布；也不要跳过 tag 校验「先发出去再说」——那正好是这套链路要防的事。
