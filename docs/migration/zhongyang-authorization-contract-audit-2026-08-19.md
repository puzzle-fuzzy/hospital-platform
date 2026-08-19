# 众阳 Provider Authorization 契约审计（2026-08-19）

> 结论：旧端请求中出现的 Bearer 是旧平台用户会话凭证；它不能直接证明新 Elysia 可以使用同一凭证，也不能被新小程序或新 API 原样透传。当前只保留服务端专用 Provider 凭证候选，真实鉴权仍需 Provider/院方确认。

## 1. 已确认的旧端事实

旧小程序 `hospital-app/src/api/httpZy.ts` 的请求拦截器会读取旧平台 `userStore.accessToken`，再把它作为：

```http
Authorization: Bearer <旧平台用户 access token>
```

发送到 `VITE_ZHONGYI_BASE_API`，其中当前旧端配置指向 `https://gpsrmyy.meiyi.pro`。用户提供的
`patInfosFind` 请求样例也符合这一形状：Token 的 payload 包含旧平台的会话、用户和登录上下文，
不是医院扫码内容，也不是新平台的 `patientId`。

这只能证明旧 Provider 当时接受了旧平台用户会话，不能推出以下任何结论：

1. 新 Elysia 的平台会话可以被 Provider 接受；
2. 一个长期静态 Token 可以替代旧用户 JWT；
3. 患者目录、预约、报告和门诊费用四类接口使用完全相同的 audience、权限或 TTL；
4. 生产环境允许把用户凭证继续放在小程序端或日志中。

## 2. 新端当前边界

新端公共 API 只接受新平台会话；小程序不接收 Provider URL、Provider Token、旧平台 JWT、`openid`、
`unionId` 或 `session_key`。新 adapter 的 `authorizationToken` 只能从服务端环境配置注入，并且只在
Provider 明确要求时添加：

```text
小程序 Bearer
    -> 新平台 Redis 会话
    -> 服务端 owner / patientId 校验
    -> 服务端 Provider adapter
    -> 可选服务端专用 Authorization
```

`ZHONGYANG_AUTHORIZATION_TOKEN` 的 `configured` 状态只表示环境变量和基础 URL 形状完整，不表示真实
Provider 已授权或请求已经成功。没有可验证的 Provider 凭证时，业务 gate 必须保持 fail-closed；不能
为了复刻旧请求而把新平台 Bearer、用户输入的 Token 或聊天记录中的 Token 传给 Provider。

## 3. Provider/院方必须确认的最小契约

在把患者同步、预约记录、报告或门诊费用标记为“真实可用”前，需要取得脱敏书面确认或可复核的受控样例：

| 项目 | 必须确认的内容 |
| --- | --- |
| 凭证类型 | 服务端专用 Token、旧平台用户 Token、mTLS/API key 或其它方式；不能只给一个未说明用途的字符串 |
| 受众与权限 | 患者档案、预约、报告、费用是否共用 audience 和权限；是否按医院/机构隔离 |
| 生命周期 | 签发方、TTL、刷新/轮换、撤销、并发使用和过期错误码 |
| 网络边界 | 公网域名、IP 白名单、TLS、来源限制、是否要求固定内网出口 |
| 失败语义 | 未授权、过期、无患者档案、权限过滤、限流和上游暂时不可用的 HTTP/业务包络 |
| 追踪字段 | Provider `requestId/traceId` 的位置和是否允许记录低敏引用 |
| 分接口差异 | `patientInfoByUnionId`、`patInfosFind`、预约、报告、费用是否各有独立凭证或 Header |

## 4. 实现与验收规则

- adapter 不读取 HTTP 请求的原始 `Authorization` 去拼 Provider 请求；调用方身份只用于解析新平台 owner。
- Provider 凭证不进入 API 响应、数据库业务字段、小程序缓存、日志、错误消息或 outbox。
- 生产验收必须同时保存新平台 HTTP `traceId`、Provider 低敏 `requestId`、HTTP/业务状态和页面结果；
  不能只看到 200 或 `success=true` 就跳过凭证/权限边界。
- 如果 Provider 要求旧平台用户 JWT，必须先设计服务端受控交换或旧服务内部转发契约，并完成 TTL、撤销、
  owner 映射和审计；在此之前不得把旧 JWT 复制到新 env，也不得让新小程序继续直连 Provider。
- 当前档案接口的业务成功门禁仍是明确 `success=true`；样例中的 `code=0000`、`traceId` 和完整档案字段
  属于附加包络，未获得完整 code 枚举契约前不把它们写入公共模型或日志。

## 5. 当前停止条件

以下情况都只能记录为“配置已具备、真实 Provider 鉴权未验收”：

- 环境变量存在但没有真实请求/响应和权限样例；
- 使用旧端复制出来的用户 JWT 做一次成功请求；
- 只有公网 readiness、单元测试或模拟器页面，没有同一 release 的 Provider requestId 和真机页面；
- Provider 返回 200，但没有确认 `success`、业务 code、空结果和未授权的区别。

当前下一步是先用新小程序候选 `b55df37` 取得新平台真机会话，再按患者同步 → 预约记录 → 门诊费用 → 报告
的只读顺序收集三层证据；支付、医保授权、HIS 回写和二维码继续最后处理。
