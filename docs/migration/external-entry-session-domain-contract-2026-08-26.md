# 外部入口短期会话领域基础（2026-08-26）

> 本文记录 E 批次已经落地的通用安全基础，不代表任何外部服务已授权，也不打开互联网医院、智能客服、问诊、报告分享或订阅入口。

## 1. 本轮实现范围

新端新增了 `@hospital/domain` 的外部入口会话状态机：

- 固定 `audience` 目录，禁止客户端用新字符串绕过主体隔离；
- 会话同时绑定 `ownerUserId`、可选 `patientId`、`audience` 和内部 `resourceKey`；
- `issued -> consumed`、`issued -> revoked` 是唯一有效迁移；
- 会话到期由服务端时间判断，不能依靠客户端传入状态；
- 会话只有在 `issuedAt <= now < expiresAt` 时才可消费；签发前的请求返回固定的
  `not-yet-valid` 拒绝原因，到期返回 `expired`，两者不能合并成“网络失败”；
- 消费结果返回新对象，后续持久化必须使用条件更新保证并发下只有一个成功者；
- 仓储/缓存读模型拒绝未知字段、不带时区时间、过长 TTL 和不完整终态；
- `consumedAt` 必须位于签发时间和过期时间之间，`revokedAt` 不能早于签发时间；
- 会话模型不保存 JWT、平台 access token、Provider ID、完整 URL 或 query。

平台目前把外部会话最长有效期限制为 10 分钟；正式 Provider contract 可以进一步缩短，不能未经评审扩大。

## 2. 患者范围规则

患者范围采用严格相等策略：

| 会话 | 消费上下文 | 结果 |
| --- | --- | --- |
| 无 `patientId` | 无 `patientId` | 允许继续做 owner/audience/resource 校验 |
| 有 `patientId` | 相同 `patientId` | 允许继续做其它校验 |
| 有 `patientId` | 缺失或不同 `patientId` | 拒绝 |
| 无 `patientId` | 提供 `patientId` | 拒绝 |

这样可以防止用户级客服会话被扩大为患者级资源，也防止报告分享引用脱离原患者范围。

## 3. 当前没有做的事情

- 没有注册 Elysia 公共路由；
- 没有实现外部 URL 生成、WebView、回跳或 Provider adapter；
- 没有把会话引用写入 Redis/MySQL；实际存储时必须保存哈希/不可逆索引，并使用 owner、audience、resource 和状态条件更新；
- 没有改变 `FeatureKey` 的阻塞状态；正式 contract、allowlist、外部主体、回跳、退出、撤回和日志证据齐全后，才允许单域接入。

## 4. 验证与后续接入顺序

新增 `packages/domain/src/external-entry-session.test.ts`，覆盖 owner/患者/audience/resource 隔离、签发前拒绝、到期、最长 TTL、一次性消费、撤回、终态时间线、未知字段、时区和不完整终态。

后续单域接入必须继续遵循：

```text
正式外部 contract
  -> resourceKey/origin/path allowlist
  -> 会话仓储哈希与条件消费
  -> Elysia audience/owner API
  -> 小程序失败、退出和回跳状态
  -> Pino 低敏审计
  -> 公网与真机证据
```
