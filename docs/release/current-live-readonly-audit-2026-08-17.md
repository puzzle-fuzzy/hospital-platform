# 2026-08-17 当前线上只读核对（20:18 CST）

> 本记录只固化当前线上运行时和低敏日志的只读观察结果。核对过程没有重启服务、切换
> `current`、读取或修改 env、执行 migration、扫描 Redis key、读取数据库业务数据，也没有
> 发起微信登录、患者同步、预约、费用或任何写入操作。

## 1. 核对范围与版本

| 项目 | 结果 |
| --- | --- |
| SSH 主机 | `192.168.112.172` |
| 新 API 当前 release | `5f5915e518e3d2de5647f7ddd90f91cd7f1e3d0c` |
| 本地 `main` HEAD | `efb3d59`（`补齐我的页面患者状态提示`） |
| 新 API | Bun/Elysia，`10.0.0.3:18081`，systemd `active` |
| 旧 API | Python/Gunicorn，`0.0.0.0:8001`，仍在监听 |
| 观察时间 | 2026-08-17 20:18 CST 前后 |

本地最新提交尚未部署到服务器。小程序静态资源也不能因为 API ready 就视为已经上传或真机验收。

## 2. 运行时证据

### 2.1 内网 API

直接请求新 API 的内部健康地址 `http://10.0.0.3:18081/health/ready` 返回：

```json
{"success":true,"data":{"status":"ready","dependencies":{"database":"ok","redis":"ok","schema":"ok"}}
```

内部地址不带公网 `/api/v2` 前缀；把公网前缀拼到内网地址会得到 404，这属于入口路径差异，不能据此判定
新 API 故障。

### 2.2 公网 API

从当前工作区对公网入口 `https://test-hp.meiyi.pro/api/v2` 进行一次只读请求：

| 路径 | HTTP | body 事实 | `Cache-Control` | `x-request-id` |
| --- | ---: | --- | --- | --- |
| `/health/live` | 200 | `status=ok` | `no-store` | 有 |
| `/health/ready` | 200 | `status=ready`，database/Redis/schema 均为 `ok` | `no-store` | 有 |
| `/system/ping` | 200 | `service=hospital-api`、`apiVersion=0.1.0` | 未返回 | 有 |

这只证明当前检查时刻的运行入口和依赖探针可用，不证明真实微信会话、Provider 字段、患者切换或页面展示正确。

## 3. 低敏日志观察

服务器当前 release 的 journald 最近 400 条中只做关键词计数，没有复制原始日志正文：

| 关键词 | 命中次数 |
| --- | ---: |
| `auth.wechat` | 9 |
| `patient.directory` | 197 |
| `appointment.records` | 6 |
| `outpatient.payment` | 4 |
| `user.profile` | 22 |
| `persistence.probe.unavailable` | 0 |
| `persistence.probe.recovered` | 0 |

这些是日志行的关键词命中次数，不是去重后的用户请求数，也不等价于成功数。它们只能证明当前 release
已经出现过相关业务域的日志链路；没有从中推断患者数量、金额、Provider 字段或支付状态。

本次服务器 release 没有包含仓库中的 `tools/p0-log-aggregate.mjs`，因此没有把原始 journald 复制到本地再解析；
采用服务器端关键词计数是为了避免把 token、患者标识、Provider 原文或其他敏感字段带出 SSH 会话。该缺口已在本地
后续发布契约中修复：worker 构建现在会生成独立的 `apps/worker/dist/p0-log-aggregate.js`，未来 release 必须
随候选五个运行 bundle 一并做 SHA-256 校验；当前服务器 release 不会自动获得这项修正，仍需下一次候选发布。

## 4. 业务结论

当前只能将状态更新为：

- 新旧服务共存和基础 ready：当前窗口已观察到；
- 微信登录、患者目录、预约历史、门诊费用、普通资料：当前 release 已出现相关日志关键词，但仍缺真实会话、
  响应字段、患者切换和真机三层交叉证据；
- 多患者切换、inactive/恢复、Redis 实际 TTL、普通资料 409：仍未验收；
- 预约写入、支付、医保授权/结算、退款、报告详情、病历和 HIS 回写：继续保持关闭或未注册。

## 5. 下一步门禁

1. 使用受控微信账号在当前发布的小程序包执行登录、患者选择/刷新、我的挂号和门诊费用只读操作；记录时间和
   request id，不记录 token、openid、患者号、完整身份证号或金额与身份的可关联组合。
2. 先确认当前账号只有一位患者，或取得第二位患者的真实 Provider 事实，再验收显式切换、失效和恢复；不能用
   本地 mock 数据代替 Provider 事实。
3. 每个业务域同时对照页面结果、HTTP 响应和服务端低敏日志；任一层出现 `persistence-temporarily-unavailable`、
   owner 错配、旧患者数据残留或未知状态，立即停止该域验收并保持 gate。
4. 本地 `efb3d59` 的“我的”页提示修正仍需随小程序构建上传后再做真机验证；不因代码已提交就宣称页面已生效。
