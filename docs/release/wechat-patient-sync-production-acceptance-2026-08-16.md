# 微信登录与患者同步生产验收证据（2026-08-16）

## 1. 证据范围

- 观测窗口：2026-08-16 23:08:45-23:50:18（Asia/Shanghai）。
- 日志来源：服务器 `hospital-platform-api-v2.service` journald，只读查询。
- 23:08-23:18 的微信/患者记录来自当时的 `a11f117`；本文收尾时当前服务已切换为
  `/home/ps/code/hospital-platform/current -> releases/41c9c18`，新 API `18081`；旧 Python `8001` 仍在监听。
- 本文只记录服务端链路事实，不记录微信 code、openid、unionid、session_key、accessToken、完整患者身份或内部用户 ID。
- 本次没有执行预约写入、支付、医保、退款或 HIS 回写。

## 2. 真实链路结果

| 时间 | 证据 | request/trace | 结果 |
| --- | --- | --- | --- |
| 23:08:55 | `auth.wechat.login.requested` → `auth.wechat.login.failed` → `POST /api/v1/auth/wechat` | `mp-msvxx1a5-zl6cojj1` | `503`，`PersistenceUnavailableError`；本次登录失败 |
| 23:09:08 | `auth.wechat.login.requested` → `auth.wechat.login.succeeded` → `POST /api/v1/auth/wechat` | `mp-msvxxblt-hhmsif2k` | `200`，`expiresInSeconds=3600`；微信身份兑换和平台会话签发成功 |
| 23:09:09 | `GET /api/v1/patients` | `mp-msvxxc2k-s6ix2a2b` | `200`；已认证账号读取患者目录 |
| 23:09:11 | `patient.directory.requested` → `operation.started` → `patient.directory.synced` → `POST /api/v1/patients/sync` | `mp-msvxxcah-y7tb1ijm` | `200`；`patientCount=1`、`activePatientCount=1`、`deactivatedPatientCount=0`、`hisPatientReferenceCount=1` |
| 23:17:37 | `GET /api/v1/me` | `mp-msvy883y-ra5mepdb` | `200`；平台会话恢复成功 |
| 23:17:38 | `GET /api/v1/patients` | `mp-msvy88mh-45vc1fc4` | `200`；患者目录读取成功 |
| 23:17:39 | `patient.directory.synced` → `POST /api/v1/patients/sync` | `mp-msvy88z4-526tib86` | `200`；重复同步再次完成，`patientCount=1`、`activePatientCount=1`、`deactivatedPatientCount=0`、`hisPatientReferenceCount=1` |
| 23:37:56 | 微信开发者工具打开预约目录；`GET /api/v1/appointments/departments` | `mp-msvyycw2-r2ppzbj2` | `200`；真实 Provider 返回 `itemCount=62` 个科室 |
| 23:37:57 | `GET /api/v1/appointments/schedules` | `mp-msvyydjq-vhcw6qix` | `200`；真实 Provider 返回 `itemCount=1` 条排班；同一请求的快照落库记录 `PersistenceUnavailableError`，只读结果仍保留 |
| 23:50:17 | `GET /api/v1/appointments/departments`（`41c9c18`） | `mp-msvze8ay-tnz3iq7a` | `200`；真实 Provider 返回 `itemCount=62` 个科室 |
| 23:50:18 | `GET /api/v1/appointments/schedules`（`41c9c18`） | `mp-msvze940-mk7gku8f` | `200`；真实 Provider 返回 `itemCount=1` 条排班，快照 `snapshotPersistenceStatus=persisted` |

## 3. 已验证结论

本次可以正式标记为“服务端真实微信登录和患者目录同步部分验收通过”：

1. 失败登录不会被伪造为成功；持久化不可用时返回 503 并记录失败事件；
2. 依赖恢复后，真实微信 code 成功兑换并签发平台会话；
3. 会话可以通过 `/me` 恢复；
4. 患者目录读取经过 Bearer 会话；
5. 完整同步创建/恢复了 1 条 active 患者记录，并得到 1 条 `his-patient` 映射；
6. 预约科室和排班已经取得真实 Provider 只读结果；当前实现明确区分 Provider 读取成功与排班快照是否可用；
7. `41c9c18` 切换后，预约只读和排班快照持久化均取得真实成功证据；
8. 新 API 与旧 Python 服务继续共存，日志显示新 API 使用 production mode 和 `41c9c18` release。

23:37:57（上一版 `a11f117`）的 `appointment.schedule_snapshots.failed` 不等于 Provider 目录失败：当时 Provider
返回有效排班，HTTP 仍为 200，但短期快照没有落库，所以那一次结果只能用于只读展示，不能作为未来锁号或预约
写入的前置事实。切换到 `41c9c18` 后，同一只读链路已记录 `snapshotPersistenceStatus=persisted`；日志字段用于
明确区分“Provider 读取成功”和“快照可作为后续写入前置事实”这两条业务事实。

## 4. 仍未完成的验收

- Redis 中对应会话的实际 TTL 直接证据仍未保存；`expiresInSeconds=3600` 是 API 响应/日志字段，不等于 Redis `TTL` 命令证据；
- 当前账号只有 1 条患者目录记录，尚未验证多就诊人切换、失效后必须显式重选和跨页面上下文隔离；
- 预约科室和排班已有真实 Provider 结果；`41c9c18` 已确认排班快照持久化成功。预约历史、报告和门诊费用仍未取得真实 Provider 结果；
- 尚未完成真机页面网络列表与服务端 trace 的完整对齐；
- 普通个人资料首次读取、更新和 409 冲突仍未做真实账号验收；
- 预约写入、支付、医保、退款和 HIS 回写继续保持关闭。

## 5. 下一步

1. 在不打印 token 的前提下补做 Redis TTL 受控读取或等价安全探针；
2. 继续观察 MySQL/快照持久化的连续稳定性，并补充 Redis 会话 TTL 的安全证据；
3. 获取/准备第二条可验证的就诊人目录样例后，验收患者选择页切换与 owner-scoped 业务查询；
4. 按预约历史 → 门诊费用 → 报告的顺序进行剩余只读 Provider 验收；
5. 新 Provider 文档到达后，先登记来源、版本、hash、环境、错误样例和状态机，再更新公共 contract；
6. 以上只读证据全部通过后，才讨论预约写入；支付、医保、退款和 HIS 仍按最后阶段处理。
