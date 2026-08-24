> 当前发布基线（2026-08-24）：线上服务端 release 为 `28a5c0c131794ce9dcc5f94bd3809402188ac87a`；当前小程序运行包来源为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本文下方旧候选只作历史追溯，报告 Provider 目录/详情 gate 仍关闭。

# 报告只读迁移审计（2026-08-22）

> 当前候选更新（2026-08-24）：服务端 release 为 `28a5c0c131794ce9dcc5f94bd3809402188ac87a`，小程序运行包来源为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本文下方的 `171a874`、`0e2a366e` 和历史测试数字保留为 2026-08-22 追溯证据，不作为当前验收依据；当前报告 Provider 目录/详情 gate 仍关闭，当前候选尚无 Provider 或真机三层业务证据。

本文本轮仅补充当前候选边界，不修改旧 Python 项目、旧服务、线上反向代理、MySQL、Redis 或众阳 Provider 自动化采集。

## 审计范围

本次以当前候选小程序源码 `13f597ea9ee3f65b9be858117826d948339d904a` 和服务端 release
`28a5c0c131794ce9dcc5f94bd3809402188ac87a` 为准，复核旧端报告查询页的真实请求链、新端报告目录/详情
contract、患者范围门禁、Provider 字段投影和页面入口。审计只读，不修改旧 Python 项目、旧服务、线上
数据库或 Redis，也没有打开报告 Provider gate。

## 旧端真实能力与新端边界

旧端 `hospital-app/src/pagesB/health/report_query.vue` 实际按患者类型在四类 Provider 来源之间切换：

| 来源 | 旧端路径 | 旧端行为 | 当前新端判断 |
| --- | --- | --- | --- |
| LIS 检验 | `/msun-middle-business-lis/v1/lis-reports-filter` | 展示原始患者字段、检验项目、异常摘要和 `reportId` | 已建立安全目录摘要；只有服务端短期 opaque 引用存在时才允许 LIS 详情 |
| PACS 影像 | `/msun-middle-business-pacs/v1/exclude-privacy-patient-reports` | 展示影像原始对象，可携带报告/图片地址 | 只保留目录摘要；不保存 Provider 报告号，不开放详情或下载 |
| ECG 心电 | `/msun-middle-business-ecg/v2/ecg-reports` | 展示心电指标、诊断和原始报告号 | 只保留目录摘要；不开放详情或下载 |
| PEIS 体检 | `/msun-peis-app-peis-new/v1/find-report-list-for-wechat` | 使用完整身份证号和院区号查询，详情对象可进入本地缓存 | 暂不接入；缺少身份证最小使用、患者归属、脱敏字段和审计 contract |

旧端还把非 LIS 报告完整对象写入本地 storage，并把 `pdfUrl`、外部影像地址、Provider 报告号带入页面。
这类实现不能直接迁移：文件地址不是授权，Provider 报告号也不是患者范围授权凭证。

## 当前新端已确认的正确逻辑

1. 小程序只提交内部 opaque `patientId`；服务端先按当前 owner 解析 `his-patient` Provider 映射，Provider
   患者号只在 adapter 请求帧内存在。
2. 未指定 `kind` 时 LIS、PACS、ECG 三个目录请求必须整体成功。任一来源失败都不能把部分结果伪装成完整目录。
3. Provider 返回先经过 adapter 白名单投影，再由 domain/service 二次运行时校验；非法时间、来源错配、附件
   字段异常、重复报告号和超量结果均整批 fail-closed。
4. 公共目录只返回来源、标题、报告时间、状态、附件存在性和可选 opaque `reportId`，不返回患者姓名、身份证、
   Provider 患者号、原始报告号或文件 URL。
5. LIS 详情引用同时绑定 owner、patient、reportId 和 TTL；详情页发起请求前、响应回写前都重新确认当前就诊人和
   session generation。PACS/ECG 没有详情 contract 时不会因为存在原始报告号而放开详情。
6. 报告目录加载失败会清空患者卡片、报告列表、总数和本地加载更多状态，不把 Provider 故障显示成“暂无报告”。
   详情失败也会清空上一轮检测项、时间和附件状态。
7. 当前小程序只在本地对已经取得的目录做每次 10 条的渲染窗口；这不是 Provider 分页，也不改变服务端总数。

## 当前仍然关闭的能力

- 真实报告 Provider 公网/真机验收：尚未取得当前候选的 Provider、客户端 requestId 和服务端低敏日志三层证据。
- PEIS 体检报告：必须先冻结身份证使用范围、患者归属、最小返回字段、错误语义和脱敏日志规则。
- PACS/ECG 详情和影像资源：必须单独设计短期授权、过期、内容安全、下载审计和失败语义。
- LIS 附件下载：当前只有 `hasAttachment` 存在性提示，不返回地址、不提供下载授权。
- 报告解读：必须独立定义知识/模型版本、免责声明、内容审核和结果审计，不能从报告目录顺手开放。

## 本次代码证据

针对当前报告链路执行了以下测试：

- domain 报告边界：`5 pass / 0 fail / 11 expect()`；
- 众阳报告 adapter：`18 pass / 0 fail / 35 expect()`；
- API 报告 service：`25 pass / 0 fail / 108 expect()`；
- 小程序 API client：`21 pass / 0 fail / 100 expect()`；
- 小程序静态验收：`112 pass / 0 fail / 1279 expect()`。

测试覆盖时间窗口、三来源聚合、响应包络、字段投影、资源上限、owner/patient/TTL 详情引用、页面状态清理、
过期/错患者事件和运行包页面注册边界。

## 下一步准入顺序

1. 先取得 LIS/PACS/ECG 脱敏成功、空结果、业务失败和字段异常样例，并使用专用账号完成 Provider 只读验收。
2. 对 LIS 详情使用同一账号取得目录到详情的完整 trace/requestId 链，再决定是否打开详情 gate。
3. 在报告目录和详情稳定后，单独设计 PEIS、附件资源和报告解读 contract；不得复用当前 LIS 详情接口。
4. 只有 Provider、公网 API、小程序页面和低敏日志三层证据齐全后，才把报告能力标记为真实业务完成。

本审计没有改变旧服务、旧服务日志、线上配置、数据库、Redis 或当前报告 gate。

## 2026-08-25 当前代码准入复核

在继续筛选下一个可安全迁移的只读能力时，重新运行了当前仓库的报告逻辑测试：

- API 报告 service：`25 pass / 0 fail / 108 expect()`；
- 众阳报告 adapter：`19 pass / 0 fail / 41 expect()`。

本次测试再次确认 owner/患者范围、短期 opaque 详情引用、TTL、三来源完整性、未知字段、Provider 包络失败、
报告时间和低敏日志边界均保持 fail-closed。它们是代码质量证据，不是 Provider 真实业务证据：当前仍没有当前
候选的 Provider 成功/空/拒绝/暂时失败脱敏样例，也没有同一账号配对的客户端 requestId、服务端日志和真机页面证据。

因此报告目录/详情 gate 继续关闭，不因测试通过而打开真实 Provider，不修改旧项目、旧服务、服务器、数据库、Redis
或并行会话负责的众阳预约适配器。下一步仍是取得专用账号的四类脱敏样例和完整三层链路，再决定是否开放目录；LIS
详情、PACS/ECG、PEIS、附件和报告解读继续分开处理。
