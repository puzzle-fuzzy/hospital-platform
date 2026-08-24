> 当前发布基线更新（2026-08-24 11:33 CST）：线上服务端 release 为 `13f597ea9ee3f65b9be858117826d948339d904a`；当前小程序运行包来源为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。服务端与小程序已完成同源配套切换，真机业务三层证据仍待。
> 本段优先于本文下方旧日期、旧 release 或旧运行包叙述；旧值只作为历史记录，不作为当前验收入口。
> 下方旧 release 与运行包只作历史追溯；当前执行使用顶部 `13f597e` 配套基线。

# 报告只读当前候选业务审计（2026-08-22）
> 当前服务端发布基线（2026-08-22）：`0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；小程序来源为 `171a8743185fb4ecc1696851662659c1a0ee7ebf`。报告 Provider 仍保持 fail-closed。

## 当前 13f 候选复核覆盖（2026-08-24）

本文原有章节记录 2026-08-22 的历史候选，不改写历史证据。当前执行入口以顶部发布提示和本节为准：

- 当前服务端 release：`13f597ea9ee3f65b9be858117826d948339d904a`；当前小程序运行包来源与其同源，提交短 SHA 为 `13f597e`。
- 当前线上 `ZHONGYANG_REPORT_DIRECTORY_READY=false`、`ZHONGYANG_REPORT_DETAIL_READY=false`；报告目录和 LIS 详情都没有被打开。
- 当前 13f 候选没有发生报告 Provider 请求，也没有形成手机页面—客户端 requestId—服务端 Pino/Provider requestId 三层业务证据；历史 release 的日志不能替代当前验收。
- 本轮只做代码和契约审计，没有修改旧 Python 项目、旧服务、反向代理、MySQL、Redis 或报告 Provider 自动化采集文件。

当前候选回归结果：

| 范围 | 结果 |
| --- | --- |
| API `src/modules/reports/service.test.ts` | `25 pass / 0 fail / 108 expect()` |
| `packages/adapters/src/zhongyang-reports.test.ts` | `18 pass / 0 fail / 35 expect()` |
| domain 报告与 external trace | `9 pass / 0 fail / 19 expect()` |
| 小程序当前选定验收集 | `222 pass / 0 fail / 1643 expect()` |

结论没有改变：现有报告代码已经具备归属、患者映射、时间窗口、Provider 响应包络、资源上限、详情短期引用和
失败即关闭边界，但正式 Provider 字段/授权契约和当前候选真实样例尚未冻结，因此本轮不新增兼容字段、不打开 gate、
不调用真实 Provider。下一步必须先取得脱敏成功/空结果/业务失败/字段异常样例，再按“报告目录 → LIS 详情 →
PACS/ECG 资源 → PEIS/报告解读”的顺序分别验收。

## 结论

本轮继续按旧端真实请求链审计报告目录和详情，没有打开报告 Provider gate，没有修改旧 Python 项目、旧服务、线上反向代理、MySQL 或 Redis。

审计发现并修正两处会改变患者看到的医疗时间事实的映射偏差：

- LIS 的 `reportedAt` 必须来自旧端展示的 `reportTime`，缺失时不能用 `collectTime` 或 `regTime` 猜测；
- ECG 的 `reportedAt` 必须优先使用旧端展示的 `diagnoseTime`，不能让 `auditDocTime` 静默覆盖诊断时间。

这两处不是格式兼容问题。错误回退会改变报告日期窗口、倒序排序以及报告页的“报告时间”，因此按 Provider 响应异常整批 fail-closed。

## 2026-08-22 当前候选契约复核

本次按当前服务端 `0e2a366efcca8da25d7edd4a286781f2d3dfdbec` 和小程序运行包来源
`171a8743185fb4ecc1696851662659c1a0ee7ebf` 重新执行报告相关回归，并复核了报告目录、详情、附件和页面
并发边界。没有发现需要在缺少 Provider 正式契约时贸然修改的业务缺口，因此本轮不改报告代码、不调用真实
Provider，也不打开任何报告 gate。

| 范围 | 当前结果 |
| --- | --- |
| API `reports/service.test.ts` | `25 pass / 0 fail / 108 expect()` |
| 众阳报告 adapter | `18 pass / 0 fail / 35 expect()` |
| 报告 domain | `5 pass / 0 fail / 11 expect()` |
| 小程序报告相关 client/acceptance | `132 pass / 0 fail / 1376 expect()` |
| `ZHONGYANG_REPORT_DIRECTORY_READY` | `false` |
| `ZHONGYANG_REPORT_DETAIL_READY` | `false` |
| 真实 Provider、真机报告链 | 未执行、未验收 |

本次复核确认：患者 owner/临床映射、日期窗口、来源错配、报告时间优先级、详情短期 opaque 引用、
附件存在性、页面患者切换和旧请求淘汰均已有代码与回归覆盖。当前剩余工作是 Provider 脱敏样例、正式字段/授权
契约以及同一真机会话的页面—HTTP—Provider requestId—服务端日志证据；在这些证据到齐前，报告页面只能保持
摘要/迁移提示和 fail-closed 行为。

## 1. 旧端真实来源与字段事实

旧端来源为 `G:\\fuck\\hospital\\hospital-app\\src\\api\\modules\\ZY.ts` 和
`src/pagesB/health/report_query.vue`：

| 来源 | Provider 路径 | 旧端目录时间 | 当前判断 |
| --- | --- | --- | --- |
| LIS | `/msun-middle-business-lis/v1/lis-reports-filter` | `reportTime`；同时单独展示采样/登记时间 | 只接受 `reportTime` 作为公共 `reportedAt` |
| PACS | `/msun-middle-business-pacs/v1/exclude-privacy-patient-reports` | `reportAuditTime` | 只读摘要，详情和资源授权未冻结 |
| ECG | `/msun-middle-business-ecg/v2/ecg-reports` | `diagnoseTime`；`auditDocTime` 是独立字段 | 只接受 `diagnoseTime` 作为公共 `reportedAt` |
| PEIS | `/msun-peis-app-peis-new/v1/find-report-list-for-wechat` | `summaryTime` | 依赖完整身份证和 `hospitalId`，暂不迁移 |
| LIS 详情 | `/msun-middle-business-lis/v1/lis-reports/details` | `reportTime` 与检测明细 | 仅保留服务端短期引用骨架，真实 gate 仍关闭 |
| 报告解读 | `/knowledge/report/interpretation` | 旧端提交 `type=1/reportId` | 医疗内容、版本、免责声明和审计 contract 未冻结 |

旧端会把 PACS、ECG、PEIS 的完整对象写入本地缓存，并可能携带 Provider 报告号和文件地址；这不作为新端迁移方案。

## 2. 当前新端安全边界

- 小程序只提交平台内部 `patientId`、日期和有限 `kind`；服务端按当前 owner 解析 `his-patient` 临床映射。
- Provider 患者号只存在于 adapter 请求帧内；患者姓名、身份证、原始 Provider JSON、Provider 报告号和文件 URL 不进入公共响应。
- 未指定 `kind` 时完整读取 LIS、PACS、ECG；公共 contract 没有 partial 状态，因此任一路失败都整批失败，不能静默漏掉某一来源。
- 每条摘要必须有可审计的 `reportedAt`，并落在请求首尾自然日窗口内；无法解析或窗口外的结果整批拒绝。
- 只有 LIS 在独立详情 gate、短期引用仓储和 owner + patient + reportId + TTL 校验全部满足时，才可返回 opaque `reportId`。
- PACS/ECG 当前仅目录摘要；`hasAttachment` 只表示 Provider 明确存在文件标记，不表示可下载、可预览或已授权。
- 单条详情引用建立失败时保留安全摘要并隐藏详情入口，不把可选详情故障伪装成“没有报告”。

## 3. 本轮代码修正与注释位置

| 文件 | 修正 |
| --- | --- |
| `packages/adapters/src/zhongyang-reports.ts` | LIS 目录/详情严格使用 `reportTime`；ECG 严格使用 `diagnoseTime`，并在核心映射处写明不能用其它时间字段猜测医疗事实 |
| `packages/adapters/src/zhongyang-reports.test.ts` | 覆盖 LIS/ECG 缺少正确时间字段时拒绝，以及 ECG 同时存在两个时间字段时保持旧端展示优先级 |
| `apps/api/src/modules/reports/service.ts` | 继续负责 owner、患者、窗口、读模型和短期引用的第二道运行时校验 |
| `apps/miniprogram/src/pages/report-directory/report-directory.ts` | 只展示安全摘要和服务端 opaque 详情入口，不能使用数组下标或 Provider 号拼接详情地址 |

## 4. 当前验证证据

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @hospital/adapters test` | 110 项通过，0 项失败，239 个断言 |
| `pnpm --filter @hospital/adapters typecheck` | 通过 |
| Provider gate | `ZHONGYANG_REPORT_DIRECTORY_READY=false`、`ZHONGYANG_REPORT_DETAIL_READY=false`，保持关闭 |
| 真实 Provider | 未调用；没有把测试桩当作真实数据证据 |
| 真机报告业务 | 未完成；构建和模拟器结果不能替代手机页面、HTTP requestId、Provider requestId 和服务日志同链证据 |

## 5. 未完成与继续条件

在以下证据齐全前，不开放报告目录真实 Provider 或详情能力：

1. LIS/PACS/ECG 当前环境的脱敏成功、明确空结果、业务拒绝、超时和字段异常样例；
2. Provider 的时间字段含义、`endDate` 包含规则、分页/快照一致性和授权请求头确认；
3. LIS 详情字段与目录逐条关联的正式 contract，以及短期引用、过期、资源下载和审计规则；
4. PACS/ECG 详情、影像资源和 PEIS 身份使用的独立 contract；
5. 报告解读的医疗内容版本、免责声明、审核、结果审计和失败语义；
6. 真实微信会话下切换就诊人后，页面、HTTP、Provider 和低敏日志的同链验收。

支付、医保授权、预约写入、取消、HIS 回写和旧 Python 服务继续不属于本轮范围。
