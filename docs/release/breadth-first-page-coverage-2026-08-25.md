# 广度优先页面迁移覆盖证据（2026-08-25）

## 结论

本轮先解决“旧端还有哪些入口、每个入口现在落在哪里”的覆盖问题，没有继续扩大支付、医保、患者绑定、临床问卷或外部 WebView 能力。

旧仓库 `G:\\fuck\\hospital\\hospital-app\\src` 实际扫描到 64 个 Vue 页面；新端逐页台账已覆盖全部 64 个页面，并由 `pnpm migration:audit` 同时核对旧仓库实际文件、Markdown 迁移矩阵和 TypeScript 落点目录。

| 分类 | 数量 | 含义 |
| --- | ---: | --- |
| `replaced` | 7 | 已由原生页面或等价静态能力替换，不代表旧端所有隐含 provider 能力都存在 |
| `partial` | 12 | 已有安全只读/静态子集，详情、写入、支付或外部回写仍关闭 |
| `blocked-provider` | 6 | 等待众阳/HIS/云健康正式请求响应、字段白名单和错误样例 |
| `blocked-clinical` | 17 | 等待题库、阈值、医疗内容或问卷的版本与临床审核 |
| `blocked-payment` | 7 | 等待金额守恒、支付状态机、查单、医保和 HIS 回写 contract |
| `blocked-patient-contract` | 4 | 等待患者绑定、协议、地址或签名的归属、授权和撤回规则 |
| `blocked-external` | 10 | 等待 HTTPS allowlist、短期引用、外部主体授权或内容审核 |
| `excluded` | 1 | 旧端开发辅助页，不进入生产小程序 |
| **合计** | **64** | 每个旧页面只有一个明确落点 |

## 机器门禁

- 页面落点台账：[`apps/miniprogram/src/services/legacy-page-catalog.ts`](../../apps/miniprogram/src/services/legacy-page-catalog.ts)
- 页面台账回归：[`apps/miniprogram/src/services/legacy-page-catalog.test.ts`](../../apps/miniprogram/src/services/legacy-page-catalog.test.ts)
- 总迁移审计：`pnpm migration:audit`
- 旧端逐页解释：[`../migration/legacy-page-matrix.md`](../migration/legacy-page-matrix.md)

本轮门禁输出：

```text
Legacy page inventory passed: 64 old page(s) match the migration matrix
Native legacy page catalog passed: 64 page(s)
partial=12, blocked-external=10, replaced=7, excluded=1,
blocked-clinical=17, blocked-payment=7, blocked-provider=6,
blocked-patient-contract=4
```

## 下一步原则

1. 先从 12 个 `partial` 页面中完成可验证的只读闭环：患者、预约历史/目录、报告目录、门诊费用和普通资料分别保存页面、HTTP requestId、服务端低敏日志三层证据。
2. 新 Provider 文档到达后，按业务域完成 `contract → adapter → domain → API → 小程序 → 日志 → 验收`，不把一个域的字段复用到另一个域。
3. 支付、医保、二维码、患者新增绑定、问卷提交、WebSocket、外部 WebView 和 HIS 写回继续保持关闭；状态页存在只代表入口可解释，不代表业务已完成。

本轮只修改新项目代码与文档，不修改旧 Python 服务、旧数据库、Redis 或线上运行包。
