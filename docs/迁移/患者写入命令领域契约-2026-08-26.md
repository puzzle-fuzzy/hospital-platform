# 患者与便民写入命令领域契约（2026-08-26）

> 本文和 `@hospital/domain` 的命令状态机只完成 D 批次的共用正确性基础，
> 不代表新增就诊人、协议、问卷、签名、锦旗或表扬信已经开放。
> 本轮没有注册 Elysia 路由、没有新增 MySQL/Redis 表、没有调用 Provider，
> 也没有修改旧 Python 服务。

## 1. 为什么先统一命令状态

D 批次的命令领域覆盖 12 个计划能力，其中 11 个已经有冻结入口；这些能力都会遇到“请求是否已经产生副作用”的问题：

- 网络超时不能证明建档、绑卡、提交或上传失败；
- 用户重复点击不能创建第二条业务事实；
- 查档异常不能降级成“没有患者”或继续建档；
- 用户没有确认时，客户端不能替用户发送不可逆命令；
- Provider 返回未知状态时，不能直接显示成功或失败。

因此每个具体业务都使用相同的命令生命周期，但仍必须拥有自己独立的
request/response、字段白名单、患者映射、同意、撤回和 Provider contract。

## 2. 状态和允许的转换

```text
requested
  ├─ awaiting_confirmation -> pending -> submitted
  │                                      ├─ duplicate
  │                                      └─ rejected
  ├─ pending -> duplicate
  └─ rejected
```

实际允许关系由 `packages/domain/src/patient-write-command.ts` 固定：

| 状态 | 含义 | 关键约束 |
| --- | --- | --- |
| `requested` | 已登记命令意图 | 不代表已经访问 Provider |
| `awaiting_confirmation` | 等待用户/业务确认 | 不能自动发出副作用请求 |
| `pending` | 副作用可能已经发生 | 超时只能用同一命令查询最终事实 |
| `submitted` | 权威成功 | 终态，不允许回退 |
| `duplicate` | 幂等键命中既有事实 | 终态，不创建第二条命令 |
| `rejected` | 权威拒绝 | 终态，不伪装为空成功 |

没有 `timeout` 终态。超时是传输结果，不是业务事实；命令保持 `pending`，
由 worker 或受控查询根据同一个 `commandId` 对账。禁止把失败重试实现为创建
新的命令或更换幂等键。

## 3. 身份和幂等边界

- `ownerUserId` 由服务端会话决定，不能取客户端请求字段；
- `patientId` 只允许平台内部 opaque 标识，绑定前可以为空；
- `feature` 必须来自固定的 12 项 D 批次目录；
- 幂等唯一键必须按 `ownerUserId + feature + idempotencyKey` 维护；
- 命令状态机不保存姓名、身份证号、卡号、签名文件、Provider 原始 ID 或 payload；
- 仓储必须用条件更新/版本号保证同一命令只有一个状态提交者；
- 状态轨迹只能追加，时间必须带显式时区并保持单调不下降。

命令状态机的公开函数还会对运行时传入的未知状态做领域层校验；不能因为调用方写了
TypeScript 类型，就让非法状态落到 `undefined.includes(...)` 这类不可分类异常。所有
重试、worker 恢复和仓储反序列化都必须复用同一套状态校验。状态迁移判断对非法值返回
`false`，后继状态查询返回空集合；需要归一化或推进命令时则抛出带 `state-invalid`
语义的领域校验错误。

命令状态机本身不代表患者权限。真正接入时仍必须先校验 owner、患者绑定、
协议版本和业务对象归属，再进入对应 Provider adapter。

## 4. 接入顺序

```text
正式业务 contract
  -> request/response/空/拒绝/超时样例
  -> owner/患者映射与字段白名单
  -> 同意、撤回、文件安全和医护读取规则
  -> 命令仓储幂等与条件更新
  -> Provider adapter 与最终状态查询
  -> Elysia API
  -> 小程序确认、等待、重复、拒绝和重试状态
  -> Pino 低敏日志与真实链路证据
```

在上述材料到齐前，`feature-status` 仍是这些入口的唯一运行落点；新增命令
领域基础不能把任何入口从 `blocked-*` 自动改成业务完成。

## 5. 自动化覆盖

`packages/domain/src/patient-write-command.test.ts` 锁定了：

- 12 个入口共用固定状态目录；
- `pending` 不可回退到 `requested`，终态不可回退；
- 必须经过确认才能进入待执行；
- 未知字段、非法标识、错误轨迹和无时区时间会被拒绝；
- 运行时非法状态不会返回 `undefined` 后继集合或未分类 `TypeError`；
- 绑定命令在确认前允许没有 `patientId`，但不会接受非法患者标识。

后续某一具体 D 入口获得正式材料后，应在此状态机之上新增该入口自己的
contract、adapter、仓储、API、页面和日志测试，不能直接复用另一业务的 payload。
