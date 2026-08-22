# 只读业务页面状态审计（2026-08-22）

## 结论

本轮复核预约记录、门诊费用和报告目录三条已经接入的只读链路，未发现可以安全修补的“Provider 异常被当成成功”缺口。
页面和 service 当前保持 fail-closed：成功空结果展示为空态，异常会清理患者卡片与列表，不会用空数组伪装失败，也不会把旧患者
结果继续展示给新患者。

本轮没有修改旧 Python 项目、旧服务、线上 Nginx、MySQL、Redis 或并行会话维护的众阳 adapter 与开发者工具配置。

## 已核对的业务边界

| 链路 | 页面状态事实 | service/日志事实 |
| --- | --- | --- |
| 预约记录 | 新请求开始时清空旧患者卡片、记录、分页窗口；成功空数组进入“暂无记录”；失败提供重新选择就诊人入口 | 固定中国标准时间查询窗口；owner + `his-patient` 映射后才访问 Provider；空结果记录 `appointment.records.synced` 且 `itemCount=0`；异常记录 `appointment.records.failed` |
| 门诊费用 | 待缴/已缴切换只保存最后点击状态；查询期间不取消初始患者读取；失败清空金额与卡片，不调用支付或医保 | 状态值白名单、owner + 患者映射、固定 30 天窗口和费用读模型二次校验均在 Provider 前后执行；空结果记录 `outpatient.payment.records.loaded` 且 `itemCount=0` |
| 报告目录 | 只有报告读模型成功后才提交患者卡片；报告计数、列表和本地“加载更多”窗口一起清理；无详情引用的摘要不可跳转 | `kind`、日期窗口、Provider trace、报告时间和 owner/患者范围逐层校验；单条详情引用落库失败只隐藏该详情入口，保留安全摘要；目录整批异常不会降级为空目录 |

三类页面都使用页面实例级的“最后一次请求获胜”守卫、会话代际校验和当前显式患者校验。旧事件不能用数组索引或旧 opaque 引用
覆盖新患者的列表；本地“加载更多”只展开已取得的完整读模型，不能伪装成 Provider 分页。

## 本轮验证

### API service

```text
pnpm --filter @hospital/api test src/modules/appointments/service.test.ts src/modules/outpatient-payments/service.test.ts src/modules/reports/service.test.ts
65 pass / 0 fail / 262 expect()
```

覆盖了成功空结果、依赖未配置、owner 映射缺失、Provider trace 异常、窗口外结果、非法状态、重复记录、读模型二次投影、
日志低敏字段和详情引用范围等边界。

### 原生小程序

```text
pnpm --filter @hospital/miniprogram test
205 pass / 0 fail / 1543 expect()

pnpm --filter @hospital/miniprogram runtime:verify
通过；sourceRevision=b0e093565493285e07fe549879f8b87eda649cc7；14 个页面；运行包不含 test/spec JavaScript
```

本地运行包中确认：`dist/services/single-flight.js` 存在，`dist/services/single-flight.test.js` 不存在。
测试脚本不属于微信运行包，不能通过复制测试文件解决开发者工具的旧增量索引错误。

## 构建工具占用边界

本轮曾在微信开发者工具保持打开时执行构建。TypeScript、staging 目录和构建前门禁完成，但原子替换 `dist/` 阶段收到 Windows
`EPERM`，构建安全停止，旧 `dist/` 未被删除或部分覆盖。该行为符合 [`miniprogram-runtime-publish-atomicity-2026-08-20.md`](miniprogram-runtime-publish-atomicity-2026-08-20.md)
的设计：开发者工具占用 `dist/` 时必须关闭新项目的编译/真机调试，再重新构建；不能退化为先删除目录，否则会重新制造页面 404 或测试脚本
ENOENT。

此前一次并行运行构建与运行包测试还造成临时 Git fixture 超时；停止并行后单独运行 `runtime-provenance.test.ts` 为 `6 pass / 0 fail`，
完整小程序测试也为 `205 pass / 0 fail`。后续构建、真机扫码和日志验收必须串行执行。

## 当前未完成项

1. `b0e0935` 运行包是本地未部署候选，不能替代线上 `4e1b2e2` 配套的真机候选。
2. 预约历史、门诊费用、报告目录仍缺少真实 Provider 成功/空/拒绝/暂时失败的三层证据；本轮测试不等于真实业务验收。
3. 支付、医保授权、结算回写、退款、HIS 写回和 SSH 受控发布仍保持最后处理或等待权限，不因本轮只读审计而打开。

下一步应先在不占用旧服务的前提下关闭新项目开发者工具、串行生成并验收候选运行包；随后按“预约历史 → 门诊费用 → 报告目录”取得
真实微信会话、HTTP requestId/Provider requestId 和 Pino 低敏日志的配对证据。任何一层不一致都停止该业务域，不继续迁移支付链路。
