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

实现提交 `d948d11`（`收紧小程序 API 版本前缀`）并补充真实请求回归提交
`93a3c72`（`补充小程序 API 前缀真实请求回归`）后完成：

- `pnpm --filter @hospital/miniprogram test`：128 项通过，1075 个断言；
- `pnpm --filter @hospital/miniprogram typecheck`：通过；
- `pnpm --filter @hospital/miniprogram build`：通过，运行包来源为 `93a3c720dc137162ff469ec745359775b08f84ab`；
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过，14 个页面脚本和根文件完整；
- Biome 对本次源码和测试检查通过。

新增回归直接 mock 微信请求层，验证同一个旧缓存 `/api/v999` 在公网 HTTPS 地址拼成
`/api/v2/health/live`，在本地 HTTP 地址拼成 `/api/v1/health/live`；它覆盖实际 URL 生成路径，
不只验证前缀辅助函数。

## 开发者工具复核

本地构建完成后，在微信开发者工具的 `miniprogram` 项目中执行了一次普通编译：

- 资源根目录仍为 `dist/`，编译日志显示 `Compile json files of 14 pages`；
- 编译完成，调试器显示 `Errors: 0`，仅保留微信基础库提示；
- 真机调试二维码已重新生成，工具显示有效期至 `8/19 00:45`；
- 当前仍没有手机连接、微信会话或真实业务请求，因此不增加真机业务证据。

模拟器只证明运行包能够加载页面和静态资源。登录、患者显式切换、预约历史、门诊费用和服务端日志
仍必须由手机扫码后逐项触发，并使用同一 source revision 交叉核对。

## 尚未证明的边界

本记录不代表真实微信设备、微信授权、患者 Provider、预约 Provider、支付、医保或 HIS 已经验收。
真实验收仍必须使用 `dist/build-info.json` 对应的完整 source revision，在有效微信会话下记录页面结果、
HTTP 状态、`requestId/traceId` 和服务端低敏日志。开发者工具的 `project.config.json` 属于本机工具配置，
即使它被工具自动改写，也不能替代运行包来源校验。
