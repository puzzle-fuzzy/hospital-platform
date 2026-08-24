> 当前发布基线更新（2026-08-24 11:33 CST）：线上服务端 release 为 `13f597ea9ee3f65b9be858117826d948339d904a`；当前小程序运行包来源为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。服务端与小程序已完成同源配套切换，真机业务三层证据仍待。
> 本段优先于本文下方旧日期、旧 release 或旧运行包叙述；旧值只作为历史记录，不作为当前验收入口。
> 下方 2026-08-22 的 release 与运行包只作历史追溯；当前执行使用顶部 `13f597e` 配套基线。

# 预约历史状态映射审计（2026-08-22 18:34 CST）
> 当前服务端发布基线（2026-08-22 18:55 CST）：`0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；小程序来源为 `171a8743185fb4ecc1696851662659c1a0ee7ebf`。本记录的代码结论已随当前 API 发布，但真实预约 Provider/真机证据仍待补。

## 当前 13f 候选复核（2026-08-24）

本文下方的 `0e2a366e`、`171a874` 和更早的“当前”描述属于历史审计快照；当前执行以本节和顶部发布提示为准。

| 项目 | 当前结论 |
| --- | --- |
| 服务端/小程序来源 | 同源 `13f597ea9ee3f65b9be858117826d948339d904a`，小程序提交 `13f597e` |
| 在线挂号 | 服务端只接受 `scope=online`，映射 Provider `requestChannel=3`，固定 `isMzFlag=1`、`dateFlag=1` 和日期窗口 |
| 全部挂号 | 服务端只接受 `scope=all`，映射 Provider `requestChannel=4`，按已确认语义省略日期参数，不复制在线结果 |
| 患者归属 | 先按当前 owner + 内部 `patientId` 解析 `his-patient` 映射，再在 adapter 请求帧内使用 Provider 患者号 |
| 状态 | `0/1/3/4/5/6/7` 分别映射为 scheduled/cancelled/completed/missed/stopped/substituted/registered，未知值保留 `unknown` |
| 写入能力 | 预约写入、锁号、取消、详情、预问诊、支付、医保和 HIS 回写继续关闭 |
| 当前线上真机证据 | 13f 启动后的日志没有可接收的微信登录、患者或预约成功事件；历史 release 证据不计入当前候选 |

本轮定向回归：众阳预约 adapter `16 pass / 0 fail / 34 expect()`；API appointment service
`25 pass / 0 fail / 100 expect()`；domain `4 pass / 0 fail / 10 expect()`；小程序当前选定验收集
`222 pass / 0 fail / 1643 expect()`。代码—旧端参数—页面状态边界一致，没有发现需要在缺少新 Provider 样例时贸然修改的逻辑缺口。

> 本记录只审计“我的挂号/爽约记录”的只读状态语义，不打开预约写入、取消、预问诊、
> 支付、医保或 HIS 回写。旧项目只读对照，不做任何修改。

> 当前修正说明（2026-08-24）：本记录第 3 节关于渠道 4“尚未开放”的结论属于修正前快照，
> 已被当前 provider 只读核对和新的 `scope=online|all` 服务端 contract 取代。当前全部标签
> 已允许重新查询渠道 4 历史结果；下方状态映射和写入关闭边界仍然有效。

当前关联基线：服务端 release 为 `0e2a366efcca8da25d7edd4a286781f2d3dfdbec`（提交
`0e2a366e`）；小程序运行包 sourceRevision 为
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
