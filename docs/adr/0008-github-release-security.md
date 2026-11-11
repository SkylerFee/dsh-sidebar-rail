# 0008 GitHub 保护规则与隔离的 npm 发布

- 状态：已采纳（2026-11-11）。
- 补充 [ADR-0003](0003-release-pipeline.md)：保留 Release → npm OIDC，发布任务改为独立 runner，并在 GitHub 和 npm 两端绑定受保护环境。

## 背景

原配置虽然有 CI 和 `main` 祖先检查，GitHub 并没有强制 PR、状态检查或标签保护。Release 事件会使用发布标签里的工作流，因此写在工作流自身的祖先检查不能独立约束有权修改工作流的身份。安装依赖、构建和发布还共用一个从开头就能申请 OIDC 身份的 job。

## 决定

1. `main` 必须经过 PR，GitHub Actions 的 `check` 必须成功，分支必须为最新，审查讨论必须解决；禁止删除与强推，无常规绕过身份。目前只有一个维护者，批准 review 数为 0，避免作者无法审核自己导致无法合并；PR 和 CI 仍为强制要求。
2. `v*` 标签仅管理员可以创建，创建后的更新和删除由另一份无绕过规则禁止。新 Release 开启不可变保护；历史 Release 不会因此自动变为不可变。
3. Actions 仅允许 checkout、setup-node、upload-artifact、download-artifact 与 CodeQL，工作流引用固定到完整提交 SHA。Dependabot 每周为 Actions 与 npm 开更新 PR，漏洞告警和安全更新在仓库设置启用。
4. `publish.yml` 的构建任务只有 `contents: read`：核对标签、包版本、GitHub 预发布标志及 `main` 祖先，执行完整检查，打包并检查文件白名单、普通文件类型及必要入口，上传唯一 tarball 与 SHA-256。
5. 最终发布任务使用干净 runner，绑定 `npm-publish` 环境，审批后才启动并取得 `id-token: write`。不 checkout，不安装项目依赖，不执行仓库或包内脚本。只下载本次运行的制品、核对哈希与包身份、检查 registry，然后发布该 tarball。
6. `npm-publish` 仅允许 `v*` 标签部署，审批人为 `SkylerFee`。单人维护允许发起者审批，这是人工确认步骤，不代表独立双人审批。npm Trusted Publisher 必须同时绑定 `SkylerFee/dsh-sidebar-rail`、`publish.yml` 与 **`npm-publish`**；仅 GitHub job 写环境名不足以收紧 npm 接受的身份。
7. 所有发布串行，不取消已经进行中的发布；最终稳定版本必须高于 registry 当前 `latest`，重复版本拒绝发布。GitHub 的 prerelease 标志必须与 SemVer 一致，预发布不能落到 `latest`。

## npm 配置迁移

在包的 Settings → Trusted publishing 中核实原有连接，然后将允许发布的连接收紧为：

| 字段 | 值 |
| --- | --- |
| 用户或组织 | `SkylerFee` |
| 仓库 | `dsh-sidebar-rail` |
| 工作流文件名 | `publish.yml` |
| Environment | `npm-publish` |
| Allowed actions | 允许 `npm publish`；不需要额外的 `npm dist-tag` 写权限 |

npm 不支持原地修改既有连接的固定身份字段，需要创建受环境约束的连接并撤销旧的无环境约束连接。确认旧连接已撤销后，绕过环境的同名工作流才会被 npm 拒绝。不能用长期 `NPM_TOKEN` 代替此迁移。无需为本次配置变更发布新版本；下一次正常 Release 再验证真实 OIDC 发布。

## 验证与边界

发布策略测试直接执行最终工作流的真实校验代码，覆盖非法版本/通道、预发布标志不一致、制品身份不符、重复版本、版本回退、registry 故障及含链接的 tarball。完整 `npm run check`、工作流语法检查、真实 tarball 检查和 GitHub PR 检查分别记录；本地检查不等于真实 OIDC 发布已经成功。

这套规则约束误操作、普通写权限及构建环境的凭据暴露；仓库所有者仍拥有修改管理策略的权限。新维护者加入后再增加独立 review、禁止自审与多人发布审批，不能把当前单人审批描述为双人审核。

## 恢复

工作流失败时保留标签与日志，通过 PR 修复，不移动已发布标签或重用旧版本。发布上传成功而索引尚未可见时先查 registry，不直接重跑上传。若需要恢复策略，用 GitHub 设置快照逐项评估；不通过关闭规则、放开 Actions 来源或新增长期 token 绕过失败。
