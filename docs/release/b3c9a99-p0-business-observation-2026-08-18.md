# b3c9a99 首次真实会话 P0 观察（2026-08-18）

本文记录 `b3c9a99` 切换后首次真实微信会话的低敏观察结果。它只推进认证和单患者目录证据，
不把“登录成功”或“患者同步成功”扩大解释成预约历史、门诊费用、Redis TTL、多患者切换或真机业务验收完成。

## 1. 观察边界

- 线上 release：`/home/ps/code/hospital-platform/releases/b3c9a99`；当前 API `10.0.0.3:18081`；旧 Python `8001` 仍共存；
- 服务日志窗口：2026-08-18 00:05:25-00:17:06 CST；真实微信会话集中发生在 00:12-00:14 CST；
- 运行状态：`hospital-platform-api-v2.service` active，公网 `/api/v2/health/ready` 返回 200，database/redis/schema 均为 `ok`；
- 取证方式：服务器 `sudo journalctl -o cat` 经当前 release 的 `p0-log-aggregate.js --json` 脱敏聚合，并交叉核对公网 readiness；聚合只输出计数，不输出原始日志；
- 隐私边界：本文不记录 code、openid、session token、身份证、患者姓名、provider 患者号或完整请求参数。

## 2. 低敏事件计数

| 事件 | 当前服务窗口观察 | 可以证明 | 不能证明 |
| --- | ---: | --- | --- |
| `auth.wechat.login.succeeded` | 1 | 微信身份交换和平台会话创建至少成功 1 次 | Redis 实际 TTL、过期恢复和多账号隔离 |
| `patient.directory.synced` | 2 | 两次患者目录同步完成；每次记录 1 位 active 患者和 1 条临床映射 | 第二位患者、多患者切换、失效/恢复和 provider 全量目录语义 |
| `patient.directory.read.loaded` | 4 | owner-scoped 患者目录读取成功 | 页面是否始终使用最新选择、真机返回竞态和跨页面 trace 对齐 |
| `appointment.records.requested` / `appointment.records.synced` | 0 / 0 | 无 | “我的挂号” Provider、状态映射和未来预约窗口 |
| `outpatient.payment.records.loaded` | 0 | 无 | 待缴/已缴目录、金额和状态切换 |

## 2.1 journald 脱敏聚合完整性

- 输入 45 行，解析 44 行，`parseErrors=0`，空行 1 行；
- HTTP 结果为 `200=20`、`401=7`；这 7 次 401 仍属于认证边界，不是 Provider 业务失败；
- 去重后的 `providerRequestIdCount=3`，但都属于患者目录同步，不代表预约或费用请求；
- 当前窗口没有 `appointment.records.requested/synced` 或 `outpatient.payment.records.requested/loaded`。

## 3. 当前 P0 判断

1. 认证已获得当前 release 的一次真实成功样本，但 Redis TTL 仍未验收；
2. 患者目录已获得当前 release 的单患者同步/读取样本，仍未完成多患者和失效恢复；
3. “我的挂号”和门诊费用当前没有业务请求或成功事件，不能用页面打开、HTTP 401、readiness 或配置项 `configured` 代替；
4. 支付、医保授权、结算、退款、预约写入和 HIS 回写继续保持关闭。

## 4. 下一次真机操作顺序

在同一有效微信会话和最新 `apps/miniprogram/dist/` 运行包中：

1. 从首页进入“我的” → “我的挂号”，等待首屏加载完成；
2. 核对患者/院区区域、在线/全部标签和空列表/记录列表，不要把 provider 原始字段截图或发送到聊天；
3. 返回“我的” → “门诊缴费”，分别点击“待缴费”和“已缴费”；
4. 若出现错误，记录页面显示文案和操作时间即可；服务端再按时间窗口关联低敏事件和 `traceId`；
5. 不点击任何真实支付、医保授权、取消、退号或预约下单入口。

只有页面结果、平台 HTTP 响应和服务端低敏事件能够按同一操作关联时，才可将对应只读域推进到真实验收。
