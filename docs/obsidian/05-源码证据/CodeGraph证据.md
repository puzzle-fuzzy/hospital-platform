---
type: evidence
area: codegraph
title: CodeGraph 证据
status: static
indexed_files: 230
nodes: 4475
edges: 15337
unresolved: 0
---

# CodeGraph 证据

## 当前索引快照

| 指标 | 值 |
| --- | ---: |
| 文件 | 230 |
| 节点 | 4,475 |
| 边 | 15,337 |
| 未解析引用 | 0 |
| 提取版本 | 24 |

## 主要静态关系

| 起点 | 关系 | 终点 |
| --- | --- | --- |
| `createApp` | 注册 | auth、patients、profile、appointments、reports、outpatient-payments、payments |
| `api-client.login` | 调用 | `performLogin` |
| `requestWithSession` | 调用 | 会话恢复和请求重放逻辑 |
| `syncPatients` | 调用 | `requestWithSession` |
| `requestWechatPrepay` | 调用 | `requestWithSession` |
| `AuthService.login` | 调用 | `exchangeCode`、session issue |
| `PatientService.sync` | 调用 | `listByIdentity`、规范化和冲突处理 |
| `ReportService.list` | 调用 | `listReports`、短期引用和 TTL 校验 |
| `ReportService.detail` | 调用 | `getLaboratoryDetail`、引用校验 |

## 证据边界

CodeGraph 适合发现候选调用关系，但同名方法可能出现“候选边”。例如门诊费用模块中的 `list` 要以 [outpatient-payments/index.ts](../../../apps/api/src/modules/outpatient-payments/index.ts) 的真实依赖对象为准。最终说明应以“CodeGraph 定位 + 源码阅读”双重证据为准；索引不等于运行时成功。

