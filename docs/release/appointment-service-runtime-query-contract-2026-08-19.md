# 预约服务运行时查询契约（2026-08-19）

## 结论

本次只收紧服务端预约科室/排班/预约历史只读服务的输入边界，不修改 Provider URL、Elysia 公共路由、MySQL、Redis 或旧 Python 服务，
也没有打开预约写入、锁号、取消、支付或医保。

`AppointmentService` 现在在业务方法内部确认查询对象必须是普通对象，并且同时包含字符串类型的 `startDate` 与 `endDate`。
随后才进行真实日历解析、日期跨度校验、患者归属解析和 Provider 调用。

## 必须在 Service 层重复校验的原因

Elysia schema 只能覆盖 HTTP 路由。组合根、回放任务和未来 Worker 可能直接调用 service；TypeScript 接口也会在运行时消失。
如果直接读取 `null.startDate`、数组属性或异常对象，错误会变成未映射的 `TypeError`，公共接口可能返回 500，日志也无法表达“预约查询输入不合法”。

现在的顺序固定为：

```text
运行时对象/字段形状
        ↓
真实日历与跨度
        ↓
患者 owner / HIS 映射
        ↓
Provider 只读请求
```

任何前置失败都会进入现有 `appointment.directory.*.failed` 或 `appointment.records.failed` 低敏日志，并由错误处理器映射为稳定的预约查询错误；不会调用 Provider，也不会返回伪造空列表。

## 日志和隐私边界

失败日志仅保留 `traceId`、固定错误类型和 Provider 操作域，不记录原始 query、身份证、手机号、Provider 患者号或 Provider 原始响应。
服务层校验不改变 owner-scoped 患者映射规则，客户端仍只能提交内部 opaque `patientId`。

## 验证证据

- 新增 API service 回归：`null` 预约记录查询和 `undefined` 排班查询均在 Provider 调用前失败；
- 回归同时确认两类失败都会写入独立业务失败事件，Provider 调用次数为 0；
- 预约 service 定向测试、API 类型检查和 Biome 检查通过；
- 本次仍需要后续真实 Provider、公网 HTTP、真机页面和低敏日志三层证据，代码尚未因此自动部署。
