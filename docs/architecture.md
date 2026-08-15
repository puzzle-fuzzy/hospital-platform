# Hospital Platform Architecture

## 目标

把旧项目中的患者端、管理端、外部医院系统适配、医保支付和 AI 能力拆成清晰边界，先保证真实支付链路的可验证性，再逐步替换页面和后台能力。

## 边界

```text
Native Mini Program
        |
        v
Elysia API / contracts
        |
  domain services
  /    |      \
 DB  Redis   workers
        |
 adapters: Zhongyang / Medical Insurance / WeChat Pay / YunHealth / AI
```

- 小程序不持有商户私钥、APIv3 密钥、医保转发凭证或外部系统授权。
- 外部系统的请求格式、签名、加密和重试都收敛到 adapter。
- domain 不依赖 Elysia、数据库或具体供应商，便于用状态机测试。
- API 只负责鉴权、输入校验、调用 domain、返回契约化结果。
- 回调、查单、重试和 HIS 回写必须支持幂等；未知状态不能自动判定失败。

## 支付状态机

```text
created
  -> authorized
  -> pre_settled
  -> insurance_submitted
  -> insurance_settled
  -> cash_pending
  -> cash_paid
  -> his_written_back
  -> completed
```

每一步都记录外部单号、请求摘要、响应摘要、幂等键和 trace id。金额的权威来源是医保/支付真实返回，不从前端金额或旧缓存推算。

## 迁移顺序

1. 保留现有 MySQL/Redis，先建立 contracts 和 adapter port。
2. 迁移微信登录、患者和挂号查询。
3. 迁移医保授权、6201/6202、微信支付和 HIS 回写状态机。
4. 以原生小程序替换登录、就诊人、挂号和支付主链路。
5. 迁移报告、健康知识、便民服务和 AI。
6. 最后拆出管理后台与运维接口。

## 明确不在第一阶段做的事

- 不同时替换数据库。
- 不把外部协议字段原样暴露给患者端。
- 不把 mock/估算结果当成真实支付结果。
- 不在 Bun 中盲目重写尚未验收的 Java/医保密码学实现。
