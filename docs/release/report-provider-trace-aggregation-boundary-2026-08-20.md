# 报告目录多 Provider 追踪号聚合边界（2026-08-20）

## 结论

本轮修复了报告目录在并行读取 LIS、PACS、ECG 时的内部追踪号聚合缺口。报告 Provider gate 仍保持关闭，
本轮没有调用真实 Provider、修改线上配置、写入 MySQL/Redis、修改旧 Python 服务或重启任何旧服务。

## 发现的问题

报告 adapter 原先把三路 Provider 的 `requestId` 直接用逗号拼接后写入一个 `trace.requestId`：

```text
request-1,request-2,request-3
```

单个 Provider 请求号分别符合内部 opaque 标识的 128 字符上限时，拼接结果仍可能超过上限。报告 service
随后会对 trace 做第二次运行时校验，因而可能把“Provider 已经成功返回的报告目录”误判为
`provider-response-invalid`。这会造成页面失败、成功链缺失和日志关联断裂，是业务逻辑问题，不是单纯的日志格式问题。

## 修复后的契约

- `requestId` 保留第一条 Provider 请求号，继续兼容现有单请求日志检索和单请求调用方；
- 多 Provider 聚合时，完整请求号放在 `requestIds` 数组中，每一项单独通过 opaque 标识校验；
- `requestIds` 必须非空，最多 8 项，且必须包含兼容主字段 `requestId`；
- 日志同时保留低敏 `providerRequestId` 和有界 `providerRequestIds`，不写入 Provider 原文、患者字段、凭证或
  加密报文；
- 单一来源查询不额外增加 `requestIds` 字段，避免无必要地改变既有内部读模型形状；
- 报告目录任一路 Provider 失败仍然整批失败，不把追踪号修复误作 partial-success 或重试策略。

## 代码与注释位置

| 位置 | 责任 |
| --- | --- |
| `packages/domain/src/ports.ts` | 说明单请求主 ID 与多 Provider 有界列表的区别 |
| `packages/domain/src/external-trace.ts` | 统一校验请求号列表上限、成员形状和主 ID 归属 |
| `packages/adapters/src/zhongyang-reports.ts` | 生成兼容主 ID与完整有界请求号列表 |
| `apps/api/src/modules/reports/service.ts` | 以低敏字段投影日志，不暴露原始响应 |

## 本地证据

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @hospital/domain test` | 52 项通过，104 个断言 |
| `pnpm --filter @hospital/adapters test` | 102 项通过，221 个断言 |
| `pnpm --filter @hospital/api test` | 183 项通过，770 个断言 |
| 新增报告 service 定向回归 | 覆盖三路 70 字符请求号不拼接超长、日志同时保留主 ID和完整列表 |
| domain trace 回归 | 覆盖空列表、9 项越界、控制字符和主 ID 不在列表 |

## 未完成与停止条件

这次修复只保证内部读模型和日志关联在代码层有明确边界，不能证明报告 Provider 已经可用。继续开放报告前仍必须取得：

1. 脱敏的 LIS/PACS/ECG 成功、空结果、业务拒绝和暂时失败样例；
2. Provider endpoint、权限、请求头/签名、分页和 requestId 语义确认；
3. 当前服务端 release 的公网 HTTP、页面患者上下文和低敏日志三层证据；
4. 真机切换就诊人后报告不会跨患者，且详情引用和过期行为可复现验收。

在上述证据齐全前，不打开 `ZHONGYANG_REPORT_DIRECTORY_READY`、`ZHONGYANG_REPORT_DETAIL_READY`，不扩展附件、
影像/心电详情、支付、医保或 HIS 回写。
