> 当前配套小程序运行包（2026-08-27）：本地 live `dist` 的 sourceRevision 为 `62cdb8f82b4169dd1b9a6ed3403e3be2f7422328`（`62cdb8f`），共 40 个页面；当前没有运行中的微信开发者工具或真机会话，九个真机证据域仍为 `pending`。本文下方历史候选仅作追溯。

> 当前配套小程序运行包来源（2026-08-27）：`f1b8b61609e0560d3da3fe176f62ab3585b6ee98`（`f1b8b61`）；当前没有开发者工具或真机会话，九个真机证据域仍为 `pending`。本文下方更早候选仅作历史追溯。

> 当前服务端配套发布更新（2026-08-24 13:01 CST）：线上服务端 release 为 `28a5c0c131794ce9dcc5f94bd3809402188ac87a`；当前小程序运行包来源仍为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本轮为服务端独立只读 adapter 发布，未重建小程序运行包；下方历史候选仅供追溯，本行优先。
> 历史配套小程序构建来源（2026-08-26）：`0be59f966de2c3a0861cb44e9a526a1ef557f6c7`，仅表示当时本地 live 候选，未证明微信线上版本或真机业务已验收；当前入口以当前项目基线为准。
> 当前线上服务端 release（2026-08-27）：`1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`，已完成候选 preflight、隔离 smoke、原子切换和公网 runtime smoke；该运行层证据不等价于真实 Provider 或支付业务成功。
> 当前发布基线更新（2026-08-24 13:01 CST）：线上服务端 release 为 `28a5c0c131794ce9dcc5f94bd3809402188ac87a`；当前小程序运行包来源为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本轮为服务端独立只读 adapter 发布，真机业务三层证据仍待。
> 本段优先于本文下方旧日期、旧 release 或旧运行包叙述；旧值只作为历史记录，不作为当前验收入口。
> 下方 2026-08-22 的 release 与运行包只作历史追溯；当前执行使用顶部 `28a5c0c1` 服务端 + `13f597e` 小程序分层基线。
> 当前小程序配套运行包来源（2026-08-27）：`f1b8b61609e0560d3da3fe176f62ab3585b6ee98`（`f1b8b61`）；本文中更早候选和真机窗口仅作历史追溯，当前无真机/开发者工具会话。

# 当前只读业务链审计（2026-08-21）
> 历史候选更新（2026-08-22）：服务端 release 为 `0e2a366e`；小程序运行包来源为 `171a8743185fb4ecc1696851662659c1a0ee7ebf`（提交 `171a874`）。历史候选仅作追溯。


> 当前完整小程序来源校验值：`13f597ea9ee3f65b9be858117826d948339d904a`；当前服务端 release：`28a5c0c131794ce9dcc5f94bd3809402188ac87a`。

> 当前发布基线（2026-08-24 13:01 CST）：服务端 `28a5c0c131794ce9dcc5f94bd3809402188ac87a`；小程序运行包来源
> `13f597ea9ee3f65b9be858117826d948339d904a`。下方更早候选只作历史追溯；真实业务仍需当前候选三层证据。

> 历史候选：服务端 release `7181e99e3a352244102f5591279528b3b66332c9`；小程序运行包来源 `4e1b2e224964797c103eba832323ee7074c7ad2b`（提交 `4e1b2e2`）。

> 历史基线：服务端 `7181e99e`；小程序候选 `4e1b2e2`；完整运行包来源 `4e1b2e224964797c103eba832323ee7074c7ad2b`。下文更早候选只作历史追溯。

> 本记录以前次 `9f491cb5` 的业务审计为基础，正文中的 `7181e99e + 4e1b2e2` 仅作历史追溯；当前运行基线以本页顶部 `28a5c0c1 + 13f597e` 为准。预约历史、爽约记录、门诊费用和小程序运行包边界仍需按当前候选取得真机三层证据。本地适配器审计修正已提交为 `313e903`，本轮会话失效与资料读模型失效边界修正已提交为 `4e1b2e2`；没有修改旧 Python 服务、线上配置、MySQL、Redis 或并行会话维护的众阳自动化代码。
>
> 本地代码和测试通过不等于真实 Provider、HTTPS、真机页面或业务日志三层验收完成。

## 1. 本轮结论

本轮没有发现可以在不猜测 Provider 合同的前提下扩展新业务的缺口，因此没有新增兼容字段，也没有打开预约写入、全部挂号、支付、医保或 HIS 回写。对已有门诊费用只读链路做了一项边界收紧：展示名称不能参与生成稳定业务引用。

已经确认的只读链路如下：

```text
当前平台会话
  -> owner-scoped 患者目录
  -> 显式选择且临床映射可用的内部 patientId
  -> 预约历史 / 爽约 / 门诊费用查询
  -> 服务端状态、日期、金额和引用校验
  -> 页面请求令牌 + 当前患者复核
  -> 小程序展示
```

- “我的挂号”使用过去 90 天至未来 90 天的中国标准时间窗口。
- “爽约记录”只使用过去 90 天，并且只筛选服务端明确归一化的 `missed`，不会把未知状态或空列表猜成爽约。
- 门诊费用只开放 `unpaid`/`paid` 只读目录，由服务端固定查询最近 30 个中国标准时间日；金额在服务端和客户端均保持整数分语义。
- 三个页面在开始新一轮患者查询时清除旧卡片和列表；只有会话代际、页面请求令牌、当前显式患者和本次响应同时有效时才回写。
- `dist/services/single-flight.js` 存在，`dist/services/single-flight.test.js` 不存在，运行包内 `*.test.js`/`*.spec.js` 数量为 0。再次出现该 ENOENT 时应按开发者工具旧增量索引处理，不得把测试脚本复制进运行包。

### 门诊费用稳定身份修正（`313e903`）

众阳费用条目的 `itemName` 只是展示文本，不能作为费用、就诊或单据的稳定身份。此前如果响应只包含 `itemName`、账单日期、金额和状态，可能生成一个看似稳定但无法定位原始费用的 `recordId`；这会为后续详情、支付或对账留下错误引用。现在 `opaqueRecordId()` 只接受已确认的单据、就诊或费用标识（例如 `outTradeOrderId`、`registerId`、`visitRecordId`、`mainId`、`chargeId`、`chargeCode`、`presCode`），缺少这些标识时整批 fail-closed，并由回归测试覆盖“仅展示名称不能成 ID”。本修正没有调用 Provider、没有部署或重启服务。

### 个人资料 Unicode 契约修正（本轮本地候选）

资料领域和迁移文档约定昵称长度按 Unicode code point 计数，但 TypeBox `maxLength` 的实际
运行时按 UTF-16 code unit 计数；因此 64 个 emoji 会在 HTTP schema 层被错误拒绝。现在共享
`UserProfileDisplayNameSchema` 用代理项对 pattern 精确约束 1–64 个 code point，并补充合同层
编译测试覆盖中文、emoji、混合字符、第 65 个字符和孤立代理项；领域层原有 `Array.from`
计数规则保持不变。该修正只在本地验证，未上传、未重启服务，也未改变真实用户资料。

## 2. 代码边界

| 链路 | 关键位置 | 已确认的边界 |
| --- | --- | --- |
| 预约历史 | `apps/api/src/modules/appointments/service.ts` | owner-scoped `his-patient` 映射、日期窗口、状态和 Provider 结果二次校验；日志只保留低敏关联字段和状态计数 |
| 爽约记录 | `apps/miniprogram/src/pages/missed-appointments/missed-appointments.ts` | 只消费服务端 `missed` 枚举，不能用 Provider 数字状态在客户端自行推断 |
| 门诊费用 | `apps/api/src/modules/outpatient-payments/index.ts` | 固定 30 日窗口、患者映射、状态、账单时间、金额、重复记录和 trace 校验；不创建支付订单 |
| 页面患者上下文 | `apps/miniprogram/src/services/dashboard-service.ts`、三个患者范围页面 | 统一读取当前 owner 目录，显式选择失效时 fail-closed，旧异步结果不得覆盖新患者 |
| 运行包 | `apps/miniprogram/tsconfig.build.json`、`scripts/build.ts`、`scripts/runtime-publisher.ts` | 测试源码不进入 `dist`，staging 完成后才原子替换运行目录，并在发布前拒绝测试脚本 |

## 3. 当前验证证据

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| 小程序患者、预约、费用、会话和运行包边界 | `pnpm --filter @hospital/miniprogram test` | 189 项通过，0 项失败，1465 个断言 |
| 个人资料 HTTP schema Unicode 边界 | `pnpm --filter @hospital/contracts test` | 2 项通过，0 项失败，27 个断言；64 个 emoji 可通过，65 个 code point 被拒绝 |
| API 预约记录和门诊费用 service | `pnpm --filter @hospital/api exec bun test src/modules/appointments/service.test.ts src/modules/outpatient-payments/service.test.ts` | 37 项通过，0 项失败，142 个断言 |
| 众阳及通用 adapter | `pnpm --filter @hospital/adapters test` | 105 项通过，0 项失败，228 个断言；包含稳定身份缺失回归 |
| 全仓门禁 | `pnpm check` | 架构、迁移、Provider、文档 400 篇无断链、发布基线、格式、lint、工具测试、9 workspace 类型检查、9 workspace 测试和构建均通过 |
| 小程序运行包 | `pnpm --filter @hospital/miniprogram runtime:verify` | 通过；14 个页面齐全，来源 `f488c6f3`，不含 test/spec 脚本 |
| 当前运行目录 | `apps/miniprogram/dist/services/single-flight.js` | 存在 |
| 当前运行目录 | `apps/miniprogram/dist/services/single-flight.test.js` | 不存在 |

## 4. 真机前的 ENOENT 恢复动作

如果微信开发者工具继续报告：

```text
ENOENT .../apps/miniprogram/dist/services/single-flight.test.js
```

按以下顺序恢复：

1. 停止当前真机调试并关闭当前小程序项目窗口。
2. 确认开发者工具重新导入的是 `E:/__Super_Core__/hospital-platform/apps/miniprogram/`，且 `project.config.json` 的 `miniprogramRoot` 为 `dist/`。
3. 清理开发者工具的文件/编译缓存后重新打开项目；本机 `project.private.config.json` 保持 `setting.ignoreDevUnusedFiles=false`。
4. 重新执行一次普通编译，再生成新的真机二维码。
5. 编译前后都确认 `dist/` 没有 `*.test.js` 或 `*.spec.js`。不要手工创建或复制 `single-flight.test.js`。

该错误属于开发者工具旧增量模块索引引用已被构建排除的测试文件，不是当前业务运行文件缺失。若清理缓存后仍出现，应记录完整时间、当前 `dist/build-info.json` 的 `sourceRevision` 和开发者工具项目路径，再停止本次真机业务操作。

## 5. 尚未完成的真实业务证据

以下事项保持原门禁，不因本轮测试通过而提前开放：

1. 当前候选的微信登录、患者同步和多就诊人切换三层真机证据；
2. 预约历史、爽约、门诊费用的真实 Provider + HTTPS + 页面三层闭环；
3. 报告目录/详情、病历、新增/绑定就诊人和动态医院数据的正式 contract；
4. 预约写入、取消、支付、医保授权、结算、退款和 HIS 回写；
5. 二维码载荷、签名、有效期、受众和防重放规则的医院确认。

后续仍按“真实微信会话 → 患者显式选择 → 预约历史/爽约 → 门诊费用只读 → 普通资料 → 报告 contract → 支付医保最后专项”推进。任一环节出现患者归属、状态、日期、金额或 trace 不一致，立即停止该业务域并回到 contract 审计。
> 当前发布基线更新（2026-08-24 19:54 CST）：线上服务端 release 已切换为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`；小程序运行包来源仍为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本轮只重启新 API，旧 Python `8001` 未修改；普通资料 PUT、支付、医保和 Provider 真机证据仍待。
> 当前统一发布基线补充（2026-08-27）：服务端 release 为 `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`；小程序本地 live 运行包来源为 `f1b8b61609e0560d3da3fe176f62ab3585b6ee98`，共 40 个页面。本文更早版本仅作历史追溯，真机证据仍为 pending；旧 Python `8001` 未修改。
