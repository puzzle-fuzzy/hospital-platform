> 当前候选刷新（2026-08-22）：服务端 release 为 `0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；小程序运行包来源为 `171a8743185fb4ecc1696851662659c1a0ee7ebf`（提交 `171a874`）。本次主动登录 owner 校验修正已进入最新本地候选，真实真机证据仍待。

# 预约历史状态映射审计（2026-08-22 18:34 CST）
> 当前服务端发布基线（2026-08-22 18:55 CST）：`0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；小程序来源为 `171a8743185fb4ecc1696851662659c1a0ee7ebf`。本记录的代码结论已随当前 API 发布，但真实预约 Provider/真机证据仍待补。

> 本记录只审计“我的挂号/爽约记录”的只读状态语义，不打开预约写入、取消、预问诊、
> 支付、医保或 HIS 回写。旧项目只读对照，不做任何修改。

当前关联基线：服务端 release 为 `84370077024762d92050cf077c27f3c60302e8f8`（提交
`84370077`）；小程序运行包 sourceRevision 为
`171a8743185fb4ecc1696851662659c1a0ee7ebf`（提交 `171a874`）。

## 1. 旧端事实与风险

旧端预约历史接口使用：

- `requestChannel=3`：门诊微信在线查询；
- `requestChannel=4`：门诊自助机/全部查询；
- `status=1`：旧接口注释确认的已取消；
- `status=3`：旧接口注释确认的已就诊等状态；
- `status=4`：旧爽约页面直接比较的爽约状态。

旧端“我的挂号”在线列表实际写成了 `item.statusCode !== 1`，但同一份
`AppointmentRecordItem` 类型声明的是 `status`，没有声明 `statusCode`。因此新端不能
继续复制这段客户端过滤逻辑；如果 Provider 返回的真实字段只有 `status`，旧端在线
取消过滤本身并不可靠。

## 2. 新端冻结的状态链路

Provider 数字状态只在 `packages/adapters/src/zhongyang-appointments.ts` 内解释，
随后由 domain/service 和公共 contract 二次校验：

| Provider 状态 | 公共状态 | 小程序文案 | 业务用途 |
| ---: | --- | --- | --- |
| `0` | `scheduled` | 已预约 | 在线挂号可展示 |
| `1` | `cancelled` | 已取消 | 在线列表排除 |
| `3` | `completed` | 已完成 | 只读展示 |
| `4` | `missed` | 已爽约 | 爽约页唯一筛选条件 |
| `5` | `stopped` | 停诊 | 只读展示 |
| `6` | `substituted` | 替诊 | 只读展示 |
| `7` | `registered` | 已登记 | 只读展示 |
| 其他值 | `unknown` | 状态未知 | 不推断为爽约、成功或可操作状态 |

`unknown` 仍可以出现在在线查询结果中，因为该请求本身已经固定为微信渠道 3；它只
以“状态未知”展示，不能被客户端当成已预约、已完成或爽约，也不会开放写入操作。
爽约页面只接受服务端明确返回的 `missed`，空列表和未知状态均不能推导成爽约。

## 3. “全部挂号”边界

旧端的“全部挂号”会改用渠道 4。新端当前只实现已确认的微信渠道 3，并保留旧端双
标签的视觉位置；点击“全部挂号”会提示迁移中，不会把渠道 3 的结果复制成全部历史。
在渠道 4 的 Provider 请求参数、患者归属、失败/超时语义和返回字段完成独立 contract
之前，不能开放该标签，也不能通过页面本地拼接或状态推导补齐数据。

## 4. 当前代码证据

本次只读复核通过：

```text
@hospital/adapters: zhongyang-appointments.test.ts  15 pass / 0 fail / 32 expect()
@hospital/miniprogram: appointment-record-view.test.ts  8 pass / 0 fail / 17 expect()
@hospital/api: appointments/service.test.ts  25 pass / 0 fail / 100 expect()
```

覆盖的关键不变量包括：状态 5/6/7 不折叠为未知、重复预约号整批拒绝、Provider 敏感
字段不进入公共响应、查询窗口外记录整批拒绝、爽约只筛 `missed`、未知状态不被客户端
猜测，以及渠道 4 未冻结前不允许“全部挂号”。

## 5. 后续准入条件

只有收到脱敏 Provider 响应样本或正式接口材料，确认渠道 4 和剩余状态含义后，才重新
评估“全部挂号”。届时必须同步更新 adapter、domain、contracts、小程序文案、回归测试
和真机三层证据；在此之前保持当前只读和 fail-closed 边界。
