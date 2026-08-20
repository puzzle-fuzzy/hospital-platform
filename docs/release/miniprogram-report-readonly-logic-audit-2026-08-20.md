# 报告目录与详情只读逻辑审计（2026-08-20）

## 结论

本轮继续审计报告目录、LIS 详情引用、患者归属、来源聚合、并发回写和附件存在性。整体业务边界保持正确：
小程序只提交平台内部 `patientId`，服务端按 owner 解析 `his-patient` 映射，PACS/ECG 只返回摘要，LIS 详情必须经过
短期 opaque `reportId`；报告 Provider、影像/心电详情、附件下载和报告解读仍未开放。

审计发现一个需要修正的响应投影问题：旧端类型将 LIS `pdfUrlList` 定义为字符串数组、PACS/ECG 文件字段定义为
`string | null`，新 adapter 对部分字段使用 `Boolean(...)` 会把 `{}` 等任意 truthy 值误判为“含附件”。本轮已将
附件存在性收紧为已确认的非空字符串/字符串数组；未知结构整批按 `provider-response-invalid` 失败。该字段仍然只表示
存在性，不返回 URL，也不授予下载权限。

本轮没有调用真实报告 Provider，没有打开报告 gate，没有修改旧 Python 服务、旧端口、线上配置、MySQL 或 Redis。

## 已确认的不变量

### 1. 患者与 Provider 归属

- API 只接受当前平台用户下的内部 `patientId`，不会接受小程序传入的众阳 `patId`、卡号或身份证号作为报告查询依据。
- 报告 service 先查 owner-scoped `his-patient` 映射，再把 Provider 患者号限制在 adapter 请求帧内。
- 映射缺失、Provider 引用越界或仓储返回跨 owner/患者的引用时，Provider 不会被调用。
- LIS 详情再次校验 owner、patient、provider、kind、opaque `reportId` 和 TTL；错误引用不能访问另一患者的 Provider 报告。

### 2. 多来源聚合与响应投影

- 默认目录同时读取 LIS、PACS、ECG；任一来源失败或响应包络异常时整批 fail-closed，不把来源失败伪装为空目录。
- Provider 报告号只用于服务端生成短期引用；PACS/ECG 的报告号不会因为出现在响应中就被保存成详情入口。
- 公开摘要只保留来源、标题、报告时间、状态和附件存在性；患者姓名、身份证、原始 Provider JSON、URL 和原始报告号不进入公共响应。
- Provider 文本、状态、来源、时间、列表上限和详情检测项都在 adapter/domain/API client 多层校验。

### 3. 附件存在性

- LIS `pdfUrlList` 只接受数组，数组元素必须是字符串；空数组或全空字符串不标记附件。
- PACS `reportPdfPath`、`reportImgPath` 和 ECG `pdfPath` 只接受字符串或 `null`/缺失；非空字符串才标记附件。
- 对象、布尔值、嵌套数组等未知结构不使用 JavaScript truthy 兼容，而是拒绝整条 Provider 结果并记录固定违规原因。
- `hasAttachment=true` 不是下载能力、资源授权或云影像可用性的证明；这些能力需要单独的短期资源引用、权限、审计和真机验收。

### 4. 页面、引用和并发

- 报告目录只把服务端返回的 `reportId` 放入详情入口；没有引用的摘要显示“详情暂未开放”，不使用数组索引或 Provider 报告号拼接 URL。
- 页面加载前清空上一位患者的目录和计数；患者切换、页面卸载、请求代际变化后，旧响应不能回写当前页面。
- 报告详情失败、引用失效或患者范围变化时清空标题、时间、检测项、附件标记和上一轮临床读模型。
- 首屏只渲染本次完整查询结果的有限批次；“加载更多”只是本地渲染窗口，不代表 Provider 分页或数据总数授权。

## 本地证据

| 范围 | 结果 |
| --- | --- |
| API 报告 service | 20 pass，0 fail，89 expect() |
| 众阳报告 adapter | 16 pass，0 fail，31 expect()；包含附件字段异常回归 |
| 报告 domain | 2 pass，0 fail，2 expect() |
| 小程序报告/API client 定向测试 | 12 pass，0 fail，74 expect() |
| adapter TypeScript 检查 | 通过 |

## 仍然关闭的门禁

以下证据尚未齐全，因此继续保持 `ZHONGYANG_REPORT_DIRECTORY_READY=false`、`ZHONGYANG_REPORT_DETAIL_READY=false`：

1. LIS/PACS/ECG 当前环境的脱敏成功、空结果、业务失败、超时和字段异常样例；
2. PACS/ECG 详情、影像资源和文件下载的短期授权、过期、审计与患者归属契约；
3. PEIS 体检报告的身份证最小使用、服务端归属和脱敏字段契约；
4. 报告解读的模型/知识版本、免责声明、内容审核和医疗结果审计；
5. 真实微信会话下页面、HTTP `traceId/requestId`、Provider 请求号和低敏日志的同链验收。

支付、医保、预约写入、取消、HIS 写回和旧 Python 服务仍不属于本轮变更范围。
