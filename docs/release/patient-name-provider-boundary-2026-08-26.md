# 就诊人姓名 Provider 字段边界复核（2026-08-26）

## 结论

本轮只收紧新项目已有的就诊人目录与 `patInfosFind` 档案关联，不开放新增绑定、实名修改或二维码业务，
也没有修改旧 Python 服务、旧数据库、Redis、线上进程或预约适配器。

## 发现的问题

患者目录 adapter 的通用文本校验为了兼容旧端 ID，允许安全整数转换成字符串。姓名字段误用了同一 helper，
因此 Provider 返回 `{ patientName: 123 }` 或档案返回 `{ patName: 123 }` 时，数字可能被转换成页面可见名称，
并继续参与档案查询。这会把 Provider schema 错误伪装成真实患者，污染首页、选择页和后续 HIS 映射。

## 处理规则

- `patientName` 和档案 `patName` 必须是字符串；数字、数组、对象和控制字符统一按 `provider-response-invalid`
  拒绝。
- 只有明确属于旧端 ID 的安全整数字段继续允许无损字符串化。
- 姓名在目录字段预校验阶段失败时，不发起任何 `patInfosFind` 请求。
- 档案姓名校验失败时，不返回或写入 `his-patient` 临床引用。
- 卡号仍沿用严格字符串规则，保留前导零并继续执行脱敏和档案身份关联。

## 回归证据

- `pnpm --filter @hospital/adapters test src/zhongyang-patients.test.ts`：29 pass / 0 fail / 65 expect
- `pnpm --filter @hospital/adapters typecheck`：通过
- 覆盖目录数字姓名不触发档案查询，以及档案数字姓名不创建临床映射。

本地 adapter 证据不能替代当前 live 运行包的微信真机页面、客户端 requestId、服务端 Pino 事件和 Provider requestId
同链取证；九个只读验收域仍保持 pending。
