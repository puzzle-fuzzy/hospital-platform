# 预约历史与门诊费用只读契约复核（2026-08-26）

## 复核结论

本轮按广度优先原则，对预约历史（包括“我的挂号”和“爽约”派生视图）与门诊费用只读列表进行了服务端、适配器、HTTP 合同和原生小程序四层复核。

结论是：当前源码没有发现需要改变前后端业务含义的契约错误；复核过程中发现并修复了一处 MySQL `DATETIME(3)` 到严格 ISO 时间的读模型适配缺口。除此之外没有为了制造进度修改已经稳定的业务代码。支付调起、医保授权、结算写回、退款和挂号写入仍保持关闭，不因本次只读复核而提前开放。

## 复核范围

### 预约历史

调用链保持为：

```text
小程序页面
  -> 显式 scope=online|all 的请求构造
  -> Elysia 查询 schema
  -> owner-scoped 患者引用
  -> 预约 service
  -> Provider adapter
  -> 脱敏预约摘要
```

- `scope=online` 必须携带 `startDate` 和 `endDate`，服务端按中国标准时间校验日期窗口。
- `scope=all` 表示旧端完整历史渠道，不能同时携带日期字段；客户端不会把在线查询结果复制成本地“全部挂号”。
- 服务端在 Provider 返回后再次校验记录状态、患者范围、日期窗口、数量上限和公共字段；发现窗口外或坏记录时整批失败，不过滤坏行伪装成成功。
- 排班快照写入 MySQL 后，repository 会把 UTC `DATETIME(3)` 严格恢复为领域层 ISO 时间，再执行观察窗口校验；非法自然日不会被本地时区或 `Date.parse` 自动进位。
- “爽约”只是在已取得的预约摘要上按 `status=missed` 派生，不创建另一套患者映射。
- 当前页面使用固定批次的本地可见窗口，避免一次性创建过多 WXML 节点，但不把本地展开窗口误报成 Provider 分页。

### 门诊费用

调用链保持为：

```text
小程序页面
  -> patientId + unpaid|paid
  -> Elysia 认证与查询 schema
  -> owner-scoped his-patient 引用
  -> 固定最近 30 个中国标准时间日窗口
  -> 众阳门诊费用 adapter
  -> 费用公共读模型
```

- 小程序只提交内部 opaque `patientId` 和固定状态，不提交 provider 患者号、金额、订单号或医保字段。
- 服务端先验证会话、owner、患者映射、渠道配置和上下文，再允许调用 Provider。
- adapter 只把已经确认的 Provider 状态 `1/3` 映射为公共 `unpaid/paid`；未知或中间状态不粗暴映射成已缴费。
- 费用日期、金额、稳定记录引用、重复 ID、展示文本和返回数量在 adapter 与 service 两层复核。
- Provider 忽略日期窗口或返回窗口外账单时整批失败，不把缺失账单伪装成完整列表。
- 页面只在同一会话代际、同一显式患者和同一查询批次下提交患者卡片与费用列表；切换患者或 tab 时旧异步结果不能回写。
- 当前页面只读展示；待缴费点击进入关闭态，已缴费点击进入详情关闭态，均不会调用 `wx.requestPayment` 或修改服务端状态。

## 自动化证据

以下测试均在当前工作树执行，未修改旧 Python 服务、旧数据库、旧 Redis 或另一会话负责的众阳预约适配器：

| 范围 | 结果 |
| --- | --- |
| 预约 service `apps/api/src/modules/appointments/service.test.ts` | 25 pass / 0 fail / 100 expect() |
| 门诊费用 service `apps/api/src/modules/outpatient-payments/service.test.ts` | 15 pass / 0 fail / 55 expect() |
| 众阳门诊费用 adapter `packages/adapters/src/zhongyang-outpatient-payments.test.ts` | 22 pass / 0 fail / 53 expect() |
| MySQL 读模型 `packages/persistence/src/mysql-repositories.test.ts` | 36 pass / 0 fail / 132 expect() |
| API 路由与 owner 归属 `apps/api/src/app.test.ts` | 43 pass / 0 fail / 273 expect() |
| 小程序预约/费用读模型 `apps/miniprogram/src/services/dashboard-service.test.ts` | 24 pass / 0 fail / 83 expect() |

此外，当前 pending 小程序运行包通过：

```text
revision=ded78c58c53923ecf5232a8035b3e790e5959216
40 pages and required root files are present
```

## 当前没有完成的边界

- 预约锁号、登记、取消、挂号详情和支付写入未开放。
- 门诊费用支付调起、微信/医保授权、6201/6202/6301/退款和 HIS 回写未开放。
- 预约、费用的真实 Provider、公网、日志和真机四方证据仍需在候选运行包发布后采集。
- `apps/miniprogram/dist/` 当前仍由微信开发者工具占用；pending 到 live 的原子发布因 `EBUSY` 保留旧 live，不能手工覆盖或修改 `build-info.json`。

后续应先关闭占用 `dist` 的开发者工具窗口，再执行 `runtime:publish-pending` 和 live 校验；发布成功后按“登录 → 患者目录/切换 → 预约 → 报告 → 门诊费用 → 普通资料”顺序采集证据。支付/医保继续最后处理。
