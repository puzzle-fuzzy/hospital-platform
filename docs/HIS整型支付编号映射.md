# HIS 整型支付编号映射

本次为本地实现，未部署，也未对医院数据库执行迁移或历史回填。

## 编号与支付登记

- `.29` 的 `thirdPartPayRecordId` 为 JSON 整数，范围 `1..9223372036854775807`，十进制最多 19 位。平台内部 UUID 继续保留。
- 内部用十进制字符串保存编号；JSON 边界使用无损解析与序列化，不能先转为 JavaScript `number`。
- 同一次实际支付记录复用同一预分配号。旧插件关联 `plugin.paymentOrderId`，新现金组件关联 `componentId`，并同时绑定根 `medicalOrderId` 与 owner。
- 预分配号 `hisPaymentReferenceId` 与已成功的 `thirdPartPayRecordId` 回执分开。分配编号不代表 HIS 已登记成功。
- 若 HIS 返回不同的合法数字回执，实际发送号与回执号均绑定同一支付记录。所有对外数字共享唯一别名索引；发生跨支付记录冲突时拒绝确认，并隔离冲突数字，不能继续用它自动定位任意一方退款。
- 历史导入只登记 HIS 真实回执，不把数据库内部自增主键作为退款别名。新支付的 `requestReferenceId` 才表示实际分配给 `.29` 的发送号。两者分开，避免历史 A 回执 `2`、B 回执 `1` 时，由内部行号 `1` 错误关联到 A。
- 新响应必须包含合法 Long 回执；UUID、负数、溢出等异常回执不会被记作成功。历史 UUID 成功标记继续沿用旧恢复逻辑。
- 插件及现金组件的 `.29` 在发出前通过数据库原子 claim 保存 `unknown`；API/Worker 并发或任务租约过期后被另一 Worker 接管时，只有占用成功的调用方能发出请求。仅在成功响应持久化后才保存成功事实并确认映射。未知结果不自动重发。
- 结算上下文写入在数据库事务内锁定并合并已有登记事实，防止旧 prepay 快照抹除 `unknown` 或成功回执。现金组件的登记事实同时冻结原微信单号；历史记录缺少该新增字段时仍按原订单、成功回执和唯一现金组件校验。

## 新增现金退费入口

`POST /his/wechat-leg-refunds/by-third-part-pay-record-id`

以下 `thirdPartPayRecordId` 为明确虚构的 JS 边界示例，不对应实际财务流水：

```json
{
  "thirdPartPayRecordId": 9007199254740993,
  "reason": "HIS申请退费"
}
```

也兼容规范数字字符串，但签名必须按实际 JSON 类型计算。上述无引号整数与带引号字符串的签名不同。鉴权、来源限制、防重放与退款查询沿用 [HIS 退费接口接入说明](HIS退费接口接入说明.md)。

平台只接受已经确认的映射，输入必须匹配真实回执或明确的发送号，并重新核对当前订单的 owner、微信现金支付状态、原支付流水、成功回执及微信原单号。内部行号、已隔离冲突号均不可作为退款查找键。旧支付流水不能指向替换后的新支付；多笔现金组件无法唯一定位时拒绝处理。

此入口只调用现有微信现金退费服务，沿用根订单对应的退款幂等键与退款号。通过旧 UUID、`outTradeNo` 或新数字入口重复申请，不创建另一笔独立退款。此编号不自动触发医保腿或整笔聚合退费，也不允许调用方覆盖退款金额。

普通纯自费流程未经过 `.29` 时，继续使用原退费路径。`.32.settleBackNo` 继续保存根平台订单关联号。

## 数据库与历史订单

迁移文件：[0056_his_payment_references.sql](../packages/persistence/migrations/0056_his_payment_references.sql)。

- `hp_his_payment_reference_scopes` 保存内部行号、实际对外发送号、原支付 scope 与确认状态；内部行号不作为历史退款别名。
- `hp_his_payment_references` 只为实际发送号和历史/当前 HIS 数字回执提供唯一反查索引，冲突数字被隔离。
- `hp_his_payment_reference_allocator` 独立保存新编号初始化门禁及下一个候选公开号，分配时跳过已索引的历史数字。
- 新编号分配默认关闭。初始化门禁独立持久化，历史成功回执可在门禁关闭期间导入；未完成历史索引初始化时，新 `.29` 不得先占用一个可能属于旧支付的数字。
- 历史回执导入不会把自增序列推进到历史 19 位回执值。
- 原有按 UUID、医保 `payOrdId`、微信 `outTradeNo` 的退费入口保留。
- 正常恢复已经成功的数字回执时会导入映射；未经过恢复的历史记录可用专用工具分批回填。
- 只有已有成功事实的数字回执可导入。UUID 回执、未知状态、重复号跨支付记录、歧义组件均跳过或报告冲突，不重新登记支付。

回填命令位于 `@hospital/persistence` 的 `his:references:backfill`。工具要求显式设置 `HIS_REFERENCE_DATABASE_URL` 与 `MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY`，不会回退使用默认 `DATABASE_URL`。

```powershell
# 默认仅预览；先确认目标库已完成 0056 迁移。
pnpm --filter @hospital/persistence his:references:backfill --batch-size=250 --max-orders=10000
```

可用 `--from=ISO`、`--to=ISO` 限定创建时间窗口；下界包含、上界不包含。单批最多 1000 条、总计最多 100000 单，报告含游标及 `limitReached`。窗口回填可用于核查或受控导入，不能开启新编号门禁。同次扫描中发现同号属于不同支付记录时，两边均不绑定。实际写入需要额外的 `--apply --yes`；本次未运行该写入命令。

工具先扫描完整候选集，再对所有数字别名和原支付 scope 执行相同的只读冲突预检，最后才进入映射写入阶段。因此同一 scope 已确认回执 `10` 而待导入回执变为 `11` 时，预演就会报告冲突，不等到 apply 才发现。若扫描发现一个数字属于多个 scope，dry-run 只报告；apply 会先隔离该数字已有的反查别名，保留原归属供审计，使它不能继续用于任何一方自动退款。同 scope 的回执不一致不会隔离无辜的其他数字。并发写入仍由数据库唯一约束拒绝；预演不能替代停写要求。

### 首次启用新编号的部署前置步骤

以下仅为未来部署流程，本次没有执行：

1. 完成备份与迁移，暂停会创建、恢复或写回支付的 API/Worker，避免完整扫描期间新增历史事实。
2. 不使用 `--from`/`--to`，先全量预演；确认没有扫描失败、冲突或达到总量上限。
3. 核验所有不确定旧单。插件 `unknown`、旧 `cash_paid` 且缺成功登记证据、现金 `.29` 为 `unknown/failed`、成功但缺失或不合法的数值回执、缺上下文等情况都会阻止初始化；规范历史 UUID/opaque 标记保留旧路径，不伪造数字别名。
4. 完整扫描并导入后，显式请求开启门禁：

```powershell
pnpm --filter @hospital/persistence his:references:backfill --apply --yes --initialize-new-numbering --batch-size=250 --max-orders=100000
```

只有全量、不带时间窗口、无失败和冲突、未达到数量上限，且没有上述不确定历史事实时，工具才调用初始化门禁。失败时报告 `initialization: "blocked"` 及固定原因，并保持新编号关闭。默认 dry-run、普通 `--apply` 和窗口扫描均不会初始化。一次扫描超过 100000 单时须先扩展并验证工具的有界全量能力，不能拆窗口后手工认定已完成初始化。

门禁保证的是本项目可核验的历史编号。若存在无法确认的 HIS 已登记数字，须先完成双方对账；无法证明旧编号完整时，应与 HIS 明确约定独立的新编号段后另行实现，不能跳过门禁继续分配。

回填只写映射，不修改原支付订单、密文上下文和退款账本，不调用任何 HIS、医保或微信支付接口。

## 本地验证范围

- 无损 JSON、Long 边界、签名类型差异、非法新回执及旧 UUID 成功标记。
- 新编号分配、数字回执别名、历史导入、冲突隔离和已分配未成功的拒绝处理；覆盖历史 A 回执 `2` / B 回执 `1`、连续占号、最大 Long 回执不推进公开号、同 scope 回执不一致预演与实际写入均报告冲突。
- API/Worker 支付登记前的原子占用、断线后拒绝重发、过期快照不抹除登记事实、现金组件租约重叠时只登记一次、退费反查及原现金腿幂等路径。
- 独立临时 MySQL 8.4 中执行到 0056 迁移并通过 schema readiness；3 项真实事务测试、49 条断言通过，验证并发分配、19 位回执查询、历史小编号碰撞跳过、冲突号持久隔离、owner 校验及并发 claim。测试容器在完成后已移除。
- 实际 `createApp` 入口验证完整 19 位 JSON 数字、独立 HMAC、全局请求日志与现金退费委托；未知映射不会调用退费服务。

本轮全工作区 `pnpm typecheck` 已通过（12 个包，无临时单文件排除）；domain、persistence、contracts、adapters、API、Worker 共 1374 项单元测试通过，另有上述 3 项隔离 MySQL 测试通过。API/Worker 构建、34 个本次相关源文件的 Biome 检查及目标 diff 检查通过。

原 `payment-amounts.test.ts` 的不完整类型断言已改为完整 typed fixture；随后并行金额修复将旧模块替换并归档到 `.local/refund-amounts-20261015/superseded-root-draft`。当前金额实现位于独立 `refund-amounts-correctness` 工作区，以 `refund-payment-verifier.test.ts` 等测试为准；归档旧测试不计入上述回归数量。该工作区 API 类型检查及替代金额测试的 61 项用例、386 条断言也已单独通过，全程使用本地 fake/in-memory 依赖。

真实 HIS 收存/回传编号与真实支付退费联调尚未执行；上线前仍需验证双方约定。
