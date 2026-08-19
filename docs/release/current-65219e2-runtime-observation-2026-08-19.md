# `65219e2` 重启后运行层只读复核（2026-08-19）

> 状态：只读观察已完成；未重启、未切换 release、未执行数据库迁移、未写入数据库或 Redis，旧 Python 服务未修改。
> 本文只证明运行层共存和配置边界，不代表微信、Provider、真机或任何支付业务验收。

## 1. 观察范围

观察通过服务器既有 `ps` 账号和受信主机指纹执行，目标为 `192.168.112.172`。没有记录密码、Token、
环境文件全文或业务响应正文；只读取服务指针、systemd 状态、监听端口、健康响应和非敏感 gate。

## 2. 当前结果

| 项目 | 结果 |
| --- | --- |
| 新 API 当前指针 | `/home/ps/code/hospital-platform/releases/65219e2` |
| systemd | `hospital-platform-api-v2.service=active/running` |
| 本次服务启动时间 | `2026-08-19 12:01:18 CST` |
| 新 API | `10.0.0.3:18081` 监听；内部 `/health/ready` 返回 200，`database/redis/schema=ok` |
| 旧 Python | `0.0.0.0:8001` 仍监听；旧服务没有通用 `/health/ready` 路由，访问该路径返回 404 属于路由差异 |
| 公网 readiness | `https://test-hp.meiyi.pro/api/v2/health/ready` 返回 200，`database/redis/schema=ok` |
| 运行模式 | `NODE_ENV=production` |
| schema gate | `PERSISTENCE_SCHEMA_READY=true` |
| 报告 gate | `ZHONGYANG_REPORT_DIRECTORY_READY=false`、`ZHONGYANG_REPORT_DETAIL_READY=false` |

## 3. 业务含义

1. 新旧服务仍然共存，当前观察没有发现新 API 绑定错误端口或旧服务被停止。
2. `127.0.0.1:18081` 不是新 API 的正确探针地址；服务绑定的是 `10.0.0.3:18081`。后续运维脚本和文档必须使用
   实际监听地址，不能把 loopback 失败误判成服务故障。
3. 报告 gate 仍然关闭，符合报告 Provider 脱敏样例、详情授权和真机证据尚未冻结的业务决定；不能因为页面路由已存在
   就把报告空列表当成“无报告”。
4. readiness 只能证明当前运行层依赖可用，不能替代有效微信 session、患者 `his-patient` 映射、Provider 请求链、页面结果
   或真机证据。下一步仍按 P0 手册采集同一会话的三层证据。

## 4. 后续动作

- 保持旧 Python `8001` 不变；新服务若需发布，只允许按 release runbook 原子切换并只重启新 API。
- 先取得当前候选小程序的真机 session 和患者目录同步证据，再验证预约历史、门诊费用和普通资料；不先开放报告、支付、医保、
  HIS 写入或二维码。
- 报告 gate 只有在 Provider contract、脱敏成功/失败/空结果样例、详情引用和公网/真机日志链全部通过后才可调整。
