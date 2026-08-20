# `patInfosFind` 档案 `patId` 字符串契约收紧（2026-08-20）

> 状态：本地候选已完成代码与测试验证，尚未部署线上。本文只描述新项目的 adapter 边界；旧 Python 服务、
> 线上数据库、Redis 和公网路由均未修改。

## 1. 变更结论

`patInfosFind.data.patId` 是预约、报告和门诊费用共用的 HIS 临床档案引用。当前已确认的 Provider 返回类型为
字符串，因此新 adapter 现在严格拒绝数字形式的 `patId`，包括仍处于 JavaScript 安全整数范围内的数字。

这条规则只约束档案主键，不改变目录 `thirdPatientId` 的历史输入边界：目录接口的 `thirdPatientId` 仍可在
`Number.isSafeInteger` 范围内无损转换为内部字符串。两个字段用途不同，不能共用“数字也接受”的宽松规则。

## 2. 为什么不能继续兼容数字 `patId`

如果把数字 `patId` 转成字符串，平台会把 Provider schema 漂移隐藏成一条看似有效的 `his-patient` 映射。后续
预约、报告或门诊费用可能照常发起请求，但无法证明这个临床引用符合档案接口的真实 contract；一旦 Provider
在不同环境改变数字精度、序列化方式或字段含义，错误会延迟到临床业务层才暴露。

因此当前选择在 adapter 边界直接 fail-closed：

1. `patInfosFind.data.patId` 必须是非空、无控制字符、长度受限的字符串；
2. 数字、数组、对象、空字符串和超长值都不能写入 `his-patient` 映射；
3. 目录 `thirdPatientId` 不能作为回退值；
4. 档案响应不符合条件时，完整患者同步失败，不提交部分临床映射。

## 3. 代码和测试证据

- `packages/adapters/src/zhongyang-patients.ts` 新增 `requiredArchivePatientId()`，不再复用允许安全数字的通用
  `requiredText()`；核心分支上方已补充中文注释，说明目录引用和临床引用不能混用。
- `packages/adapters/src/zhongyang-patients.test.ts` 新增/收紧数字 `patId` 回归测试，确认错误类型在档案查询边界
  被拒绝，并保留 19 位字符串 `patId` 的正常映射测试。
- 本地 adapter 全套测试：102 项通过、220 个断言；adapter TypeScript 类型检查通过。
- 文档链接审计：250 个文档，无断链。

## 4. 发布边界

这不是线上 Provider 已确认支持的证明，而是平台对已确认字符串 contract 的收紧。正式部署前仍需取得脱敏样例
并登记 Provider 文档版本、环境、来源指纹和失败响应；若真实环境返回数字 `patId`，必须先确认 Provider
契约，而不能重新打开兼容转换。

部署时只切换新 Elysia release；旧 Python `8001` 不需要修改或停止。部署后应分别验证：患者同步没有部分提交、
`his-patient` 引用仍为服务端内部映射、预约/报告/门诊费用在 owner + patient 绑定下读取，且小程序响应不包含
`patId`、`thirdPatientId`、卡号或档案原始字段。
