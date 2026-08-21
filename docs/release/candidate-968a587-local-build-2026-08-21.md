# 当前小程序候选 `968a587` 本地构建记录（2026-08-21）

> 本文记录当前仓库提交 `968a587158289da6a482b3614907bde0a5ad9581` 的本地小程序运行包。
> 它尚未上传微信开发者工具线上代码包，也不代表真实微信登录、Provider 或真机业务已经验收。

## 本轮变更

修正已验证会话后的业务错误门禁：患者未选择、临床映射缺失、报告/挂号/门诊费用 Provider 暂时失败等业务读取错误不再把有效会话错误降级为 `unavailable`，用户仍可进入“更换就诊人”；明确 `401`、会话代际变化和恢复后无 token 继续按各自门禁处理。支付、医保、预约写入和 HIS 写入保持关闭。

## 构建证据

| 检查 | 结果 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `968a587` |
| 小程序构建来源 | `968a587158289da6a482b3614907bde0a5ad9581` |
| `pnpm --filter @hospital/miniprogram test` | 194 项通过，0 项失败，1479 个断言 |
| `pnpm --filter @hospital/miniprogram typecheck` | 通过 |
| `pnpm exec biome check`（本轮源文件） | 通过 |
| `pnpm --filter @hospital/miniprogram build` | 通过；14 个 `app.json` 页面脚本已发布 |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过；来源为 `968a587158289da6a482b3614907bde0a5ad9581` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | 0 个 |
| 旧 Python 服务、线上配置、MySQL、Redis | 未修改、未重启 |

## 真机前操作

微信开发者工具若仍报 `single-flight.test.js` ENOENT，应停止当前真机调试，关闭并重新打开
`E:\__Super_Core__\hospital-platform\apps\miniprogram\`，确认 `miniprogramRoot` 为 `dist/`，先普通编译，再生成新二维码。
不要在 `dist/` 手工创建测试脚本；如果仍有旧增量模块索引，按 [`miniprogram-runtime-enoent-recovery-2026-08-20.md`](miniprogram-runtime-enoent-recovery-2026-08-20.md) 恢复。

## 未完成门禁

微信登录、患者同步、多就诊人切换、预约历史/爽约/门诊费用的真机三层证据仍待人工采集；报告详情、二维码、患者绑定、支付、医保、退款和 HIS 写回继续保持关闭。
