# 报告 Provider 契约差异审计（2026-08-19）

## 结论

本轮只完成旧端请求链和新端代码边界复核，不打开报告目录/详情 gate，不调用真实报告 Provider，也不修改旧项目。

旧端“检查报告”页面实际合并了四类来源：LIS、PACS、ECG 和体检 PEIS。新端当前安全实现只覆盖前三类的只读目录以及
LIS 详情的服务端骨架；体检、PACS/ECG 详情、附件下载和报告解读仍然缺少可以直接迁移的完整契约。

## 1. 旧端真实请求

旧端来源：`G:\\fuck\\hospital\\hospital-app\\src\\api\\modules\\ZY.ts` 和
`src/pagesB/health/report_query.vue`。

| 能力 | 旧路径 | 方法 | 关键输入 | 当前判断 |
| --- | --- | --- | --- | --- |
| LIS 目录 | `/msun-middle-business-lis/v1/lis-reports-filter` | GET | `patId`、`startTime`、`endTime`、`patTypeList` | 可作为新端 `his-patient` 只读目录候选，但仍需脱敏样例和真实 gate 验收 |
| PACS 目录 | `/msun-middle-business-pacs/v1/exclude-privacy-patient-reports` | GET | `patId`、`startDate`、`endDate` | 可作为新端 `his-patient` 只读目录候选，但详情/影像资源契约缺失 |
| ECG 目录 | `/msun-middle-business-ecg/v2/ecg-reports` | GET | `patId`、`startTime`、`endTime` | 可作为新端 `his-patient` 只读目录候选，但详情契约缺失 |
| 体检目录 | `/msun-peis-app-peis-new/v1/find-report-list-for-wechat` | POST | 完整 `idcard`、`hospitalId`、`startTime`、`endTime` | 不能直接迁移；需要独立的身份证使用、患者归属和脱敏 contract |
| LIS 详情 | `/msun-middle-business-lis/v1/lis-reports/details` | GET | `reportId` | 新端已有短期 opaque 引用骨架，真实字段和 Provider gate 仍未验收 |
| 报告解读 | `/knowledge/report/interpretation` | POST | `type=1`、`reportId` | 涉及医疗内容/模型/知识版本和免责声明，不能从报告目录顺手开放 |

旧端还会把非 LIS 报告完整对象写入本地 storage，再由详情页读取；报告中的 `pdfUrl`、外部影像地址和 Provider
报告号因此可能长期留在客户端。这不是新端可接受的迁移方案。

## 2. 新端已确认的安全边界

- 报告 service 只接受平台内部 `patientId`，服务端按 owner 和 `referenceKind: "his-patient"` 解析 HIS 临床引用。
- `thirdPatientId` 不能直接作为报告请求的 `patId`；`patInfosFind.data.patId` 只作为服务端临床映射使用。
- LIS、PACS、ECG 目录 adapter 只在 Provider 边界使用 `patId`，返回前重新投影为有限报告摘要；Provider 报告号不进入公共响应，详情使用短期 opaque `reportId`。
- 目录未指定来源时，三类 Provider 请求必须整体成功；不能用 `Promise.allSettled` 返回部分来源并把缺失来源解释成“没有报告”。
- `success` 包络、来源、状态、时间、检测项和展示文本均需二次校验；异常整批 fail-closed。
- 体检 PEIS 暂不接入。新端患者公共模型不保存完整身份证号，不能为了兼容旧页面把身份证号重新放入小程序、日志或长期缓存。

## 3. 当前缺口与停止条件

以下任何一项缺失时，保持 `ZHONGYANG_REPORT_DIRECTORY_READY=false` 或详情关闭，不新增兼容转发：

1. LIS/PACS/ECG 各来源脱敏成功、失败、空结果和字段异常样例；
2. 体检 PEIS 的服务端授权、患者归属、身份证使用范围、错误语义和最小返回字段；
3. PACS/ECG 详情、影像资源、下载 URL 的短期授权、过期和审计规则；
4. 报告解读的模型/知识版本、免责声明、内容审核和结果审计；
5. 真实账号下 Provider、公网 API、页面和低敏日志的同一 `traceId/providerRequestId` 验收证据。

## 4. 下一步顺序

1. 先取得 LIS/PACS/ECG 的脱敏响应样例，完成字段差异表和真实只读 Provider 验收。
2. 再单独冻结 LIS 详情的字段白名单、短期引用和下载边界；不把 PACS/ECG/PEIS 详情混进同一个接口。
3. 取得体检和报告解读的正式 contract 后，分别设计身份证最小使用边界与医疗内容审核流程。
4. 只有目录、详情、资源授权和日志证据齐全后，才考虑小程序页面从“迁移提示/摘要”进入可用态。

本审计没有改变旧服务、线上配置、数据库、Redis 或报告 gate。
