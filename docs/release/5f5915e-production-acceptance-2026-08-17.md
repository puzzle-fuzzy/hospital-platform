# `5f5915e` 生产切换与普通资料契约发布验收（2026-08-17）

## 结论

候选 `5f5915e518e3d2de5647f7ddd90f91cd7f1e3d0c` 已完成本地门禁、服务器真实生产 env
preflight、独立临时端口 smoke，并于 2026-08-17 17:55 CST 左右原子切换为线上当前 release。
本次只重启 `hospital-platform-api-v2.service`；旧 Python `8001` 全程保持监听，Worker 仍为 inactive。

本版本包含普通资料 contract 的严格未知字段边界：`PUT /me/profile` 提交 `avatar`、`openid`
等旧字段时返回 `400 validation`，不会被 Elysia 静默清洗后返回成功。该规则已有 API 集成回归测试，
但真实资料读取、首次更新、并发 `409` 和真机页面验收仍需单独完成。

## 1. 本地门禁与候选 provenance

- API 测试：97 项通过；工作区 9 个包测试全部通过，小程序 75 项通过。
- workspace typecheck、Biome lint/format、文档链接、架构边界和 build 全部通过。
- `pnpm migration:audit` 的已知阻塞仍来自外部旧仓库医保接口台账漂移，本次没有修改旧仓库或掩盖该阻塞。
- 服务器 preflight：`environment=production`，MySQL/Redis 为 `ok`，schema 为 `verified`，目标为
  `0016_patient_directory_sync_owner_index`。

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `9f46778abdaf9ec9b6be58bd69a39e73dca9bf23824e7b9d44dc246293b5bbe0` |
| `apps/worker/dist/index.js` | `ff4fcdbb1d1b4c2247893eba1b77043b29b342ef922228d772672592297c7c04` |
| `apps/worker/dist/preflight.js` | `f336c5b88606c11a9946e574b3d16555f60094ae523c95131ec6a2a1f006689a` |
| `apps/worker/dist/provider-directory-smoke.js` | `635bc31b1732a52bd6399c5b19d1256679004505d6ef9d60d7b319b7e6255d90` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |

服务器 release 五个文件的 SHA-256 与本地产物一致，`shared/api.env` 权限为 `0600`。

## 2. 候选隔离 smoke

候选在 `127.0.0.1:18082` 以 production mode 启动，未接收公网流量：

- live：200；
- ready：连续 3/3 为 200，MySQL/Redis/schema 均为 `ok`；
- system ping：200；
- 未登录受保护路由：401 / `unauthorized`；
- smoke 结束后候选进程已停止，临时端口已释放。

## 3. 原子切换与公网验收

| 检查项 | 结果 |
| --- | --- |
| 切换前 release | `0b6f38f6e50e8c9d47422c9f0ffc44dc9ecbc185` |
| 切换后 release | `5f5915e518e3d2de5647f7ddd90f91cd7f1e3d0c` |
| 新 API | `10.0.0.3:18081`，systemd `active` |
| 旧 Python API | `0.0.0.0:8001` 仍监听 |
| 内网 ready | 200，database/redis/schema 均为 `ok` |
| 公网 ready | 200，database/redis/schema 均为 `ok` |
| 公网 runtime smoke | live 200、ready 连续 6/6、system ping 200、认证边界 401 |

公网 smoke 使用 `/api/v2`，检查了 `Cache-Control: no-store` 和受保护路由认证边界；没有调用微信、
患者、预约、费用 Provider，也没有执行 migration、支付、医保或 HIS 写入。

切换后的 journald 启动事件确认：

- `environment=production`、`runtimeMode=production`；
- MySQL、Redis、schema probe 均为 `ok`；
- `persistenceRepositories=enabled`；
- 微信身份、患者目录、预约目录、预约历史和门诊费用为 `configured`；
- 微信支付、报告目录和报告详情为 `disabled`。

## 4. 业务验收边界与下一步

切换前旧版本曾有真实微信/患者请求；这些日志不能回填为 `5f5915e` 的业务证据。切换后当前 release
只完成了运行边界 smoke，尚未取得普通资料的真实会话证据。

下一步使用受控真机账号完成：

1. 微信会话恢复和 `GET /me/profile` 默认值；
2. 资料编辑首次更新、再次读取和页面刷新；
3. 两个并发版本更新的 `409 user-profile-conflict`；
4. 更换就诊人后确认“我的”与“我的挂号”仍使用独立患者上下文；
5. 对照 journald 的 `user.profile.*`、`http.request.*`、`traceId`，不记录身份凭证或资料正文。

支付、医保、退款、预约写入、HIS 回写和报告 gate 继续关闭。若新 API 出现无法解释的运行或业务异常，
只回滚 `current` 到 `0b6f38f` 并重启新 API，不能停止旧 Python 服务、清空 Redis 或回滚数据库。
