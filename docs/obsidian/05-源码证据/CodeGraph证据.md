---
type: evidence
area: codegraph
title: CodeGraph 证据
status: static
indexed_files: 230
nodes: 4475
edges: 15337
unresolved: 0
extraction_version: 24
---

# CodeGraph 证据

## 当前索引快照

| 指标 | 值 | 解释 |
| --- | ---: | --- |
| 文件 | 230 | 当前索引范围内的源码文件 |
| 节点 | 4,475 | 函数、方法、类型等图节点 |
| 边 | 15,337 | 静态调用/引用关系 |
| 未解析引用 | 0 | 解析器没有报告 unresolved reference |
| 提取版本 | 24 | 本次索引生成版本 |

## 对业务链最有用的关系

| 起点 | 关系 | 终点/意义 |
| --- | --- | --- |
| `createApp` | 注册 | auth、patients、profile、appointments、reports、outpatient-payments、payments |
| `api-client.login` | 调用 | `performLogin`，建立平台会话 |
| `requestWithSession` | 包装 | 会话恢复、Bearer 注入、请求重放和错误边界 |
| `syncPatients` | 调用 | 患者同步请求，之后回到患者列表读模型 |
| `requestWechatPrepay` | 调用 | 预支付请求和 pay params 转换 |
| `AuthService.login` | 调用 | `exchangeCode`、session issue |
| `PatientService.sync` | 调用 | `listByIdentity`、规范化和冲突处理 |
| `ReportService.list` | 调用 | `listReports`、短期引用和 TTL |
| `ReportService.detail` | 调用 | reference 校验和 laboratory detail adapter |

## 图与源码的使用顺序

1. 用 CodeGraph 找入口、候选调用链和跨层关系。
2. 打开具体页面、API module、service 和 contract，确认参数、条件分支及错误行为。
3. 对照真实运行配置/日志，才能确认 provider、支付回调和外部网络是可用的。

## 证据边界

CodeGraph 适合发现候选关系，不是运行时成功证明。同名方法可能出现候选边，例如门诊费用模块里的 `list` 要以 [outpatient-payments/index.ts](../../../apps/api/src/modules/outpatient-payments/index.ts) 的真实依赖对象为准；也不能只凭 `createApp` 的注册关系声称所有模块已配置。最终文档应以“CodeGraph 定位 + 源码阅读 + 配置/运行证据”区分标注。
