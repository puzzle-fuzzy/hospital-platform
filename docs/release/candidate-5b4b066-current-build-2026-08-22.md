# 当前小程序候选 `5b4b066` 构建与真机准入记录（2026-08-22）

> 本记录是当前小程序运行包入口。它证明运行包来源和开发者工具恢复边界，不代表微信、众阳 Provider、真机业务、支付或医保已经验收。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `9f479c9a` |
| 小程序客户端 | `5b4b066` |
| 小程序构建来源 | `5b4b0667d76ce443290116352d27f5eb94eba49c` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面入口 | 14 个 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在，符合运行包边界 |
| 真机业务状态 | 尚未取得当前候选的页面、客户端 HTTP、服务端日志三层同链证据 |

## 构建与运行包证据

本候选已通过：

- `pnpm --filter @hospital/miniprogram typecheck`；
- `pnpm --filter @hospital/miniprogram build`；
- `pnpm --filter @hospital/miniprogram runtime:verify`；
- 小程序测试 `207 pass / 0 fail / 1553 expect()`。

构建配置排除 `src/**/*.test.ts` 和 `src/**/*.spec.ts`，发布前还会扫描 staging 运行目录，发现测试脚本或缺失相对模块引用就直接失败。
微信运行时只需要 `dist/services/single-flight.js`，不应通过复制测试脚本“修复”真机错误。

## `single-flight.test.js` ENOENT 恢复

真机调试曾报告：

```text
ENOENT: no such file or directory, open
E:/__Super_Core__/hospital-platform/apps/miniprogram/dist/services/single-flight.test.js
```

本候选重新构建后的事实是：`single-flight.js` 存在，`single-flight.test.js` 不存在，运行包中测试/规格脚本数量为 0，运行时代码没有对测试文件的引用。
该错误属于开发者工具旧增量模块索引或旧真机调试会话残留，不是当前业务模块缺失。

恢复顺序固定为：

1. 关闭当前“真机调试”会话；
2. 只关闭并重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram\`，不要打开旧 `mp-weixin`；
3. 确认公共配置的 `miniprogramRoot` 为 `dist/`；
4. 先执行一次普通编译，确认 14 个页面成功分析；
5. 从当前候选重新生成二维码，再开始扫码验收。

不得手工创建 `single-flight.test.js`，不得继续使用旧二维码，也不得为刷新开发者工具缓存重启或修改旧 Python 服务。

## 验收停止条件

本记录不把构建成功、二维码生成或模拟器结果当作真机业务完成。后续必须在同一候选上取得页面结果、客户端 requestId/traceId 和服务端 Pino 低敏事件；
微信登录、患者同步/切换、预约历史、门诊费用和报告目录按各自 contract 逐项验收。支付、医保、退款、预约写入和 HIS 回写继续最后处理。
