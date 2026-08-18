# 小程序报告目录与详情只读响应边界（2026-08-19）

## 结论

本轮收紧原生小程序报告目录和 LIS 详情的 JSON 接收边界，不打开报告 Provider gate，不修改 Provider、MySQL、Redis、
旧 Python 服务或线上服务端 release，也不扩展影像/心电详情、附件下载、分享和复诊能力。

此前小程序报告目录只检查 `total === items.length`，详情页则直接消费 TypeScript 泛型，并把缺失检测项降级为空数组。
这会让代理错配、未知枚举、未脱敏/超长文本、错误报告引用或损坏检测项进入临床页面。现在 API client 在收到 JSON 后：

- 报告目录逐条校验 `kind`、`status`、标题、报告时间、附件标记和可选 opaque `reportId`；
- `reportId` 只能出现在当前已有 LIS 详情 contract 的检验报告上，必须唯一且符合安全文本边界；
- 报告详情必须是 `laboratory`，响应 `reportId` 必须精确等于本次请求引用，不能把另一条详情写入当前页面；
- 详情检测项逐条校验名称、结果、单位、参考范围和 `normal/high/low/critical/unknown` 枚举；
- 所有列表总数、成功包络、附件布尔值和可选字段都经过运行时校验，随后只重新投影公共字段；
- 任一条记录异常都整批返回 `provider-response-invalid`，不能过滤坏行或把坏详情伪装成空报告。

## 分层边界

小程序校验只负责防止损坏 JSON 进入渲染层，不能替代服务端的 owner、patient、Provider 映射和短期引用 TTL 校验。
`reportId` 是服务端生成的短期 opaque 详情引用，不是 bearer token，也不是患者授权；客户端响应中的引用匹配只是展示隔离，
服务端仍是最终授权边界。

报告目录仍采用已有的本地渲染分批；这不是 Provider 分页。影像和心电目前只显示安全摘要，不能因为目录出现 `hasAttachment`
就推导出附件下载或详情已经迁移。

## 本地证据

- `api-client.test.ts` 新增报告目录包络/总数/枚举/引用和报告详情引用匹配/检测项校验回归；
- 小程序定向测试 `150` 项通过、`1195` 个断言通过，TypeScript 类型检查通过；
- 代码提交为 `4d56496`，已推送 `origin/main`；用户已有的 `apps/miniprogram/project.config.json` 未触碰、未暂存、未提交。

## 未完成项

本轮没有取得新的 Provider 报告目录/详情成功样例、真机页面、当前服务端 trace 或日志三方关联证据，不能把本地响应门禁
宣称为真实报告业务验收。报告 Provider gate、影像/心电详情、附件资源、支付、医保和 HIS 回写继续保持关闭。
