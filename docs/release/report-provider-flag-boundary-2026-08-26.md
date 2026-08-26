# 报告 Provider 异常标记边界复核（2026-08-26）

## 结论

本轮只收紧新项目已有的检查报告只读适配器，没有注册新的临床 API，没有扩大报告来源、附件下载或自动解读能力，
也没有修改旧 Python 服务、旧数据库、Redis、线上进程或预约适配器。

## 发现的问题

LIS 目录和明细中的异常标记来自 Provider。原实现对 `criticalFlag`、`flagGerm` 和 `flagCritical` 使用宽松的
truthy/falsy 解释：对象、数组和未知字符串可能被当成 `false`，于是损坏响应会被展示成正常报告，或丢失明细的
critical 状态。这不是普通格式问题，而是临床状态被错误改写。

## 处理规则

- 允许明确的 boolean、0/1 数字和对应字符串，以兼容旧端数值字段及部分 JSON 序列化形态。
- 字段缺失或 null 表示该标记没有提供；空字符串、未知数字、对象和数组统一拒绝。
- 目录和详情都返回 `ProviderRequestError(responseInvalid=true)`，不生成部分成功读模型。
- 目录必须同时校验 `criticalFlag` 与 `flagGerm`，不能因为第一个标记已经为 true 就短路跳过第二个坏字段。

## 回归证据

- `pnpm --filter @hospital/adapters test src/zhongyang-reports.test.ts`：20 pass / 0 fail / 44 expect
- 覆盖目录异常标记对象、未知字符串和详情异常标记数组。
- 运行时仍保持报告来源和详情能力的既有边界；C 批次其它临床入口仍等待正式 Provider contract，不因本次修复开放。

后续仍需按 A 批次取得报告目录/详情的同一运行包真机证据；本地 adapter 测试不能替代页面、客户端 requestId、
服务端日志和 Provider requestId 的同链验收。
