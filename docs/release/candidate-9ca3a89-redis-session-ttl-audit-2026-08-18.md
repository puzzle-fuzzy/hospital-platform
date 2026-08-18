# 候选 `9ca3a89` Redis 会话 TTL 审计工具预生产证据

日期：2026-08-18 11:40 CST 左右

## 结论

候选 `9ca3a89` 已在服务器独立 release 目录完成产物上传、逐文件 SHA-256 校验、真实生产环境 preflight 和临时端口 runtime smoke。
候选没有切换到 `current`，没有重启新旧生产服务，也没有修改 Redis ACL、数据库 schema、患者数据或其他业务数据。

本次新增的 Redis 会话 TTL 审计命令在当前 API 常驻 Redis 账号下按预期失败：账号可以连通 Redis，但没有执行
`SCAN hospital:session:*` 的权限。工具返回固定错误 `redis-session-scan-unavailable`、退出码为 `2`，没有把权限不足、空结果或不完整扫描误报为审计通过。
这证明了 fail-closed 边界，但不构成当前线上会话 TTL 已验证的证据；后续需要通过独立、只读、最小权限的维护 ACL 注入
`REDIS_SESSION_AUDIT_URL` 后再执行。

## 服务器与发布边界

| 项目 | 结果 |
| --- | --- |
| 候选 release | `/home/ps/code/hospital-platform/releases/9ca3a89` |
| 当前生产 `current` | `/home/ps/code/hospital-platform/releases/c63dba9`，未改变 |
| 新 API | `10.0.0.3:18081`，systemd `active`，未重启 |
| 旧 Python API | `0.0.0.0:8001`，继续监听，未停止、未重启、未修改 |
| 候选临时 API | `127.0.0.1:18082`，smoke 后已 SIGTERM 回收并释放 |
| Worker | 未启动 |

## 产物 SHA-256

以下摘要由本地构建产物与服务器 release 文件逐一比对，大小写差异已规范为小写展示。

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `d8d7c1b2468f1d798c3ea267d82675395d61997c39c46c5b8b6b27c61c62b754` |
| `apps/worker/dist/index.js` | `3e1c39ca8f09570ea2e0f85c848a8c8b6169f07132b4f49204a806cb80badef9` |
| `apps/worker/dist/preflight.js` | `a2fc8cdb460671f19e7a8a75167ace220bac4ba5c458f9266b518fab7a389284` |
| `apps/worker/dist/provider-directory-smoke.js` | `3ac16889bc3d106e9ea259d680bff980c0884ed04c7cd3b192ff93e90fd86d6d` |
| `apps/worker/dist/api-runtime-smoke.js` | `1246914eece1aceaee8d644d7199ff0ee825c5be05ffa5f4f2bc4a42e8bb21f3` |
| `apps/worker/dist/p0-log-aggregate.js` | `5da0f845226891901d5a4c4fb5b6fa8f9e9be3522fa272830175e44cb91b7cb1` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `ae82730903e392b061b5cd08a86c09cadedeb3b01a3b25342fcaa925912d5907` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `3f8190fb7acc75a41fb2e12181ad9eb99cafc2302f7044a157452228d4fcd70` |

## 验收结果

### 真实生产 env preflight

服务器使用 `/home/ps/code/hospital-platform/shared/api.env`，未输出 env 内容。结果为：

- `environment=production`；
- MySQL：`passed/ok`；
- Redis：`passed/ok`；
- schema：`passed/verified`，期望版本为 `0016_patient_directory_sync_owner_index`；
- 微信身份、患者目录、预约目录、预约记录、门诊费用目录配置完整；
- 微信支付、报告目录、报告详情保持 disabled。

### 候选临时端口 runtime smoke

候选 API 仅监听 `127.0.0.1:18082`，使用 production 环境运行，未接收公网流量：

- live：HTTP 200；
- ready：连续 3/3 通过；
- system-ping：HTTP 200；
- 未登录受保护路由：HTTP 401，错误码为 `unauthorized`；
- smoke 完成后候选进程正常收到 SIGTERM，`18082` 已释放。

### Redis 会话 TTL 审计

执行同一候选 release 的 `redis-session-ttl-audit.js`，未提供独立维护 ACL，因此按设计回退到 API Redis 配置。结果为：

```json
{"verified":false,"error":"redis-session-scan-unavailable"}
```

进程退出码为 `2`。本次没有打印 Redis URL、session key、患者标识、token 或原始 Redis 错误，也没有执行任何写入命令。

## 下一步

1. 由服务器密钥管理或受控 systemd 临时环境提供独立的 `REDIS_SESSION_AUDIT_URL`，仅允许会话 key 的只读扫描和 TTL 查询。
2. 重新执行 TTL 审计，只有完整、非空、每个 key 都有非负 TTL 且未截断时才记录为通过。
3. 继续当前 `c63dba9` 的真实微信会话、患者显式切换、预约历史和门诊费用只读三层验收；支付、医保、预约写入、退款、报告 Provider 和 HIS 写回继续最后处理。
