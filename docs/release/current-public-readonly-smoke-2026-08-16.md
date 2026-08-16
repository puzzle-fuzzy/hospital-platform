# 当前公网只读边界观察（2026-08-16）

## 1. 观察范围

- 观察时间：2026-08-16 23:19-23:20（Asia/Shanghai）。
- 入口：`https://test-hp.meiyi.pro/api/v2`。
- 目的：确认当前公网转发、健康依赖状态、未登录鉴权和已冻结迁移路由的边界。
- 方法：只读 HTTP 请求；没有提交微信 code、患者同步幂等键、支付订单、医保授权或任何 HIS 写入。
- 说明：本文件是当前公网观察快照，不证明当前公网进程对应仓库 `main` 最新提交，也不替代微信、众阳、真机或支付验收。

## 2. 结果

| 请求 | requestId | HTTP | 结果 | 结论 |
| --- | --- | ---: | --- | --- |
| `GET /api/v2/health/live` | `audit-1efe37c2c00e4a84b17d60cdcf6a89f6` | 200 | `status=ok`，`Cache-Control: no-store` | API 进程可响应 |
| `GET /api/v2/health/ready` | `audit-e310fb3d310b458c94765320fa24f881` | 200 | `database=ok`、`redis=ok`、`schema=ok` | 当前依赖探针就绪 |
| `GET /api/v2/system/ping` | `audit-d76f9ac8c88c477aaaca6beb155d6f6` | 200 | `service=hospital-api`、`apiVersion=0.1.0` | 新 API 公网路径可达 |
| `GET /api/v2/medical-records` | `audit-de44d5a0748047239df6233b79770999` | 404 | `not-found` | 病历路由仍按 contract 未到位保持关闭 |
| `GET /api/v2/patients` | `audit-f62708a2390e478c8beebe072df4c1cc` | 401 | `unauthorized` | 未登录不能读取患者目录 |

## 3. 业务结论

这次观察可以确认：

1. 公网 `/api/v2` 到新 API 的版本化转发仍然存在；
2. 当前响应保留 no-store 健康检查策略，数据库、Redis 和 schema 探针当前返回就绪；
3. 患者目录没有因为公网可达而绕过 Bearer 会话；
4. 门诊病历没有因为旧服务存在对应能力而被误开放。

这次观察不能确认：

- 微信 `wx.login()` code 是否已经被微信 provider 成功兑换；
- 当前微信账号是否能在 MySQL 中幂等映射并在 Redis 中建立 TTL 会话；
- 患者目录、`his-patient` 映射、预约历史、报告和门诊费用是否对真实账号可用；
- 当前公网进程是否已经部署仓库最新提交；
- 任何预约写入、支付、医保、退款或 HIS 回写结果。

## 4. 下一步证据顺序

1. 通过服务器 journald 以 requestId 对齐一次真实微信登录的
   `auth.wechat.login.requested`、`auth.wechat.login.succeeded/failed` 和 HTTP 结果；
2. 在同一账号上验证 `/me`、患者同步、患者切换和 Redis TTL，不打印 code、openid、session_key、token 或患者敏感字段；
3. 依次做预约目录/历史、报告目录、门诊费用只读验收；每个领域分别记录 provider 请求、错误语义和真机页面结果；
4. 收到新的 Provider 文档后，先更新 [`provider-document-intake.md`](../provider-document-intake.md)，再冻结字段、状态机、owner、幂等、超时和日志 contract；
5. 在病历、患者绑定、预约写入、支付和医保文档未齐全前，继续保持对应 404 或 gate 关闭。
