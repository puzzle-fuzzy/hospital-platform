# 预约 Provider 包络错误分类修正（2026-08-24）

> 本记录对应本地提交 `4404c556`。本次只修改新项目的预约 adapter、回归测试和 Provider 契约文档，未部署到服务器，未修改旧 Python 服务、数据库或 Redis。

## 1. 修正原因

预约 adapter 原来会在包络包含任意标量非成功 `code` 时，把响应分类为
`provider-request-rejected`。但如果 Provider 同时返回了错误类型的 `success` 字段，
例如 `success: "false"`，这首先是响应格式不符合合同，不能把字符串当成布尔失败事实。

错误分类不能只影响提示语：API 会根据 `responseInvalid` 区分“外部服务拒绝”与“外部响应异常”，
日志也依靠这个稳定事实做聚合；分类错误会让排障人员采取错误的重试或配置处理路径。

## 2. 当前冻结规则

| Provider 包络事实 | adapter 结果 | 允许的页面语义 |
| --- | --- | --- |
| `success=false` | `responseInvalid=false` | 外部服务明确拒绝 |
| 没有 `success`，且 `code` 是标量非成功码 | `responseInvalid=false` | 保留 Provider 业务拒绝事实，不猜具体错误码含义 |
| `success` 存在但不是布尔值 | `responseInvalid=true` | 外部响应格式异常 |
| `success` 与 `code` 缺少已确认成功事实 | `responseInvalid=true` | 外部响应格式异常，不能显示合法空列表 |
| `success=true` 或已确认 `code=0/0000` 且 `data=[]` | 成功空结果 | 只能显示“暂无记录” |

当前没有完整的 Provider 错误码表，因此未知码不产生重试、自动换人、支付或写入行为；
它只作为低敏错误事实保留在既有错误链中。

## 3. 验证结果

- `packages/adapters/src/zhongyang-appointments.test.ts`：19 项通过、43 个断言；新增错误类型 `success` 与非成功 `code` 的回归覆盖。
- `pnpm --filter @hospital/adapters typecheck`：通过。
- 全仓 `pnpm check`：架构、迁移、Provider 文档、647 个文档链接、81 个日志事件、Biome、工具 58/58、9 个 workspace 类型检查/测试/构建均通过；小程序 238/238 通过。
- `dist/` 运行包未因本次服务端 adapter 修正改变；当前小程序候选随后更新为 `acfacc830010ea993dfdaefeae71ad3bc8c407c0`，但仍未上传微信。

## 4. 发布边界

线上服务端当前仍是 `8eb51b5f`，本地 `4404c556` 尚未进入线上；因此本记录不能作为公网或真机业务验收证据。
后续若发布新 API 候选，必须重新执行依赖 readiness、旧 Python `8001` 共存、错误码回归和预约历史双范围的
Provider/HTTP/页面同链取证。支付、医保、预约写入、取消和 HIS 回写继续保持关闭。
