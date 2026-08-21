# 当前小程序候选构建记录（`4e82313`，2026-08-21）

本候选由提交 `4e823137b7180390209614ef677c5a71f9c465be` 生成。它包含患者范围页面会话组合代际门禁和报告详情 owner/患者目录复核；服务端、旧 Python 服务、线上配置、MySQL 和 Redis 均未因本次本地构建而修改或重启。

| 基线项目 | 值 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `4e82313` |
| 小程序构建来源 | `4e823137b7180390209614ef677c5a71f9c465be` |
| 运行包目录 | `apps/miniprogram/dist/` |

## 本地验证

| 项目 | 结果 |
| --- | --- |
| 小程序全量测试 | 176 项通过，0 项失败，1399 个断言 |
| `pnpm --filter @hospital/miniprogram typecheck` | 通过 |
| `pnpm --filter @hospital/miniprogram build` | 通过；14 个页面运行脚本已发布 |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过 |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | 0 个 |

## 本轮业务边界修正

预约历史、爽约、报告目录和门诊费用页面现在会在 `/me` 成功后捕获会话代际，并在患者上下文、业务结果提交前再次校验。报告详情页还会先重新读取当前 owner 的患者目录，不能仅凭旧页面 URL 或本地 `selected_patient_id` 请求详情。

若代际在组合读取期间变化，页面统一按 `session-changed` fail-closed，清理当前临床读模型，不自动把旧请求重放到新账号。该门禁只保护客户端展示和请求组合，不替代服务端 owner/patient 校验。

## 真机验收边界

本候选只证明本地运行包、类型、测试和来源门禁正确，尚未证明手机扫码后的微信登录、患者同步、预约历史、爽约或门诊费用已经完成真机三层验收。继续验收时必须关闭旧真机调试会话，普通编译当前 `dist/`，再生成与 `4e82313` 对应的新二维码，并同时记录页面结果、客户端 `requestId` 和服务端低敏日志。
