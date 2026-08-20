# Pino 深层敏感字段脱敏审计（2026-08-21）

## 发现

观测包原先只配置了顶层字段和一层 `*.field` 通配路径。Pino 10 当前使用的
`@pinojs/redact` 不支持 `**.field` 无限递归路径，因此形如下面的 Provider 结构会绕过原有路径：

```json
{
  "response": {
    "data": {
      "patient": {
        "phone": "患者手机号"
      }
    }
  }
}
```

这不是理论问题：本地合成探针已确认三层对象中的 `phone`、`patId` 和数组内的
`idCardNo` 会原样进入 JSON 日志。原始 Provider 响应仍然禁止业务代码直接记录，
但日志库必须对误传的结构提供最后一道门禁。

## 修正

`packages/observability/src/index.ts` 继续使用 Pino 的原生 `redact` 快速处理常见路径，
并增加 Pino 官方 `hooks.streamWrite` 输出钩子：

1. Pino 先生成单行 JSON；
2. 输出钩子递归遍历 JSON 对象和数组；
3. 命中统一敏感字段名时替换为 `[REDACTED]`；
4. 普通日志、child bindings 和 serializer 产生的结构统一从同一出口输出。

该钩子只处理已经序列化的 JSON，不修改业务传入对象，也不改变业务错误码或响应内容。
解析失败时保留原 chunk 仅作为 Pino 合法 JSON 输出的防御性分支；这不能替代业务层
禁止记录 request body、Provider 原始报文、患者号和凭证的规则。

## 本地证据

- `pnpm --filter @hospital/observability test`：5 pass，0 fail，13 expect calls。
- `pnpm --filter @hospital/observability typecheck`：通过。
- `pnpm exec biome check packages/observability/src/index.ts packages/observability/src/index.test.ts`：通过。
- 独立 Pino JSON 探针：三层 `phone`、`patId`、数组内 `idCardNo` 和 child binding 中的手机号均输出为 `[REDACTED]`，合成原值不在最终日志中。

## 运行与发布边界

本次只修改新项目观测包和测试，不修改旧 Python 项目、不重启服务器、不改变线上 release，
也没有把任何真实患者数据写入仓库或测试。上线前仍需重新构建新 API、执行隔离 smoke，
并在不影响旧 `8001` 服务的前提下按现有 release runbook 原子切换；切换后要用 journald
或服务实际日志做一次低敏字段抽样，确认线上产物使用了本修正。
