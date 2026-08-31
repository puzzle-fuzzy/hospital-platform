# 当前线上运行层只读观测记录（2026-08-31）

> 本文只记录通过 SSH 和公网只读请求取得的运行层事实，不包含密钥、连接串、患者数据或 Provider 原始报文。本文不等同于业务验收，也不授权部署、重启或修改线上服务。

## 1. 观测范围

- 观测日期：2026-08-31。
- 内网观测入口：`ps@192.168.112.172`，使用已配置的只读 SSH 公钥访问。
- 公网观测入口：`https://test-hp.meiyi.pro`。
- 阿里云公网主机 `8.130.127.184` 的 SSH 公钥认证仍未获得，不把该主机的未观测状态推断为已核验。
- 观测方式：读取 systemd、监听端口、当前 release 指针、已部署 preflight 输出，并发起健康检查和 ping；没有调用支付、医保、挂号写入或其他有副作用的 Provider 业务。

## 2. SSH 只读观测结果

| 项目 | 观测结果 |
| --- | --- |
| API systemd | `hospital-platform-api-v2.service` 为 `active`，主进程存在 |
| Worker systemd | `hospital-platform-worker.service` 为 `inactive`，主进程为 `0` |
| API 启动方式 | `/home/ps/.bun/bin/bun /home/ps/code/hospital-platform/current/apps/api/dist/index.js` |
| 当前 release | `5738a71e0bcddaa8849106754baf5b296427bed7` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 服务监听 | `0.0.0.0:8001`，仍与新 API 共存 |
| 运行环境 | 已部署 preflight 输出为 `production` |
| 数据库 | preflight 输出为 `ok` |
| Redis | preflight 输出为 `ok` |
| 已部署 schema | `schemaStatus=verified`，期望 head 为 `0016_patient_directory_sync_owner_index` |

Worker 未启用与当前支付、Provider 和人工接管 gate 关闭的发布边界一致；这不是 Worker 业务循环已通过验收的证据。

## 3. 健康检查结果

内网直接访问绑定地址 `http://10.0.0.3:18081`：

| 请求 | HTTP | 结果 |
| --- | ---: | --- |
| `/health/live` | 200 | `success=true`，服务状态为 `ok` |
| `/health/ready` | 200 | `success=true`，database、redis、schema 均为 `ok` |
| `/api/v1/system/ping` | 200 | `success=true` |
| `/api/v2/system/ping` | 404 | 内部 API 仅注册 v1；公网 v2 由转发层提供，不将该 404 误判为 API 进程故障 |

公网只读访问：

| 请求 | HTTP | 结果 |
| --- | ---: | --- |
| `https://test-hp.meiyi.pro/api/v2/health/live` | 200 | `success=true` |
| `https://test-hp.meiyi.pro/api/v2/health/ready` | 200 | `success=true`，database、redis、schema 均为 `ok` |
| `https://test-hp.meiyi.pro/api/v2/system/ping` | 200 | `success=true` |

这些结果只能证明进程、转发、基础依赖和 schema readiness 当前可响应，不能证明患者、预约、报告、门诊费用、个人资料、Provider、真机或支付业务已经完成。

## 4. schema 漂移确认

仓库当前 migration head 为 `0017_outbox_manual_review_state`，而线上已部署 release 的 preflight 仍以 `0016_patient_directory_sync_owner_index` 为期望 head。结合 [`server-runtime-drift-audit-2026-08-31.md`](server-runtime-drift-audit-2026-08-31.md) 中的 12 个未部署运行时文件，服务端 release 漂移是已取得线上证据的真实阻塞，不应通过修改审计器、跳过 migration 或拆分发布来绕过。

因此当前结论是：

1. 新 API、旧 Python `8001` 和公网转发在本次只读观测中均保持可响应。
2. 当前线上不是仓库最新服务端运行时代码；`0017` 及其关联的 outbox/人工复核实现尚未取得线上部署证据。
3. 发布前仍需负责人安排受控窗口，使用完整服务端候选执行 preflight、备份/回滚确认、候选切换、重启后 smoke，以及旧端口共存核验。
