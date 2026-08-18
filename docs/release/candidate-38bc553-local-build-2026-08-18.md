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

## 4. 尚未执行的发布动作

- 当前本机 SSH 公钥不能登录目标服务器，返回 `Permission denied (publickey,password)`；没有修改 SSH、sudoers、旧服务或服务器环境。
- 因此尚未执行服务器 release 上传、真实生产 env preflight、临时端口 smoke 或 `current` 切换。
- 即使后续上传并通过 preflight，也只能先保留 `c63dba9` 在线，完成新候选隔离 smoke 后再决定是否切换；旧 Python `8001` 不得停止。
- 真实微信登录、患者切换、预约历史/爽约、门诊费用和 Redis TTL 仍需按当前只读验收文档取得独立证据；支付、医保、退款和 HIS 继续关闭。

下一次发布必须同时保存候选目录、产物 checksum、production preflight、隔离 runtime smoke、旧 `8001` 监听和公网 ready 证据，具体命令以 [`api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md) 为准。
