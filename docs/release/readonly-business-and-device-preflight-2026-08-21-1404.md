# 只读业务与真机前置复核（2026-08-21 14:04 CST）

> 本记录只描述当前代码候选、生产公网运行层和微信开发者工具前置状态，不把未登录探针、模拟器页面或二维码生成误记为真实业务完成。旧 Python 服务、数据库、Redis、Provider 配置和服务器服务均未因本次复核被修改或重启。

## 1. 候选基线

本地 `release:baseline:audit` 通过，当前记录使用以下候选关联：

| 项目 | 值 |
| --- | --- |
| 服务端候选 | `5a31427` |
| 小程序提交 | `f66514d` |
| 小程序运行包来源 | `f66514de81c051cb8ade1477f758700b2837b9b7` |
| 小程序运行根目录 | `apps/miniprogram/dist/` |

`apps/miniprogram/dist/` 由当前构建重新生成；其中有 14 个页面脚本，存在运行时 `services/single-flight.js`，不存在
`services/single-flight.test.js`，也不存在任何 `*.test.js` 或 `*.spec.js`。

## 2. 本地业务门禁

| 检查 | 结果 | 覆盖范围 |
| --- | --- | --- |
| API 预约/门诊费用/报告定向测试 | 62 pass，0 fail | 日期窗口、owner/patient 映射、未知字段、Provider 读模型、状态错配、日志 trace |
| 小程序标准测试 | 176 pass，0 fail | 登录、会话代际、患者同步/切换、预约历史、爽约、门诊费用、报告和静态页面 |
| 小程序构建 | 通过 | 14 个页面脚本发布到 staging 后原子替换 `dist/` |
| `runtime:verify` | 通过 | 运行包来源、根文件、页面入口和测试脚本隔离 |
| `release:baseline:audit` | 通过 | 服务端、小程序提交和完整运行包来源一致 |

本轮只读复审没有发现可以在不猜 Provider contract 的前提下安全扩展的业务逻辑：预约记录继续只读，门诊费用继续只读，报告详情继续依赖短期引用 gate；支付、医保、HIS、预约写入、患者绑定和二维码仍然关闭。

## 3. 公网运行层只读核验

从开发机访问 `https://test-hp.meiyi.pro/api/v2`，只发送健康检查和无 Bearer 的认证边界请求，没有携带患者标识、Provider 凭证或支付数据，也没有写入 MySQL/Redis：

| 请求 | HTTP | 结论 |
| --- | ---: | --- |
| `GET /health/live` | 200 | 进程存活 |
| `GET /health/ready` | 200 | `database=ok`、`redis=ok`、`schema=ok` |
| `GET /system/ping` | 200 | 服务身份可达 |
| `GET /me` | 401 | 未登录鉴权边界正确 |
| `GET /patients` | 401 | 未登录鉴权边界正确 |
| `GET /appointments/records` | 401 | 未登录鉴权边界正确 |
| `GET /payments/outpatient/records` | 401 | 未登录鉴权边界正确 |

这些结果只证明公网运行层和认证边界，不证明 Provider 返回了预约、报告或费用数据。

## 4. 服务器日志边界

本轮尝试只读 SSH `ps@192.168.112.172`，服务器返回：

```text
Permission denied (publickey,password)
```

因此没有读取 journald、没有判断当前业务事件数量，也没有执行配置、systemd、数据库或 Redis 操作。后续必须恢复独立只读日志权限，或由服务器提供脱敏的 P0 聚合结果；不能用公网 200/401 代替服务端业务日志。

## 5. 微信开发者工具与 ENOENT

当前选择的是新项目 `miniprogram` 窗口，资源树的运行目录为 `dist/`；旧的 `mp-weixin` 窗口不属于本轮验收。重新生成了当前候选的 iOS 真机调试二维码，但窗口列表仍没有手机连接。

当前代码和运行包没有缺失 `single-flight.js`。如果手机继续报告 `dist/services/single-flight.test.js` ENOENT，问题仍属于开发者工具增量模块索引，不应在源码或 `dist/` 中手工补测试脚本。处理顺序为：

1. 结束旧真机调试会话；
2. 关闭并重新打开 `apps/miniprogram/` 的新 `miniprogram` 项目；
3. 执行普通编译并确认运行包来源；
4. 重新生成二维码后再扫码。

当前模拟器调试器中的 `GET /api/v2/me 401` 是未登录模拟器的预期结果，不是 ENOENT 或业务代码异常。

## 6. 下一步

在用户扫码并出现新项目手机连接后，按同一候选依次采集：微信登录、患者目录同步、显式更换就诊人、我的挂号、爽约记录和门诊费用只读。每个业务域都必须同时有页面结果、客户端 `/api/v2` requestId/traceId 和服务端同链低敏日志；任一患者归属、状态、金额或来源不一致，立即停止该业务域。

支付、医保授权/结算、退款、预约写入、患者绑定、报告 Provider 详情、病历正文和 HIS 回写不因本次门禁通过而开放。
