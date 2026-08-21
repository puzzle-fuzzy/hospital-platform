# 当前小程序候选 `f488c6f` 本地构建记录（2026-08-21）

> 本文是当前真机前置构建的唯一候选入口：服务端配套 release 为 `c8eef370`，小程序运行包来源为
> `f488c6f3270514af10b19fdf3c45a47519e1736b`。该运行包尚未上传微信开发者工具线上代码包，
> 也不代表微信登录、Provider 或真机业务已经验收。

## 1. 构建与发布边界

| 项目 | 值 |
| --- | --- |
| 服务端 release | `c8eef370c82e358205ee032af41ba2b23576af06` |
| 小程序客户端 | `f488c6f3` |
| 小程序构建来源 | `f488c6f3270514af10b19fdf3c45a47519e1736b` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 服务端状态 | 已部署到新 API；旧 Python `8001` 保持共存 |
| 小程序状态 | 本地构建完成，尚未上传线上 |

本候选只锁定“服务端运行版本 + 小程序来源指纹”的配套关系。它不把本地构建、生产 readiness 或
页面入口数量误写成真实业务成功，真实验收仍需要当前二维码、页面结果、客户端请求和服务端低敏日志同链。

## 2. 本地构建证据

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @hospital/miniprogram test` | 197 项通过，0 项失败，1493 个断言 |
| `pnpm --filter @hospital/miniprogram typecheck` | 通过 |
| `pnpm exec biome check` | 通过 |
| `pnpm --filter @hospital/miniprogram build` | 通过；14 个 `app.json` 页面脚本已发布 |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过；来源为 `f488c6f3270514af10b19fdf3c45a47519e1736b` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | 0 个 |

`single-flight.test.js` 是测试源码，不是生产运行模块。开发者工具再次报告 ENOENT 时，必须清理旧增量索引并
重新普通编译；不能把测试脚本复制到 `dist/`，否则会掩盖构建边界问题。

## 3. 真机前操作顺序

1. 关闭旧的 `mp-weixin` 或失效的同名开发者工具窗口。
2. 重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram\`，确认 `miniprogramRoot=dist/`。
3. 普通编译后核对 `dist/build-info.json.sourceRevision` 等于本表来源指纹。
4. 确认 14 个页面入口齐全，且 `dist/` 不含测试脚本。
5. 重新生成二维码，再按当前真机证据模板采集微信登录、患者目录、显式切换和只读业务链。

本地构建和真机调试入口准备期间，不修改旧 Python 服务、旧域名、生产 MySQL、Redis 或并行会话维护的众阳
自动化代码；任何 Provider、支付、医保、HIS 和预约写入能力继续遵守各自 fail-closed 门禁。
