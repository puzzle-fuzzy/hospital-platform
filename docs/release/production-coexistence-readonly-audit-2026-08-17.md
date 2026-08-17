# 2026-08-17 生产新旧服务共存只读基线与后续切换结果

> 本文记录通过 SSH 对中转服务器进行的只读核对。未读取 env、数据库数据或会话，未执行发布、重启、停止、
> migration、缓存清理或任何业务写入。服务器密码和密钥不进入文档或 Git。
>
> 本文第 1-6 节是历史核对与 `b186098` 切换结果；当前 release 已进一步切换为 `3ab0a6c`，请以
> [`3ab0a6c-production-acceptance-2026-08-17.md`](3ab0a6c-production-acceptance-2026-08-17.md) 的当前运行证据为准。

## 1. 服务器与核对范围

| 项目 | 值 |
| --- | --- |
| SSH 地址 | `192.168.112.172` |
| 服务器主机名 | `ps` |
| 核对日期 | 2026-08-17（中国标准时间） |
| 核对内容 | 监听端口、相关 systemd 服务状态、当前 release 软链接 |
| 变更 | 无 |

## 2. 只读结果

| 检查项 | 结果 |
| --- | --- |
| 新 Elysia API | `10.0.0.3:18081`，进程为 `bun`，PID `1431434` |
| 旧 Python API | `0.0.0.0:8001`，进程为 `python`，PID `636918` |
| 新 API systemd | `hospital-platform-api-v2.service`：`loaded active running` |
| 历史切换前 release 快照 | `/home/ps/code/hospital-platform/current -> releases/41c9c18`（非当前线上版本） |

## 3. 结论

- 新 Bun/Elysia API 和旧 Python API 当前同时监听，满足“新旧服务共存、不停旧服务”的运行边界。
- 该历史快照中的 release 指针为 `41c9c18`，不等于当前线上版本；当前线上 release 已切换为 `3ab0a6c`，以对应的当前生产验收文档为准。
- 本核对没有证明旧 Python 服务的 systemd unit 名称、Worker 状态、env 内容或数据库 schema 细节；这些必须引用对应的专门证据。
- 端口和进程共存只证明运行层，不证明微信登录、患者映射、预约历史、报告、门诊费用、Provider、支付、医保或真机业务完成。

## 4. 与公网证据的关系

公网 live/ready/ping 和病历关闭边界见 [`current-public-readonly-smoke-2026-08-17.md`](current-public-readonly-smoke-2026-08-17.md)。
两份证据合起来只能证明：公网入口可达、基础依赖 ready、新旧监听端口同时存在、病历入口仍关闭；
不能替代患者会话和真实业务验收。

## 5. 下一步

1. 不发布当前仓库文档提交，先使用受控微信账号完成 TTL、多患者切换、失效/恢复和页面返回竞态证据。
2. 在当前线上 release 上分别验证预约历史、报告目录、门诊费用的真实 Provider 和公开链路；记录服务端 traceId、
   providerRequestId（如有）和真机网络结果。
3. 新 Provider 文档到达后按 intake → contract → domain → adapter → persistence → API → 小程序 → 日志 → 验收顺序推进，
   不因端口共存或 readiness 通过提前开放写入和支付。

## 6. 后续生产切换结果

本文件第 1-5 节是切换前的只读基线；随后 `b186098` 已按独立发布手册完成候选 checksum、真实生产
preflight、`127.0.0.1:18082` 临时 smoke 和原子切换。切换后 `current=b186098`、新 API PID 为
`1803489`，旧 Python PID `636918` 和 `8001` 监听保持不变，Worker 仍 inactive。完整时间线、
公网 6/6 readiness 和回滚边界见 [`b186098-production-acceptance-2026-08-17.md`](b186098-production-acceptance-2026-08-17.md)。
