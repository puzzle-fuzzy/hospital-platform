# 原生小程序列表响应包络与读模型契约（2026-08-19）

本文冻结患者、预约和门诊费用只读列表在客户端的响应边界。它解决的是“服务端返回了一个成功包络，但业务数据可能不是页面可以安全渲染的 canonical 读模型”这一层问题；不替代服务端 owner 归属、Provider adapter、数据库和真机验收。

## 1. 当前实现

以下受保护读取统一先以 `unknown` 接收网络 JSON，再通过 `requireSuccessDataResponse` 验证平台成功包络：

- `GET /patients`：当前会话下的脱敏就诊人目录；
- `POST /patients/sync`：当前 owner 的患者目录同步；
- `GET /appointments/departments`、`/appointments/schedules`：预约科室和排班目录；
- `GET /appointments/records`：当前就诊人的预约历史；
- `GET /payments/outpatient/records`：当前就诊人的门诊费用摘要。

`success` 必须严格为 `true`，`data` 必须为对象；否则统一收敛为 `provider-response-invalid`。TypeScript 泛型只提供编译期提示，不能代替运行时验证。

## 2. 业务读模型规则

平台包络通过后，业务 validator 仍然逐条检查并只重投影页面允许使用的字段：

1. 患者目录保持服务端脱敏字段、唯一 opaque `patientId`、合法关系/来源/临床访问状态和 `total === items.length`；
2. 预约记录拒绝未知状态、非法工作日和超长/控制字符展示字段，Provider 扩展字段不会继续流入页面；
3. 门诊费用要求查询状态与每条记录状态一致、`recordId` 唯一、账单时间为真实的 `YYYY-MM-DD HH:mm:ss` 日历值，金额为非负安全整数；
4. 列表任意一条记录不符合契约时整批 fail-closed，不把坏响应降级为空列表，也不保留上一位患者的旧列表。

客户端的日期、金额和字段白名单是渲染前的防御性边界；服务端仍是 owner、Provider 状态和金额语义的权威，客户端校验通过不代表 Provider 或支付业务已完成。

## 3. 本地证据

当前代码提交为 `3a66d125b0c1ca53879dd88a3661e3025fb7dd3d`，已推送 `origin/main`。小程序定向类型检查通过，定向测试为 `154` 项、`1235` 个断言通过。

本次没有修改旧 Python 服务、线上环境变量、MySQL、Redis、Provider 配置、预约写入、微信支付、医保或 HIS；没有取得新的微信真机、Provider 或支付证据。后续真机验收必须重新构建并核对 `dist/build-info.json.sourceRevision`，再按同一服务端 release 和当前候选执行。

## 4. 维护要求

新增受保护列表接口时，不得直接把 `requestWithSession<T>` 的泛型当作响应事实。必须先使用平台包络 validator，再在业务层完成字段校验、状态关联、唯一性检查和白名单重投影，并为坏包络、坏记录、重复主键和跨状态数据添加回归测试。
