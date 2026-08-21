# 普通个人资料保存会话竞态审计（2026-08-21）

> 本记录针对当前新项目的小程序普通个人资料写入边界。它不修改旧 Python 服务、线上配置、MySQL、Redis，也不涉及众阳自动化代码。代码级验证通过不等于真实微信写入、409 冲突或真机验收已经完成。

## 1. 本轮结论

普通资料 `GET /api/v2/me/profile`、`PUT /api/v2/me/profile` 的 owner、字段白名单、版本号和 `409 profile-version-conflict` contract 保持不变。本轮只修复小程序页面的一个会话竞态：资料 PUT 已返回后，如果当前会话代际已经变化，页面在异步 `reLaunch` 真正卸载前先释放 `saving`，并由统一的资料上下文清理函数再次保证 `saving=false`。

这样可以避免以下半失效状态：旧账号的写入结果已经不能提交到页面，但按钮仍停留在“保存中”，用户无法继续操作，也不能把旧资料成功态误显示给新账号。

## 2. 代码边界

| 层级 | 当前规则 | 本轮结果 |
| --- | --- | --- |
| API 认证 | Bearer 会话先于资料 body 校验；资料只能按服务端 owner 读取和更新 | 未改变，API 回归通过 |
| API 写入 | `version=0` 只允许首次插入；已有版本必须走条件更新；版本不一致返回 409 | 未改变，服务与应用测试通过 |
| 小程序响应 | PUT 返回后重新检查会话代际；代际变化不能提交旧账号资料 | 保留并补齐 `saving=false` 收敛 |
| 小程序清理 | 会话失效、写入失败或页面切换时清除展示资料和异步状态 | `clearDisplayedProfileContext` 统一释放 `saving` |
| 日志 | 只记录 owner 哈希、版本、字段数量、trace/request 关联，不记录姓名、邮箱或身份证等原值 | 未改变 |

## 3. 验证证据

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @hospital/api test src/modules/profile/service.test.ts src/app.test.ts` | 53 项通过，0 项失败 |
| `pnpm --filter @hospital/persistence test` | 83 项通过，0 项失败 |
| `pnpm --filter @hospital/miniprogram typecheck` | 通过 |
| `pnpm --filter @hospital/miniprogram test` | 171 项通过，0 项失败 |
| `pnpm exec biome check apps/miniprogram/src/pages/profile/profile.ts apps/miniprogram/scripts/acceptance.test.ts` | 通过 |

验收测试同时检查了响应会话代际分支和统一清理函数，防止后续重构只保留其中一处修复。

## 4. 尚未声称完成的事项

- 尚未取得当前候选的小程序真机 `GET`、首次 `PUT`、重复版本 `409` 和会话切换写入证据。
- 头像、实名、手机号、患者建档/绑卡仍不是普通资料写入的兼容字段，不能因为本次保存按钮状态修复而开放。
- 微信支付、医保、HIS 回写和任何 Provider 写操作仍按原门禁冻结。

下一次真机取证应按“默认资料读取 → 修改一个允许字段 → 刷新确认版本 → 使用旧版本制造 409 → 观察 requestId/traceId”顺序执行；如果任一步 contract 或真实服务结果不一致，应先停在证据层，不改前端做猜测性兼容。
