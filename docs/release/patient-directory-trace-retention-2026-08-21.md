# 患者目录多请求 trace 保留审计（2026-08-21）

## 结论

本轮补齐了患者目录同步在 domain/service 边界的 trace 保留规则：gateway 如果返回
经过 contract 允许的 `requestIds`，新端现在会在写入前完成统一运行时校验，并在
`patient.directory.snapshot.committed` 与 `patient.directory.synced` 中同时保留兼容主 ID
`providerRequestId` 和有界列表 `providerRequestIds`。

这是一项日志关联和运行时边界修正，不代表众阳患者 adapter 已经取得所有档案请求号，
也不代表真实 Provider、线上 release 或真机业务已经验收。当前众阳患者 adapter 仍由
另一个会话维护；本轮没有修改它，避免与自动化获取工作冲突。

## 修改边界

- `packages/domain/src/patients.ts`：统一调用 `normalizeExternalTrace`，要求 provider 为
  `zhongyang`、operation 为 `patient-list`，保留已校验的 `requestIds`，丢弃未知扩展字段。
- `apps/api/src/modules/patients/service.ts`：成功日志统一输出主请求号和可选有界请求号列表。
- 患者 domain/API 测试覆盖多请求列表保留、主 ID 一致性和日志输出；没有放宽患者 owner、
  临床映射、快照完整性或租约门禁。

## 安全与业务含义

`requestIds` 只允许进入内部低敏日志关联，不能进入小程序 response、患者读模型、URL、
数据库患者字段或 Provider 原始报文。列表必须非空、有数量上限、每项通过 opaque 标识校验，
并且包含兼容主 ID；不满足条件时整次患者目录结果 fail-closed，不能继续快照事务。

这项修正不会改变空目录、患者失效回收、`his-patient` 一对一映射、幂等租约或当前患者
选择语义。成功日志也不能单独证明所有档案请求都被 Provider 返回；完整链仍需 adapter
contract、HTTP trace、页面结果和真机/线上观察共同证明。

## 本地证据

本轮定向验证：

- domain 患者读模型：10/10；
- API 患者 service：21/21；
- 测试 gateway 返回三项 request id 时，两个成功事件均保留同一主 ID 和完整有界列表；
- 未部署、未重启新旧服务、未修改旧 Python、线上 MySQL/Redis 或并行维护的众阳 adapter。

后续若众阳 adapter 开始返回档案请求号，必须继续使用同一列表 contract，并在当前候选
上重新执行 `pnpm check`、生产候选 smoke、P0 日志聚合和真实设备验收；不能只看到日志字段
出现就把患者同步标记为完整 Provider 验收。
