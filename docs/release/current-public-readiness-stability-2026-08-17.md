# 2026-08-17 公网 readiness 连续稳定性复核

## 1. 证据范围

本次使用仓库 `main` 提交 `ed250ec` 中的 runtime smoke 源码，从本地只读请求
`https://test-hp.meiyi.pro/api/v2`。命令运行环境明确为 `production`，没有携带会话、
患者号、Provider 凭证，也没有执行同步、预约、费用、支付或其他业务写入。

这不是 `ed250ec` 已部署到服务器的证明。服务器 release provenance 仍必须通过 SSH 固定
候选 SHA、构建 bundle、临时端口 smoke、原子切换和切换后复核单独证明；本次只证明当前公网
入口在该时刻的 HTTP/认证/健康边界。

## 2. 执行参数与结果

执行时间按上海时间记录为 `2026-08-17 01:06:49-01:06:57 CST`（命令总耗时约 9 秒）：

```text
NODE_ENV=production
HOSPITAL_API_BASE_URL=https://test-hp.meiyi.pro
HOSPITAL_API_PREFIX=/api/v2
HOSPITAL_RUNTIME_REQUIRE_READY=true
HOSPITAL_RUNTIME_READINESS_SAMPLES=6
HOSPITAL_RUNTIME_READINESS_INTERVAL_MS=1000
```

| 检查 | 结果 | 证据含义 |
| --- | --- | --- |
| `health-live` | HTTP 200，`status=passed` | 公网 live 可达且 smoke 校验了 `Cache-Control: no-store` |
| `health-ready` | HTTP 200，`status=passed`，`samples=6` | 6 次连续采样均为 `ready`，且每次响应通过 no-store 校验 |
| `system-ping` | HTTP 200，`status=passed` | `/api/v2` 前缀和服务身份可达 |
| `auth-boundary` | HTTP 401，`status=passed` | 合法最小查询参数的保护路由均维持 `unauthorized` 边界 |

readiness 六次采样的 traceId（按采样顺序）：

```text
b6ac45bf-7a42-48d5-ab23-ec352ba72304
25be2fe9-0914-42b3-9d3f-e9548d757294
f82c8863-2bb5-41c8-a77c-eb5501044895
ead90a20-210e-48d5-b2b2-79dec995b59e
66f040b6-6b58-491c-9c93-1f5562f199ec
0bb49dbf-af16-4a77-b853-eafc8a6c61b6
```

其他检查 traceId：live=`47615161-8c11-48e2-a953-cff7945030c9`，
system-ping=`2b3acdf0-7f95-438b-8c24-2ac498987715`，
auth-boundary=`d77b5b84-2350-462e-b118-73055800c531`。

## 2.1 最新公网 runtime smoke（2026-08-17 14:28 CST）

本次继续从开发机对当前公网 `/api/v2` 发起只读请求，要求 readiness 连续 6/6 为 `ready`，间隔 2000ms。
没有携带 access token、患者标识或 Provider 凭证，也没有执行登录、同步、预约、费用、支付或任何写入。
本次命令未显式设置 `NODE_ENV`，runtime smoke 自身日志正确打印 `environment=development`；这只表示
本地 smoke 运行器模式，不能据此推断线上 API 的启动模式或当前 release provenance。

```text
HOSPITAL_API_BASE_URL=https://test-hp.meiyi.pro
HOSPITAL_API_PREFIX=/api/v2
HOSPITAL_RUNTIME_REQUIRE_READY=true
HOSPITAL_RUNTIME_READINESS_SAMPLES=6
HOSPITAL_RUNTIME_READINESS_INTERVAL_MS=2000
```

| 检查 | 结果 | 证据含义 |
| --- | --- | --- |
| `health-live` | HTTP 200，`status=passed` | 公网 live 可达并通过 no-store 校验 |
| `health-ready` | HTTP 200，`status=passed`，连续 6/6 | readiness 在约 12 秒观察窗口内稳定为 ready，并通过 no-store 校验 |
| `system-ping` | HTTP 200，`status=passed` | 公网版本前缀和服务身份可达 |
| `auth-boundary` | HTTP 401，`status=passed` | 保护路由继续返回稳定 `unauthorized` 边界 |

本次 traceId 仅用于与公网/API 日志关联：live=`cfb674da-3a1b-4b6c-b94f-d540932782e0`，
readiness 按采样顺序为 `eb68660c-b3a7-4756-95ac-2594aa4bf596`、
`3638ecec-a23c-4de1-92a0-7a6ed2f63f49`、`2d5f2417-e0d6-48c5-90f3-8105d58749bb`、
`94ae7ee0-0e66-4c95-aa48-7ff4dbd7bd15`、`6b915e83-5a4c-4a5a-bdf4-54e40428224e`、
`1d1523ec-0eb1-4b1b-95a3-acd0dc3169b4`，system-ping=`5dada265-0a63-4ae3-9803-6f37d2f5989f`，
auth-boundary=`6110e274-6ee0-4ca3-8758-c4035b9d000d`。

这组证据只更新公网运行和认证边界，不证明本地 `f03ff9b` 已部署，不证明微信登录、Redis TTL、
多患者切换/失效恢复、预约历史、报告、门诊费用或真机页面已验收。

## 3. 不能从本次结果推出的结论

- 不能推出 `ed250ec` 已部署到生产；当前服务器 release 必须另有 SSH provenance 证据；
- 不能推出微信登录、Redis TTL、第二位就诊人、多患者切换/失效恢复已通过；
- 不能推出预约历史、报告、门诊费用 Provider 读取或小程序真机页面已通过；
- 不能推出预约写入、微信支付、医保授权、退款或 HIS 回写可以开放；
- 不能替代服务端 journald 中同期 `persistence.probe.*` 日志和旧 Python `8001` 共存复核。

## 4. 下一步

先在服务器按 [`readiness-stability-gate.md`](readiness-stability-gate.md) 使用候选 bundle 重做
同样的连续门禁，并关联 API journald。稳定窗口通过后，再使用真实微信会话按“登录 → 患者同步
→ 患者选择/切换 → 预约历史 → 报告目录 → 门诊费用”的顺序逐层验收；任何一层失败都只停留
在新服务，不触碰旧 Python 服务和支付/医保 gate。
