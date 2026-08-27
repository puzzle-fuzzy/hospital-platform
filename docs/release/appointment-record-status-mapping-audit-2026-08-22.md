> 当前服务端配套发布更新（2026-08-24 13:01 CST）：线上服务端 release 为 `28a5c0c131794ce9dcc5f94bd3809402188ac87a`；当前小程序运行包来源仍为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本轮为服务端独立只读 adapter 发布，未重建小程序运行包；下方历史候选仅供追溯，本行优先。
> 历史配套小程序构建来源（2026-08-26）：`0be59f966de2c3a0861cb44e9a526a1ef557f6c7`，仅表示当时本地 live 候选，未证明微信线上版本或真机业务已验收；当前入口以当前项目基线为准。
> 当前线上服务端 release（2026-08-27）：`1107a78a47ac2fbe0557958251d66da9effc66de`，已完成候选 preflight、隔离 smoke、原子切换和公网 runtime smoke；该运行层证据不等价于真实 Provider 或支付业务成功。
> 当前发布基线更新（2026-08-24 13:01 CST）：线上服务端 release 为 `28a5c0c131794ce9dcc5f94bd3809402188ac87a`；当前小程序运行包来源为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本轮为服务端独立只读 adapter 发布，真机业务三层证据仍待。
> 本段优先于本文下方旧日期、旧 release 或旧运行包叙述；旧值只作为历史记录，不作为当前验收入口。
> 下方 2026-08-22 的 release 与运行包只作历史追溯；当前执行使用顶部 `28a5c0c1` 服务端 + `13f597e` 小程序分层基线。
> 当前小程序配套运行包来源（2026-08-27）：`6f47c6408fe5b62025bd74fa66893f306eb7b9aa`（`6f47c64`）；本文中更早候选和真机窗口仅作历史追溯，当前无真机/开发者工具会话。

> 工作树边界审计（2026-08-26）：当前源码基线为 `39f60df6`，本次只收紧小程序
> 预约记录请求的客户端 contract，尚未发布或替换线上运行包。小程序现在对在线和
> 全部请求都显式发送 `scope=online|all`：在线请求必须同时携带日期窗口，全部请求
> 明确不携带日期窗口。服务端仍保留未传 scope 时的 online 兼容默认，但新端业务代码
> 不再依赖该默认分支；这不能替代“全部挂号”真实小程序四方链路验收。

# 预约历史状态映射审计（2026-08-22 18:34 CST）
> 历史服务端发布基线（2026-08-22 18:55 CST）：`0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；小程序来源为 `171a8743185fb4ecc1696851662659c1a0ee7ebf`。代码结论已随当前 API 发布，但真实预约 Provider/真机证据仍待补。

## 当前分层候选复核（2026-08-24）

本文下方的 `0e2a366e`、`171a874` 和更早的“当前”描述属于历史审计快照；当前执行以本节和顶部发布提示为准。

| 项目 | 当前结论 |
| --- | --- |
| 服务端/小程序来源 | 服务端 `28a5c0c1`；小程序来源 `13f597ea9ee3f65b9be858117826d948339d904a`，提交 `13f597e` |
| 在线挂号 | 服务端只接受 `scope=online`，映射 Provider `requestChannel=3`，固定 `isMzFlag=1`、`dateFlag=1` 和日期窗口 |
| 全部挂号 | 服务端只接受 `scope=all`，映射 Provider `requestChannel=4`，按已确认语义省略日期参数，不复制在线结果 |
| 小程序请求编码 | 新端显式发送 `scope=online` 或 `scope=all`；online 的日期窗口和 all 的无日期形状由联合类型与请求构造器固定 |
| 患者归属 | 先按当前 owner + 内部 `patientId` 解析 `his-patient` 映射，再在 adapter 请求帧内使用 Provider 患者号 |
| 状态 | `0/1/3/4/5/6/7` 分别映射为 scheduled/cancelled/completed/missed/stopped/substituted/registered，未知值保留 `unknown` |
| 写入能力 | 预约写入、锁号、取消、详情、预问诊、支付、医保和 HIS 回写继续关闭 |
| 历史线上只读观察 | 2026-08-24 12:23 CST 已观测到患者目录 `itemCount=1`、在线预约查询 `itemCount=61` 且 `status=cancelled` 共 61 条；这证明当时 Provider 只读返回，不等于当前“全部挂号”已完成真机四方验收 |

本轮定向回归：众阳预约 adapter `17 pass / 0 fail / 38 expect()`；API appointment service
`25 pass / 0 fail / 100 expect()`；domain `4 pass / 0 fail / 10 expect()`；小程序当前选定验收集
`222 pass / 0 fail / 1643 expect()`。代码—旧端参数—页面状态边界一致，没有发现需要在缺少新 Provider 样例时贸然修改的逻辑缺口。

> 本记录只审计“我的挂号/爽约记录”的只读状态语义，不打开预约写入、取消、预问诊、
> 支付、医保或 HIS 回写。旧项目只读对照，不做任何修改。

> 当前修正说明（2026-08-24）：本记录第 3 节关于渠道 4“尚未开放”的结论属于修正前快照，
> 已被当前 provider 只读核对和新的 `scope=online|all` 服务端 contract 取代。当前全部标签
> 已允许重新查询渠道 4 历史结果；下方状态映射和写入关闭边界仍然有效。2026-08-24 又补齐
> adapter 运行时输入门禁：即使绕过 HTTP/service 直接调用，也必须在触网前拒绝未知范围、
> `all` 混入日期、倒序日期和未知字段，不能让 TypeScript 类型断言替代运行时校验。

以下关联基线属于本文创建时的历史 release：服务端为 `0e2a366efcca8da25d7edd4a286781f2d3dfdbec`
（提交 `0e2a366e`）；小程序运行包 sourceRevision 为
`171a8743185fb4ecc1696851662659c1a0ee7ebf`（提交 `171a874`）。当前执行以本文顶部的 `13f597e`
配套基线为准。

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

## 3. 历史快照：修正前的“全部挂号”边界

以下结论仅保留用于解释历史 release，不能作为当前实现或验收依据：旧端的“全部挂号”会改用
渠道 4；修正前的新端只实现已确认的微信渠道 3，并保留旧端双标签的视觉位置；点击“全部
挂号”会提示迁移中，不会把渠道 3 的结果复制成全部历史。

## 4. 历史代码证据

本次只读复核通过：

```text
@hospital/adapters: zhongyang-appointments.test.ts  15 pass / 0 fail / 32 expect()
@hospital/miniprogram: appointment-record-view.test.ts  8 pass / 0 fail / 17 expect()
@hospital/api: appointments/service.test.ts  25 pass / 0 fail / 100 expect()
```

覆盖的关键不变量包括：状态 5/6/7 不折叠为未知、重复预约号整批拒绝、Provider 敏感
字段不进入公共响应、查询窗口外记录整批拒绝、爽约只筛 `missed`、未知状态不被客户端
猜测，以及渠道 4 未冻结前不允许“全部挂号”。该组数字是历史快照；当前定向数字见本文
上方“当前分层候选复核”。

## 5. 当前剩余准入条件

渠道 4 的 Provider 只读参数和响应字段已经由当前 contract、adapter 测试及生产只读观察
确认；当前剩余的是一次真实小程序点击“全部挂号”的四方链路证据：页面结果、客户端
`requestId`、服务端日志和 Provider `requestId` 必须能互相对应。预约详情、取消、预问诊、
预约写入、支付、医保和 HIS 回写仍保持关闭，不能因为只读历史查询成功而顺带开放。
> 当前发布基线更新（2026-08-24 19:54 CST）：线上服务端 release 已切换为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`；小程序运行包来源仍为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本轮只重启新 API，旧 Python `8001` 未修改；普通资料 PUT、支付、医保和 Provider 真机证据仍待。
> 当前统一发布基线补充（2026-08-27 13:12 CST）：服务端 release 为 `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`；小程序本地 live 运行包来源为 `90d8910bdc54d48dde66c4ff03a7434c182ebd92`，共 40 个页面。本文更早版本仅作历史追溯，真机证据仍为 pending；旧 Python `8001` 未修改。
