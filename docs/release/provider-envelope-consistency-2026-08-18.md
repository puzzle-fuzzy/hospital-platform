# Provider 响应成功包络一致性审计记录

> 记录时间：2026-08-18
> 变更类型：患者目录、报告目录和报告详情只读 adapter 业务边界加固
> 状态：本地代码与定向测试完成，未部署生产，未修改旧 Python 服务

## 1. 审计结论

预约历史 adapter 已经按已确认的 `success=true` 或 `code=0/0000` 判断业务成功，
但患者目录、患者档案、报告目录和 LIS 详情的部分包络解析只排除了
`success=false`，没有要求包络明确声明 `success=true`。因此 `{ data: [] }` 可能
被当成合法空目录，`{ data: { ... } }` 可能被当成合法档案/临床详情。

这会破坏“成功空结果”和“上游响应异常”的区别：患者目录可能错误触发空目录语义，
档案映射可能错误解释为没有 HIS 患者，报告页面也可能错误显示暂无报告。

## 2. 本次修正

- 患者目录包络形态必须满足 `success === true`；明确 `success=false` 仍保留
  Provider 业务拒绝语义，缺失或非布尔成功标志统一为 `responseInvalid=true`。
- 患者 `patInfosFind` 档案响应必须满足 `success === true`，因为其中的 `patId`
  是预约、报告和门诊费用共用的临床映射，不能把异常响应解释成无档案。
- 报告目录包络和 LIS 详情包络必须满足 `success === true`；报告详情仍保留已兼容
  的裸对象形态，但带有 `success/data` 字段时必须走包络校验。
- 已确认的裸数组/裸报告对象兼容形态不被本次删除；一旦选择包络形态，就不能省略
  成功事实。所有异常都在 Provider adapter 边界拒绝，不进入 service、数据库或小程序。
- 本次不开放报告详情 gate、附件、影像资源、支付、医保或 HIS 写回。

## 3. 自动化验证

- `zhongyang-reports.test.ts` 与 `zhongyang-patients.test.ts`：23 项通过，49 个断言。
- 新增覆盖：目录缺失/非布尔 `success`、LIS 详情缺失/非布尔 `success`、患者目录缺失
  `success`、档案映射缺失 `success`；均保持 `responseInvalid=true`，不会返回成功空结果。
- 全仓 `pnpm check` 已通过：架构、迁移、Provider 文档、文档链接、发布基线、Biome、
  9 个包类型检查、全仓测试和构建均通过；adapter 当前为 83 项测试、183 个断言，
  API 为 115 项测试、528 个断言，小程序为 122 项测试、1052 个断言。

## 4. 线上边界

本次未通过 SSH 修改服务器、未重启新旧服务，用户已有的
`apps/miniprogram/project.config.json` 修改不参与提交。当前生产服务端 release 与
小程序候选基线不因本地 adapter 修正自动改变；必须经过独立候选发布、Provider 脱敏样例、
公网 HTTPS、有效微信会话和真机三层证据后才能更新线上结论。
