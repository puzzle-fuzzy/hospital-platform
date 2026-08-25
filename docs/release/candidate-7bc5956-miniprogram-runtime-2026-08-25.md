# 当前小程序 pending 运行包候选（7bc5956）

> 本记录对应当前源码提交 `7bc59567`。它已经完成 staging 构建和 pending 静态验证，但微信开发者工具仍锁定 `apps/miniprogram/dist/`，所以尚未替换 live 运行包，也不构成真机验收。

## 当前来源

| 项目 | 值 |
| --- | --- |
| 小程序源码提交 | `7bc595673a6ba41503a751cd38f0beb15ee8f23f` |
| pending 运行包来源 | `7bc595673a6ba41503a751cd38f0beb15ee8f23f` |
| pending 目录 | `.local/hospital-miniprogram/pending/` |
| pending 页面数 | 20 |
| 小程序回归 | `266 pass / 0 fail / 2548 expect()` |
| 服务端配套候选 | `b42922f4f83d5018c20f7abc5f9734625306d5a6` |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍被微信开发者工具锁定 |
| 真机证据 | [`device-evidence-7bc5956-pending.json`](device-evidence-7bc5956-pending.json)，9 个域均为 `pending` |

## 本候选变更

- 收紧微信资料授权拒绝分支的会话代际、owner 和全局状态校验；旧会话的迟到拒绝回调不能污染新会话。
- 新增旧授权回调跨会话竞态回归测试。
- 不新增支付、医保、临床写入、患者绑定或 Provider 业务范围。

## 已验证

```text
pnpm --filter @hospital/miniprogram typecheck       通过
pnpm --filter @hospital/miniprogram test            266 pass / 0 fail / 2548 expect()
pnpm --filter @hospital/miniprogram runtime:verify:pending 通过
```

构建尝试发现 `dist/` 被微信开发者工具占用；发布器保留了旧 live 目录和当前 pending 候选，没有清空或半替换运行包。

关闭微信开发者工具和真机调试会话后，按顺序执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须从新的运行包重新生成二维码；旧的 `1404a03`、`fcc6630e` 和线上 `13f597e` 只能作历史/运行边界记录，不能混入本候选真机证据。
