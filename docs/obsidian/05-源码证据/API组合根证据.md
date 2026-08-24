---
type: evidence
area: api
title: API 组合根证据
status: static
---

# API 组合根证据

API 组合根位于 [apps/api/src/app.ts](../../../apps/api/src/app.ts)。当前模块注册包括：

- auth
- health
- system
- patients
- profile
- appointments
- reports
- outpatient-payments
- payments

组合根只证明模块被挂载；每个模块是否需要患者、如何映射供应商，继续查看对应的接口目录和业务规则。

