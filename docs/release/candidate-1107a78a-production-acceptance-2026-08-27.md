# `1107a78a` 新 API 生产共存发布验收记录（2026-08-27）

> 本记录只证明新 Bun/Elysia API 的候选构建、真实生产依赖、隔离运行、原子切换和公网 HTTPS smoke。
> 不把健康检查或认证边界误写成微信真机、患者、预约、门诊费用、Provider、支付或医保业务成功。

## 发布来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `1107a78a47ac2fbe0557958251d66da9effc66de` |
| 小程序客户端 | `6f47c64` |
| 小程序构建来源 | `6f47c6408fe5b62025bd74fa66893f306eb7b9aa` |
| 切换前服务端 release | `e5d941aef3a8b0d1df24a518bea03f36f2ee505d` |
| 新 API | `10.0.0.3:18081` |
| 旧 Python API | `0.0.0.0:8001` |
| Worker | `hospital-platform-worker-v2.service=inactive`，未启动 |
| 数据库 schema | `0016_patient_directory_sync_owner_index`，未执行 migration |

## 候选验证

- API 测试 `213 pass / 0 fail / 899 expect()`、API TypeScript 检查和 Biome 检查通过。
- 真实 production env preflight 通过：微信身份、患者目录、预约目录/记录、门诊费用已配置；支付、报告 gate 关闭；MySQL、Redis、schema 均为 `ok`。
- 候选在 `127.0.0.1:18082` 以 `NODE_ENV=production` 启动；live `200`、ready 连续 `3/3`、system ping `200`、未登录边界 `401`、关闭能力 `404` 全部通过。
- 候选进程已按 PID 回收，`18082` 无残留；没有执行 migration、Redis 清理、真实 Provider、支付、医保或 HIS 写入。

## 原子切换与旧服务共存

切换前确认 `current` 指向 `e5d941...`、新 API active、旧 Python `8001` 监听且 5 个 Gunicorn PID 未变化；随后只执行：

```text
current.next -> releases/1107a78a47ac2fbe0557958251d66da9effc66de
mv -Tf current.next current
sudo -n systemctl restart hospital-platform-api-v2.service
```

切换后确认：

- `current` 指向 `1107a78a47ac2fbe0557958251d66da9effc66de`，新 API `active` 并监听 `10.0.0.3:18081`；
- 旧 Python 5 个 Gunicorn PID 仍为 `3687390、3687419、3687420、3687421、3687422`，`8001` 持续监听；
- Worker 仍为 `inactive`，没有启动支付、医保或 HIS 回写任务。

## 公网 smoke

使用同一 release 的 smoke bundle 访问 `https://test-hp.meiyi.pro/api/v2`，默认证书校验通过，结果为：

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

本次只完成门诊费用配置边界的 fail-closed 修复及服务端共存发布。真实微信登录、患者切换、预约历史、爽约、门诊费用和 Provider
业务仍需页面、客户端 requestId、服务端 Pino 与 Provider 低敏 requestId 同链取证。支付、医保授权/结算、预约写入/取消、退款和 HIS 回写继续关闭。

若出现新 API readiness、公网路径或旧 `8001` 异常，只能把 `current` 原子切回
`releases/e5d941aef3a8b0d1df24a518bea03f36f2ee505d` 并只重启新 API；不得停止旧 Python、删除 release、清理 Redis 或回滚 schema。
