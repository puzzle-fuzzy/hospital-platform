# 服务端独立候选 `90d8910b` 发布记录（2026-08-27）

> 本候选只更新新 Bun/Elysia API 运行包，不上传微信线上小程序版本。小程序配套使用本地
> live `90d8910b`；服务端与小程序来源相同只是本次候选配对，不代表微信真机、众阳、HIS、支付或医保业务已经完成。
> 本记录证明候选构建、真实生产依赖、隔离 smoke 和新旧服务共存切换，不替代逐域业务证据。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `90d8910bdc54d48dde66c4ff03a7434c182ebd92` |
| 小程序客户端 | `90d8910b` |
| 小程序构建来源 | `90d8910bdc54d48dde66c4ff03a7434c182ebd92` |
| 服务端运行时变化 | 健康知识导入校验、MySQL 读模型和公共 contract 共用字段长度；疾病列表对超长正文只返回无摘要，不静默截断医学正文；可点击药品引用必须带 `drugId` |
| 数据库 schema | 未新增 migration；继续使用线上已验证 `0016_patient_directory_sync_owner_index` |
| Worker | 未启动，继续保持 inactive |

## 候选构建产物

服务端 bundle 在本地使用 Bun 构建后上传到独立 release 目录；服务器没有现场安装 workspace
依赖或编译。以下 SHA-256 是本地 bundle 与远端 release 逐项核对的低敏摘要：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `353eba64b237f5584367abf63652fae1b1b4baaf8a7e09edda7bf6049556d235` |
| `apps/worker/dist/index.js` | `0b2a39286dc6ecebf1cd739e3b1783724ddba31d10a976708a87ad3ec3133776` |
| `apps/worker/dist/preflight.js` | `28a21b6a779b962a8aca6379795777b70b05de7f630b9538ec79fe3305447fbb` |
| `apps/worker/dist/api-runtime-smoke.js` | `82fde0f81e4dc5783eb50dc6f08dfd8a8cf0706a9f914be2115961fed098d295` |
| `apps/worker/dist/provider-directory-smoke.js` | `86503a97bec6bbf064d9984275904b418b4a20107b9f6bd45747135aab06b607` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `f80f65135fa5995d01f45e4b5c46655f3c563dfcda4a050d150c90a887f1e958` |
| `apps/worker/dist/p0-log-aggregate.js` | `280b175341c2794290ab61bf6175295922c79bd588972732f05caefa0bd54746` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `afa687b6e52021237f275e808466800433bd8d48a344c7c879f944e5a2a1eb9e` |

## 发布前门禁

- API、domain、persistence、contracts 定向测试和 TypeScript 检查通过；全仓 build 通过。
- 使用服务器既有 `shared/api.env` 的真实 production preflight 通过：MySQL、Redis、schema 均为 `ok`；微信身份、患者目录、预约目录/历史和门诊费用配置完整；支付、报告 gate 继续关闭。
- 候选在 `127.0.0.1:18082` 以 `environment=production` 启动，隔离 smoke 的 live、连续 3 次 ready、system ping、未登录边界 401 和关闭能力 404 全部通过。
- 隔离进程由退出清理逻辑回收；没有执行 migration、Redis 清理、真实 Provider、支付、医保或 HIS 写入。

## 原子切换与旧服务共存

2026-08-27 约 12:45 CST，切换前确认 `current=1107a78a47ac2fbe0557958251d66da9effc66de`、新 API active、旧 Python `8001` 监听、Worker inactive，且目标 release 与 `current.next` 均不存在。随后只执行同目录原子切换并重启新 API：

```text
current.next -> releases/90d8910bdc54d48dde66c4ff03a7434c182ebd92
mv -Tf current.next current
只重启 hospital-platform-api-v2.service
```

切换后只读复核结果：

- `current` 指向 `/home/ps/code/hospital-platform/releases/90d8910bdc54d48dde66c4ff03a7434c182ebd92`；
- `hospital-platform-api-v2.service=active`，主进程使用新 `current/apps/api/dist/index.js`，监听 `10.0.0.3:18081`；
- `0.0.0.0:8001` 仍在监听，旧 Gunicorn PID `3687390、3687419、3687420、3687421、3687422` 仍存活；旧服务没有停止、重启或修改；
- `hospital-platform-worker-v2.service=inactive`，没有启动支付、医保或 HIS 回写任务；
- 内网 `GET http://10.0.0.3:18081/health/ready` 返回 database/redis/schema 均为 `ok`。

## 公网 runtime smoke

使用同一 `90d8910b` bundle 访问 `https://test-hp.meiyi.pro/api/v2`，HTTPS 证书校验通过：

| 检查 | 结果 |
| --- | --- |
| live | `200` |
| ready | 连续 `3/3`，`200` |
| system ping | `200` |
| 未登录认证边界 | `401 unauthorized` |
| 关闭能力边界 | `404 not-found` |

服务端启动日志明确记录 `environment=production`、`runtimeMode=production`、`authRuntimeStatus=ready`、
`persistenceDatabaseProbe=ok`、`persistenceRedisProbe=ok` 和 `persistenceSchemaProbe=ok`；未输出环境变量值、令牌、患者标识或 Provider 原文。

## 业务边界与回滚

本次只完成健康知识跨层 fail-closed 修正及新 API 共存发布。健康内容正式审核 bundle、真实微信登录、患者切换、预约历史、爽约、门诊费用、Provider 和普通资料仍需绑定同一小程序来源，逐域采集页面、客户端 requestId、服务端 Pino 和适用的 Provider 低敏 requestId。

支付、医保授权/结算、预约写入/取消、退款和 HIS 回写继续关闭；不启动 Worker，不改变旧 Python 服务。

若新 API readiness、公网路径或旧 `8001` 异常，只允许把 `current` 原子切回
`releases/1107a78a47ac2fbe0557958251d66da9effc66de` 并只重启 `hospital-platform-api-v2.service`；不得停止旧 Python、删除 release、清理 Redis 或回滚 schema。
