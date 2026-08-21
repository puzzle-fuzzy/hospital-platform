# 患者卡号脱敏 contract 收口（2026-08-22）

## 结论

本轮只收紧新平台的患者列表公共响应 contract，没有调用众阳、没有修改数据库中的历史值，
也没有修改旧 Python 服务或其反向代理。

患者卡号展示值现在在三层保持同一语义：

| 层 | 责任 | 允许的事实 |
| --- | --- | --- |
| 众阳 adapter | 从 Provider 卡号生成展示值 | 最多前五位、后四位，中间至少一个 `*` |
| domain/service | 写入和读取前 fail-closed | 完整卡号、超过可见边界、异常字符整批拒绝 |
| Elysia public contract / 小程序 | 响应和页面运行时复核 | 只接受同一脱敏形状或 `未绑定` |

例如合成的 15 位卡号 `123456789012345` 会变成：

```text
12345******2345
```

`123456******1234` 不合法，因为前缀泄露了六位；完整卡号也不合法。旧数据库中已经保存的
`******7890` 等历史脱敏值仍然是合法的兼容展示值，但平台不能从掩码后的数据反推出被隐藏的
前五位。要让旧快照显示新的前五位，必须在取得真实 Provider 卡号后重新执行受控的患者目录同步，
不能在小程序端猜测或拼接。

## 代码边界

- `packages/contracts/src/index.ts` 的 `PatientCardNumberMaskedSchema` 将规则写入公共 JSON Schema；
  Elysia 的患者列表路由因此不会把任意字符串当成合法公共字段。
- `packages/domain/src/patients.ts` 继续保留领域层运行时校验，避免仓储或回放器绕过 API schema。
- `packages/adapters/src/zhongyang-patients.ts` 继续负责从真实 Provider 卡号生成脱敏值；本轮只增加
  15 位边界回归测试，没有改变 Provider 请求和字段优先级。
- `apps/miniprogram/src/services/dashboard-service.ts` 继续在微信 JSON 边界重新投影，页面不会接收
  `patientId` 以外的 Provider 身份字段，也不会接收完整卡号。

## 验证与停止条件

本轮回归覆盖：前五位/后四位展示、旧全隐藏兼容值、`未绑定` 哨兵、超过五位前缀、超过四位后缀、
完整卡号和未审计分隔符。真实 Provider 返回、线上历史快照重同步和真机页面显示仍需单独证据，
不能用本地合成测试替代；支付、医保、二维码、患者绑定和 HIS 回写继续关闭。
