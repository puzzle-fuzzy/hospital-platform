# 当前小程序 pending 运行包候选（1404a03）

> 本记录只描述当前源码构建出的 pending 运行包，不代表已经发布到微信开发者工具、线上服务或真机验收通过。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 小程序源码提交 | `1404a0360539d5ae7b409bccb8cf8fb00020c898` |
| pending 运行包来源 | `1404a0360539d5ae7b409bccb8cf8fb00020c898` |
| pending 位置 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 20 |
| 配套服务端候选 | `b42922f4f83d5018c20f7abc5f9734625306d5a6` |
| 当前 live dist | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，16 页 |
| 真机证据 | [`device-evidence-1404a03-pending.json`](device-evidence-1404a03-pending.json)，9 个域均为 `pending` |

## 已验证

- `pnpm --filter @hospital/miniprogram typecheck` 通过；
- `pnpm --filter @hospital/miniprogram runtime:verify:pending` 通过；
- pending 运行包包含 20 个页面脚本及来源指纹；
- 由于微信开发者工具仍锁定 `apps/miniprogram/dist/`，本次构建没有替换旧 live 运行包；
- 旧 Python 服务、旧数据库、旧 Redis 和线上旧进程未修改。

## 发布和验收边界

关闭微信开发者工具及真机调试会话后，执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须重新生成二维码，并使用 [`device-evidence-1404a03-pending.json`](device-evidence-1404a03-pending.json)
记录页面结果、客户端 `requestId`、服务端 Pino 事件和 Provider 低敏请求号。旧候选
`8bc649f`、`fcc6630e` 只能用于历史追溯，不能混入本次证据。
