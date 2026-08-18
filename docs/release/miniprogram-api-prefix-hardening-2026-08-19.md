# 小程序 API 前缀门禁修复（2026-08-19）

## 结论

本次修复针对“刷新后仍请求旧地址或返回 404”的客户端配置边界。小程序现在只接受已经注册的
`/api/v1`、`/api/v2`；未知的本地缓存前缀不会被正则表达式当作可用版本继续拼接。

本次只修改本地原生小程序源码、测试和文档，没有修改旧 Python 服务、服务端 release、数据库、Redis、
反向代理或线上配置，也没有上传小程序线上包。

## 规则

- 本地 HTTP 地址的未知 `apiPrefix` 回退到 `/api/v1`。
- 公网 HTTPS 地址的未知 `apiPrefix` 回退到 `/api/v2`。
- 已知前缀会去掉首尾空白和一个末尾 `/`，避免出现 `/api/v2//health/live`。
- 其他格式（例如 `/api/v3`、`/api/v2/reports`）会被拒绝，不会被当作兼容版本使用。
- 新增 API 公共版本前，必须同时更新客户端允许列表、服务端反向代理、`docs/api-v2-public.md` 和真机验收记录。

## 实现位置

- `apps/miniprogram/src/services/api-client.ts`
  - `SupportedApiPrefix` 固定已注册版本；
  - `normalizeApiPrefix()` 负责缓存清理和环境回退；
  - `isAllowedApiPrefix()` 作为请求前的最终安全门禁。
- `apps/miniprogram/src/services/api-client.test.ts`
  - 覆盖已知版本、未知版本、路径穿透式前缀和本地/公网回退。

## 本地证据

提交 `d948d11`（`收紧小程序 API 版本前缀`）后完成：

- `pnpm --filter @hospital/miniprogram test`：127 项通过，1073 个断言；
- `pnpm --filter @hospital/miniprogram typecheck`：通过；
- `pnpm --filter @hospital/miniprogram build`：通过；
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过，14 个页面脚本和根文件完整；
- Biome 对本次源码和测试检查通过。

## 尚未证明的边界

本记录不代表真实微信设备、微信授权、患者 Provider、预约 Provider、支付、医保或 HIS 已经验收。
真实验收仍必须使用 `dist/build-info.json` 对应的完整 source revision，在有效微信会话下记录页面结果、
HTTP 状态、`requestId/traceId` 和服务端低敏日志。开发者工具的 `project.config.json` 属于本机工具配置，
即使它被工具自动改写，也不能替代运行包来源校验。
