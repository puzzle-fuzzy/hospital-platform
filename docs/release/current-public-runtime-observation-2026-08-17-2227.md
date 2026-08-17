# 当前公网运行层复核（2026-08-17 22:27 CST）

> 本记录只证明当前公网 HTTPS 路径、健康检查和未授权保护边界；不代表微信登录、患者目录、预约历史、门诊费用、报告、真机视觉或 Provider 业务已经验收。

## 1. 复核范围

- 公网入口：`https://test-hp.meiyi.pro/api/v2`
- 检查方式：本地使用 `curl.exe` 发起只读 `GET` 请求；HTTPS 证书校验未关闭。
- 本次没有携带 Bearer、微信临时 code、患者标识或任何 Provider 凭证。
- 本次没有重启服务、修改服务器文件或触发写入业务。

## 2. 结果

| 请求 | HTTP | 结果 | 结论 |
| --- | ---: | --- | --- |
| `/health/live` | 200 | `status=ok`、`service=hospital-api` | API 进程可以通过公网路径响应 |
| `/health/ready` | 200 | `database=ok`、`redis=ok`、`schema=ok` | 当前 ready 依赖探针通过 |
| `/system/ping` | 200 | `service=hospital-api`、`apiVersion=0.1.0` | 版本化 API 前缀和路由转发正常 |
| `/appointments/records?...` | 401 | `unauthorized` | 未登录请求被会话边界拦截 |
| `/payments/outpatient/records?...` | 401 | `unauthorized` | 未登录请求被会话边界拦截 |

健康检查响应带有 `Cache-Control: no-store`，符合运行状态不应被缓存的约束。预约历史和门诊费用的 `401` 只能证明认证保护，没有进入 Provider、患者归属或业务查询链路。

## 3. 当前不能宣称的内容

本次没有有效微信会话，也没有服务器 journald 低敏聚合，因此以下证据仍缺失：

1. 真实微信登录、Redis 会话 TTL 和 `/me` 恢复；
2. 当前 owner 的患者目录、`his-patient` 映射和多就诊人切换；
3. “我的挂号”前后 90 天查询、状态映射和爽约筛选；
4. 门诊费用 `unpaid/paid` 查询、金额和空列表语义；
5. 页面展示、真机请求、服务端业务事件三层交叉核对。

SSH `ps@192.168.112.172` 在本次环境仍未取得可用认证，因此没有读取或修改服务器日志。不能用公网 `200` 或未授权 `401` 替代业务成功证据。

## 4. 下一步

在获得有效 SSH/日志权限和受控微信会话后，按 [`p0-readonly-business-acceptance-runbook-2026-08-17.md`](p0-readonly-business-acceptance-runbook-2026-08-17.md) 的顺序执行：患者同步与切换 → 我的挂号 → 爽约记录 → 门诊待缴费/已缴费 → 普通资料。每个域必须同时保存页面结果、HTTP 状态/请求关联信息和低敏业务事件；预约写入、微信支付、医保、退款和 HIS 回写继续保持关闭。
