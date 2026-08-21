# 小程序当前候选 `13b86a5` 本地构建记录（2026-08-21）

> 本记录对应当前本地运行包。服务端配套线上 release 已更新为 `002acc1be5cdd1b16c2c249f5dbbf9f7c65dbd10`，小程序仍需在正确项目中重新普通编译；本记录不代表微信、Provider 或真机业务已经验收。

## 1. 候选边界

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `002acc1be5cdd1b16c2c249f5dbbf9f7c65dbd10` |
| 小程序客户端 | `13b86a5` |
| 小程序构建来源 | `13b86a5a400ca0ccbee67abdfed726476a4749d4` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面入口 | 14 个 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `single-flight.js` | 存在 |
| `single-flight.test.js` | 不存在，符合运行包边界 |

## 2. `single-flight.test.js` ENOENT 复核

针对微信开发者工具报告的：

```text
ENOENT: no such file or directory, open
E:/__Super_Core__/hospital-platform/apps/miniprogram/dist/services/single-flight.test.js
```

当前构建已通过 `tsconfig.build.json` 排除测试源码，发布前又通过文件级门禁拒绝测试运行脚本；因此不能把测试脚本复制到 `dist/` 充当修复。当前复核结果如下：

- `pnpm --filter @hospital/miniprogram build` 通过；
- `pnpm --filter @hospital/miniprogram runtime:verify` 通过；
- `dist/services/single-flight.js` 存在；
- `dist/services/single-flight.test.js` 不存在；
- `dist/` 中 `*.test.js` / `*.spec.js` 数量为 0。

该错误对应开发者工具旧增量模块索引或旧真机调试会话。重新编译前应关闭旧真机调试，重新打开
`E:\__Super_Core__\hospital-platform\apps\miniprogram\`，确认公共配置的 `miniprogramRoot` 为 `dist/`，先执行普通编译，再生成新的真机二维码。

## 3. 当前验收边界

真机验收必须同时记录页面结果、客户端 `/api/v2/` 请求及 requestId/traceId、服务端低敏同链事件。没有三层证据时，微信登录、患者同步、显式患者切换、预约历史、门诊费用和普通资料均只能标记为待验收。

支付、医保授权、退款、预约写入、患者绑定、报告 Provider 详情和 HIS 回写继续保持关闭；旧 Python 服务、线上数据库和 Redis 不因本地小程序构建而修改或重启。
