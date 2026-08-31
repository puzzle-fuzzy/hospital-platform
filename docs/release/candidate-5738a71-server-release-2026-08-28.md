# 服务端独立候选 `5738a71e` 发布记录（2026-08-28）

> 本记录是当前线上新 API 的唯一服务端候选入口。它只描述新 Bun/Elysia API 的安全发布，不代表微信小程序线上版本，也不代表 Provider、真机、支付或医保业务已经完成。旧 Python 服务、旧数据库、旧 Redis 和 Worker 均不属于本次切换对象。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `5738a71e0bcddaa8849106754baf5b296427bed7` |
| 小程序客户端 | `3f8274e` |
| 小程序构建来源 | `3f8274ec5435779c0603ce8475a4f4e86d292cbd` |
| 切换前服务端 release | `0aaa13b53cb6e21b59b332dbd4e2b982a5aba1e7` |
| 新 API | `10.0.0.3:18081`，`hospital-platform-api-v2.service` |
| 旧 Python API | `0.0.0.0:8001`，本次未停止、未重启、未修改 |
| Worker | `hospital-platform-worker-v2.service=inactive`，本次未启动 |
| 数据库 schema | `0016_patient_directory_sync_owner_index`，只读校验，未执行 migration |

小程序候选仅用于本地 live 运行包，尚未上传微信线上版本。

## 本次运行时代码范围

本候选同步了门诊病历只读 contract 的类型、字段白名单、Provider 适配器和配置诊断，但临床病历路由仍未注册，`zhongyang-medical-records` 仍为 `disabled`。这次发布不会把未确认的临床 Provider 变成可调用能力，也不会改变支付、医保、报告、预约写入或 HIS 回写边界。

核心门禁继续采用 fail-closed：未配置或未通过正式 contract 的依赖抛出稳定依赖错误，不返回假成功、假空列表或 Provider 原始字段；日志只记录事件、错误类型、公开错误码和低敏关联信息。

## 构建产物指纹

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `ec142de30b8c5ea98b7abae0e14bde4b82ea40e9653f1ad17caccf072827a1a2` |
| `apps/worker/dist/index.js` | `2fc3c2923e4d04bb5afccd5db1e41b72fbc21a1cfd1a036e50f72010598cc14f` |
| `apps/worker/dist/preflight.js` | `57fda75d280027fd0773d73fafcaa8bd512929f124eecca694c5559678648ea4` |
| `apps/worker/dist/provider-directory-smoke.js` | `71f5c7ab44ab37285b3d0b3abaad2db7d472109cac449fa60b3bb12780fa4441` |
| `apps/worker/dist/api-runtime-smoke.js` | `82fde0f81e4dc5783eb50dc6f08dfd8a8cf0706a9f914be2115961fed098d295` |
| `apps/worker/dist/p0-log-aggregate.js` | `280b175341c2794290ab61bf6175295922c79bd588972732f05caefa0bd54746` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `afa687b6e52021237f275e808466800433bd8d48a344c7c879f944e5a2a1eb9e` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `03aeb5cb5e1a16bf5e3706157e60a740a6c05e4ba30f3e8caf0cfcea49ce3804` |

## 发布前与隔离 smoke

- 本地 API、Worker 构建通过；候选 release 目录中的 8 个构建产物与本地 SHA-256 一致。
- 使用服务器现有 `/home/ps/code/hospital-platform/shared/api.env` 执行生产 preflight：`environment=production`，MySQL、Redis 和 schema 均为 `ok`；微信身份、患者目录、预约目录/历史和门诊费用配置完整，支付、报告和病历 Provider gate 保持关闭。
- 候选在 `127.0.0.1:18082` 隔离启动，`environment=production`；live、连续 3 次 ready、system ping、未登录认证边界 401 和关闭能力 404 全部通过。第一次 smoke 仅因误用 `/api/v1/health/live` 路径失败，未切换；修正为内部根健康路径后通过，临时进程已回收。

## 原子切换与共存复核

2026-08-28 15:09 CST 左右，只对新 API 执行了同目录 `current.next -> current` 原子切换和 `sudo systemctl restart hospital-platform-api-v2.service`。切换后：

- `current` 指向 `/home/ps/code/hospital-platform/releases/5738a71e0bcddaa8849106754baf5b296427bed7`；
- 新 API service 为 `active`，启动日志明确为 `environment=production`、`runtimeMode=production`；
- 生产 readiness 返回 `database=ok`、`redis=ok`、`schema=ok`；
- 旧 Python `0.0.0.0:8001` 仍由 Gunicorn 监听，旧进程没有停止或重启；
- Worker 保持 `inactive`，没有启动支付、医保或 HIS 回写任务；
- 没有执行数据库 migration、Redis 清理、真实 Provider 请求或业务写入。

## 公网 HTTPS smoke

使用本候选的 `api-runtime-smoke.js` 对 `https://test-hp.meiyi.pro`、`/api/v2` 执行公网运行层检查：

- live 200；
- ready 连续 3 次 200；
- system ping 200；
- 未登录认证边界 401；
- 关闭能力边界 404；
- HTTPS 请求通过证书校验，未使用 `-k`。

该结果只证明新 API 公网传输、反向代理、依赖就绪和关闭边界正常，不证明真实微信、患者、预约、门诊费用、Provider、支付或医保业务成功。

## 当前下一步与回滚

当前小程序运行包已重新构建为 `3f8274ec5435779c0603ce8475a4f4e86d292cbd`，真机取证使用 [`device-evidence-3f8274ec5435779c0603ce8475a4f4e86d292cbd-pending.json`](device-evidence-3f8274ec5435779c0603ce8475a4f4e86d292cbd-pending.json)。九个真机域全部保持 `pending`，页面、客户端 `requestId`、服务端 trace/Pino 和 Provider 低敏请求号缺一不可。

如果新 API readiness、公网路径或日志出现异常，只能把 `current` 原子切回 `releases/0aaa13b53cb6e21b59b332dbd4e2b982a5aba1e7` 并只重启 `hospital-platform-api-v2.service`；旧 Python `8001` 不参与回滚。
