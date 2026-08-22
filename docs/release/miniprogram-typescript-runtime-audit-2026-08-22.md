> 当前候选刷新（2026-08-22）：服务端 release 为 `0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；小程序运行包来源为 `171a8743185fb4ecc1696851662659c1a0ee7ebf`（提交 `171a874`）。本次主动登录 owner 校验修正已进入最新本地候选，真实真机证据仍待。

# 原生小程序 TypeScript 运行包审计（2026-08-22）
> 当前服务端发布基线（2026-08-22）：`0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；小程序来源为 `171a8743185fb4ecc1696851662659c1a0ee7ebf`。运行包不包含测试脚本。

> 当前候选：服务端 release `0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；小程序运行包来源
> `171a8743185fb4ecc1696851662659c1a0ee7ebf`（提交 `171a874`）。本文只记录源码、构建产物和门禁事实，
> 不代表微信真机、众阳 Provider、支付、医保或 HIS 业务已经验收。

## 审计结论

当前原生小程序已经完成 TypeScript 源码边界收口：

- `apps/miniprogram/src/` 没有业务 `.js`、`.jsx`、`.mjs` 或 `.cjs` 源文件；
- `apps/miniprogram/src/app.json` 注册 14 个页面，页面脚本均为对应的 `.ts` 文件；
- `apps/miniprogram/dist/` 只承载微信开发者工具运行包，不承载 TypeScript 源码或测试源码；
- 运行包中没有 `*.test.js`、`*.spec.js` 或 `*.ts`，并且存在 `services/single-flight.js`；
- `dist/build-info.json.sourceRevision` 与本候选完整来源一致：
  `171a8743185fb4ecc1696851662659c1a0ee7ebf`。

因此，微信开发者工具再次请求 `dist/services/single-flight.test.js` 时，问题属于旧增量索引、错误项目窗口或文件句柄竞争，
不能通过复制测试脚本进入运行包解决。正确恢复方式仍是关闭旧真机调试、打开
`E:\__Super_Core__\hospital-platform\apps\miniprogram`、普通编译并重新生成二维码。

## 当前验证证据

| 检查项 | 结果 |
| --- | --- |
| 小程序注册页面 | 14 个，迁移清单审计通过 |
| 小程序 TypeScript 类型检查 | 通过 |
| 小程序测试 | `217 pass / 0 fail / 1624 expect()` |
| 小程序运行包构建 | 通过；开发者工具占用时原子发布会安全保留上一份完整 `dist/` |
| 运行包验证 | 通过；14 个页面入口完整 |
| 运行包测试脚本 | `0` 个 `*.test.js` / `*.spec.js` |
| 全仓迁移、Provider、日志、文档、Biome 门禁 | 通过 |

## 边界与后续

TypeScript 收口只证明工程输入和微信运行包边界，不代表业务域已经真实验收。当前仍按以下顺序取得真机证据：

1. 微信登录和会话恢复；
2. 患者目录同步与显式切换；
3. 我的挂号、爽约记录和门诊费用只读；
4. 普通资料读写；
5. 报告、病历、患者新增/绑定、二维码、支付、医保和 HIS 回写按各自 contract 单独处理。

没有页面结果、客户端 requestId/traceId 和服务端低敏日志同链证据时，不能把模拟器、二维码生成或本地测试写成真机业务完成。

本次审计没有修改旧项目、旧 Python 服务、数据库、Redis 或 Provider 配置。
