# `a11f117` 生产切换与共存验收（2026-08-16）

本文记录候选 `a11f117` 从隔离 smoke 到生产 `current` 的实际切换结果。它只证明新 API 的运行时、依赖探针、公网路由和新旧服务共存边界；不把真实微信登录、患者同步、预约业务、报告、门诊费用、支付、医保、HIS 或真机页面误记为已验收。

## 1. 切换摘要

| 项目 | 结果 |
| --- | --- |
| 切换时间 | 2026-08-16 22:24:51 CST 重启新 API；22:24:52 CST 记录 production startup |
| 旧版本 | `d177991` |
| 新版本 | `a11f117` |
| 原子指针 | `/home/ps/code/hospital-platform/current -> releases/a11f117` |
| 重启范围 | 只重启 `hospital-platform-api-v2.service` |
| 旧 Python API | `0.0.0.0:8001` 仍监听，未停止、未重启 |
| 新 Elysia API | `10.0.0.3:18081` 监听，systemd `active` |
| 新 Worker | `inactive`，没有扩大本次变更范围 |

切换前已确认 release bundle、生产 `shared/api.env` 和候选文件 checksum；执行过程使用 `current.next` 临时软链接后 `mv -Tf` 原子替换，没有修改旧 Python 服务，也没有执行 migration、业务写入或缓存清空。

## 2. 切换后运行时验收

### 2.1 内网直连

内网直连必须使用服务绑定地址 `10.0.0.3:18081`。`127.0.0.1:18081` 不是本服务的监听地址，不能作为本次验收命令；使用错误地址会得到连接拒绝，但不代表服务故障。

| 请求 | 结果 |
| --- | --- |
| `GET http://10.0.0.3:18081/health/live` | 200，`status=ok` |
| `GET http://10.0.0.3:18081/health/ready` | 200，`database/redis/schema=ok` |
| `GET http://10.0.0.3:18081/api/v1/system/ping` | 200，`service=hospital-api` |

### 2.2 公网转发

公网 `/api/v2` 是对外版本前缀；Nginx 将业务请求去掉 `/api/v2` 后转发给新服务的 `/api/v1`。因此公网业务 ping 是 `/api/v2/system/ping`，不能写成 `/api/v2/api/v1/system/ping`。

| 请求 | 结果 |
| --- | --- |
| `GET https://test-hp.meiyi.pro/api/v2/health/live` | 200，`status=ok` |
| `GET https://test-hp.meiyi.pro/api/v2/health/ready` | 200，`database/redis/schema=ok` |
| `GET https://test-hp.meiyi.pro/api/v2/system/ping` | 200，`service=hospital-api` |

公网 health 响应保留 `Cache-Control: no-store` 的发布门禁要求；readiness 本次只证明当前依赖探针在验收时可用，不代表 Provider 或业务数据稳定。

### 2.3 未登录认证边界

切换后再次从公网请求受保护路由，确认新 release 没有把患者数据或当前用户信息误设为公开：

| 请求 | 结果 |
| --- | --- |
| `GET https://test-hp.meiyi.pro/api/v2/patients` | 401，`error.code=unauthorized` |
| `GET https://test-hp.meiyi.pro/api/v2/me` | 401，`error.code=unauthorized`，稳定中文提示“请先登录后再继续操作” |

这只是认证边界验收，不代表微信 code 兑换、Redis session 恢复或 owner 映射已经完成。

### 2.4 启动日志

切换后 systemd 主进程 PID 为 `1073515`。启动事件记录了以下低敏状态：

- `environment=production`、`runtimeMode=production`；
- `host=10.0.0.3`、`port=18081`；
- `persistenceDatabaseProbe=ok`、`persistenceRedisProbe=ok`、`persistenceSchemaProbe=ok`；
- `authRuntimeStatus=ready`、`wechatIdentityConfiguration=configured`；
- 患者目录、预约目录、预约记录和门诊费用目录为 `configured`；
- 报告目录、报告详情和微信支付配置仍为 `disabled`；
- 日志事件为 `service.started`，未打印 AppSecret、session、openid、患者证件或支付密钥。

## 3. 新旧服务共存结论

本次共存验收通过：

1. 新 API 只占用 `10.0.0.3:18081` 和公网 `/api/v2`；
2. 旧 Python API 继续占用 `8001`，本次没有对其执行停止或重启；
3. 新 Worker 没有启动，避免把未验收的异步回调、查单或补偿逻辑带入生产；
4. 数据库仍是共用实例，但新服务只访问 `hp_*` 表，不能据此推导旧业务已完成迁移；
5. 本次没有调用 Provider 业务接口，没有触发患者同步、预约写入、支付、医保或 HIS 回写。

## 4. 当前业务验收限制

下列内容仍不能标记为“生产已验收”：

- 真机 `wx.login` code 兑换、微信 session 恢复和失效重登；
- 当前微信账号与内部 user/owner 的映射；
- 患者目录同步、患者切换、临床 `his-patient` 映射及并发同步；
- 预约科室、排班、预约历史的真实 Provider 读操作；
- 报告目录/详情（当前报告 gate 关闭）；
- 门诊费用真实数据读取（代码已接入，但本次没有带会话调用）；
- 预约写号、支付挂号、现金支付、医保授权、结算和 HIS 回写；
- 真实小程序页面渲染、页面栈切换和异常重试。

因此下一阶段必须使用真实微信会话按“登录 → 患者同步 → 切换就诊人 → 预约只读 → 门诊费用只读”的顺序验收，并为每一步保存 `requestId`、服务端事件和真机截图；任何业务失败只允许回滚新 API，不触碰旧 Python 服务。

## 5. 回滚边界

如果后续只读业务验收证明 `a11f117` 存在代码回归，回滚只切换新 API 的 `current` 到 `d177991` 并重启 `hospital-platform-api-v2.service`，随后复测 `10.0.0.3:18081`、公网 `/api/v2/health/ready`、公网 `/api/v2/system/ping` 和旧 `8001`。禁止删除 release、清空 Redis 或回滚数据库 migration；`a11f117` 的 schema 没有新增 migration。
