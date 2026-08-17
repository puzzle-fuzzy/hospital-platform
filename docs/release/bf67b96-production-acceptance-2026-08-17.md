# `bf67b96` 生产切换与日志聚合 artifact 验收（2026-08-17）

## 结论

候选 `bf67b9673708a6e5188880eba9a6d29b8e78f0c5` 已完成本地构建、真实生产 env preflight、
`127.0.0.1:18082` 隔离 runtime smoke，并在 2026-08-17 20:30 CST 前后原子切换为线上当前 release。
本次只重启 `hospital-platform-api-v2.service`；旧 Python `8001` 保持监听，Worker 仍为 `inactive`。

本版本没有打开预约写入、支付、医保、退款、报告详情或 HIS 回写；主要变化是将安全的
`p0-log-aggregate.js` 纳入 worker release，供受控 journald JSONL 聚合使用。

## 1. 六个 artifact provenance

本地构建和上传后的 SHA-256 一致：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `69e78e99b20cc52a0336610e71160e0c17e472e9f7ceb8e018fc6b5b0ba789c1` |
| `apps/worker/dist/index.js` | `cab4952787ad8eae51ff86b57f0e42b6e5cd7fffe626eb1f80475b2c4872b3cb` |
| `apps/worker/dist/preflight.js` | `896522efc1b11ddab11908814e86c86097b852f9ff69ec6d3e35cb1206b83078` |
| `apps/worker/dist/provider-directory-smoke.js` | `635bc31b1732a52bd6399c5b19d1256679004505d6ef9d60d7b319b7e6255d90` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |
| `apps/worker/dist/p0-log-aggregate.js` | `23b062c44396847a03fe9733755fc20fabf81ba0b8ddcf7805f65d813689f0f9` |

`p0-log-aggregate.js` 不读取数据库、Redis 或 Provider，只消费 stdin 的 journald JSONL；聚合结果不包含
原始 `msg`、URL、请求体、token、openid、患者标识、金额或 Provider 原文。

## 2. 候选 preflight 与隔离 smoke

2026-08-17 20:29 CST，使用服务器 `shared/api.env` 执行候选 preflight：

- runtime configuration：passed；
- Provider 配置：微信身份、患者目录、预约目录、预约历史和门诊费用 `configured`；微信支付、报告目录和报告详情 `disabled`；
- MySQL、Redis：`ok`；
- schema：`verified`，目标 `0016_patient_directory_sync_owner_index`。

随后候选以 production mode 监听 `127.0.0.1:18082`，旧 `current`、线上 `18081` 和旧 Python `8001` 全程保持运行。
runtime smoke 通过：live 200、ready 连续 3/3、system-ping 200、未登录认证边界 401；候选进程已通过 SIGTERM 回收，
`18082` 未残留。

## 3. 切换后共存与公网证据

| 检查项 | 结果 |
| --- | --- |
| 当前 release | `/home/ps/code/hospital-platform/releases/bf67b9673708a6e5188880eba9a6d29b8e78f0c5` |
| 新 API | `10.0.0.3:18081`，systemd `active` |
| 旧 Python API | `0.0.0.0:8001`，仍监听 |
| Worker | `inactive`，未启动 |
| 候选端口 | `18082`，未监听 |
| 内网 ready | 200，database/Redis/schema 均为 `ok` |
| 公网 runtime smoke | production mode，live 200、ready 连续 6/6、system-ping 200、认证边界 401 |
| 公网缓存头 | live/ready 返回 `Cache-Control: no-store` |

公网 smoke 没有调用微信登录、患者同步、预约、费用 Provider，也没有执行 migration、支付、医保或 HIS 写入。

## 4. 当前 release 日志聚合验证

切换后从 `service.started` 起的受控 journald 窗口使用当前 release 内的
`apps/worker/dist/p0-log-aggregate.js` 聚合：

- `parseErrors=0`；
- `inputLines=41`、`parsedRecords=35`；
- `service.started=1`、`service.stopped=1`；
- HTTP 200 为 20 次、401 为 12 次；
- `traceIdCount=32`；
- 没有 Provider request id，符合本次只做运行时 smoke、未调用真实业务 Provider 的范围。

最近 500 条日志的更宽窗口也成功聚合为 `parseErrors=0`，但包含切换前历史事件，不能用来回填当前 release 的真实业务验收。
一次手工构造的 stdin 行因 SSH 命令引号转义产生 `parseErrors=1`；该行不是 journald，也没有业务请求，不能与真实日志聚合结果混淆。

## 5. 当前业务边界

当前 release 只证明发布、共存、运行时和日志 artifact 正确。微信会话、患者目录/多患者切换、普通资料读写/409、预约历史、
门诊费用、Redis TTL 和真机页面仍需在本次 `service.started` 之后分别取得页面、HTTP 和 journald 三层证据；不能沿用旧
`5f5915e` 日志。支付、医保、退款、预约写入、报告详情和 HIS 继续关闭。
