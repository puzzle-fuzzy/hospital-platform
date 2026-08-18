# `38bc553` 本地候选构建记录（2026-08-18）

本文记录微信身份边界修复后的本地构建产物和验证范围。它不是生产发布验收：本候选尚未上传服务器、尚未切换 `current`，也没有重启任何服务。

## 1. 候选身份

| 项目 | 值 |
| --- | --- |
| Git 提交 | `38bc553`（`收紧微信身份交换边界`） |
| 完整来源提交 | `38bc553395f07c017446ee2539677431c6835f13` |
| 当前线上 release | `c63dba9`，本次未改变 |
| 旧 Python 服务 | 继续使用 `8001`，本次未操作 |
| 小程序页面数 | 14 |
| 小程序构建时间 | `2026-08-18T04:59:23.635Z`（见 `apps/miniprogram/dist/build-info.json`） |

本次服务端修改只收紧微信 `code2session` 返回的 `openid/unionid` 边界：非字符串、去除首尾空白后为空、含控制字符或超过 128 个 Unicode 字符时整次身份交换失败；不会改变 API 响应结构、数据库 schema、旧服务或线上环境变量。

## 2. 本地验证

| 检查 | 结果 |
| --- | --- |
| `pnpm build` | 9/9 package 成功；生成 API、Worker、维护脚本和小程序 `dist/` |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过；14 个页面脚本和根文件齐全 |
| 小程序测试 | 108 项通过，952 个断言 |
| 适配器测试 | 75 项通过，168 个断言 |
| 全量 API 测试 | 114 项通过，528 个断言 |
| 全仓类型检查 | 9/9 package 成功 |
| 工具门禁 | 10 项通过，38 个断言 |
| 文档链接审计 | 139 份文档，无断链 |

## 3. 产物 SHA-256

以下摘要来自本地 `pnpm build`，上传到服务器后必须逐文件复核；服务器不能在 release 目录重新安装 workspace 依赖或重新构建来替代 checksum。

```text
apps/api/dist/index.js 6439602bb8ef0b4e5dcf22392d3d16bc242378ae7ddf93e605ea860a88d562af
apps/worker/dist/index.js 3e1c39ca8f09570ea2e0f85c848a8c8b6169f07132b4f49204a806cb80badef9
apps/worker/dist/preflight.js a2fc8cdb460671f19e7a8a75167ace220bac4ba5c458f9266b518fab7a389284
apps/worker/dist/provider-directory-smoke.js 3ac16889bc3d106e9ea259d680bff980c0884ed04c7cd3b192ff93e90fd86d6d
apps/worker/dist/api-runtime-smoke.js 1246914eece1aceaee8d644d7199ff0ee825c5be05ffa5f4f2bc4a42e8bb21f3
apps/worker/dist/p0-log-aggregate.js 5da0f845226891901d5a4c4fb5b6fa8f9e9be3522fa272830175e44cb91b7cb1
apps/worker/dist/p0-business-evidence-audit.js ae82730903e392b061b5cd08a86c09cadedeb3b01a3b25342fcaa925912d5907
apps/worker/dist/redis-session-ttl-audit.js 3f8190fb7acc75a41fb2be12181ad9eb99cafc2302f7044a157452228d4fcd70
```

## 4. 服务器候选上传与隔离验证

2026-08-18 13:03 CST，使用用户此前授权的交互式 SSH 方式，将 8 个 bundle 上传到：
`/home/ps/code/hospital-platform/releases/38bc553`。本机没有可用 SSH 公钥，BatchMode 仍返回
`Permission denied (publickey,password)`；本次没有修改 SSH、sudoers、旧服务或服务器环境变量。

候选上传后使用服务器既有 `shared/api.env` 执行 production preflight，结果为通过：

- `environment=production`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用为 `configured`；微信支付、报告目录和报告详情继续为 `disabled`；
- MySQL、Redis、schema 均为 `ok`，schema 为 `0016_patient_directory_sync_owner_index`。

2026-08-18 13:05 CST，在 `127.0.0.1:18082` 启动候选 API 做隔离 runtime smoke，结果为通过：

- live `200`；
- readiness 连续 3 次 `200`；
- system-ping `200`；
- 所有未登录保护路由均返回 `401 unauthorized`；
- 临时进程收到 `SIGTERM` 正常退出，`18082` 端口已释放。

隔离 smoke 前后 `current` 始终为 `/home/ps/code/hospital-platform/releases/c63dba9`，新 API `18081`、旧 Python
`8001` 同时监听，公网/内网 readiness 未受影响。8 个远端 bundle 文件均存在，且 SHA-256 与本节前的本地记录一致。

## 5. 尚未执行的发布动作

- 尚未把 `current` 切换到 `38bc553`，也没有重启 `hospital-platform-api-v2.service`；线上继续运行 `c63dba9`。
- 尚未进行有效微信会话下的真机登录、患者切换、预约历史/爽约、门诊费用或普通资料读写验收。
- Redis TTL 仍未通过独立维护 ACL 验证；支付、医保、退款、报告和 HIS 继续关闭。

下一次发布必须同时保存候选目录、产物 checksum、production preflight、隔离 runtime smoke、旧 `8001` 监听和公网 ready 证据，具体命令以 [`api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md) 为准。
