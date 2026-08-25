# 健康知识错误契约审计（2026-08-25）

## 发现与修正

健康知识只读路由已经注册，但此前三层错误契约没有完全同步：

- API 统一错误处理器返回 `health-knowledge-unavailable`、`health-knowledge-query-invalid`、`health-knowledge-not-found`；
- 小程序文案表没有这三个 code，会把健康内容未发布、查询参数错误和内容不存在都显示成泛化兜底；
- 公共 API 文档和错误码测试也没有登记它们。

本轮已补齐服务端事实、客户端稳定中文文案、公共 API 文档和测试，并增加
`pnpm error:contract:audit` 门禁，后续服务端新增公共错误码时如果漏同步客户端或文档会直接失败。

## 业务边界

这次修正只改善错误分类和用户提示，不改变健康知识的发布状态：没有正式审核 bundle 时，健康百科仍然 fail-closed；没有新增自测、BMI、血压、个体化用药、临床诊断或 Provider 转发能力。

错误码含义固定为：

| code | HTTP | 页面语义 |
| --- | ---: | --- |
| `health-knowledge-query-invalid` | 400 | 查询条件错误，不能当作空目录 |
| `health-knowledge-not-found` | 404 | 指定内容不存在，不能展示旧缓存详情 |
| `health-knowledge-unavailable` | 503 | 没有可用发布版本或发布窗口冲突，只允许重试 |

## 验证

| 检查 | 结果 |
| --- | --- |
| `bun test tools/error-contract-audit.test.mjs` | 3 pass / 0 fail |
| `bun test apps/api/src/app.test.ts` | 42 pass / 0 fail |
| `bun test apps/miniprogram/src/services/api-client.test.ts` | 26 pass / 0 fail |
| `pnpm --filter @hospital/miniprogram typecheck` | 通过 |
| `pnpm error:contract:audit` | 通过 |

本轮只修改新项目源码、测试和文档，没有修改旧 Python 服务、旧数据库、旧 Redis、线上进程或另一会话负责的众阳预约适配器。
