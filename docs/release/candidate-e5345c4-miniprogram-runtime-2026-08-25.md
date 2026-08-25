# 当前小程序 pending 运行包候选（e5345c4）

> 本记录对应当前运行输入来源 `e5345c423a4cd44801e0b3e0a202063cad882c50`。它包含此前 `7bc5956` 的小程序业务代码以及共享构建/门禁输入；构建已经完成 staging 和 pending 静态校验，但微信开发者工具仍锁定 `apps/miniprogram/dist/`，所以尚未替换 live 运行包，也不构成真机验收。

## 当前来源

| 项目 | 值 |
| --- | --- |
| 运行输入来源提交 | `e5345c423a4cd44801e0b3e0a202063cad882c50` |
| pending 运行包来源 | `e5345c423a4cd44801e0b3e0a202063cad882c50` |
| pending 目录 | `.local/hospital-miniprogram/pending/` |
| pending 页面数 | 20 |
| 小程序回归 | `267 pass / 0 fail / 2659 expect()` |
| 服务端配套候选 | `b42922f4f83d5018c20f7abc5f9734625306d5a6` |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍被微信开发者工具锁定 |
| 真机证据 | [`device-evidence-e5345c4-pending.json`](device-evidence-e5345c4-pending.json)，9 个域均为 `pending` |

## 本候选边界

- 业务运行代码沿用 `7bc5956` 的跨会话微信资料授权竞态保护和此前已验证的 20 页原生小程序能力。
- `e5345c4` 是当前运行输入指纹，因为它位于 `7bc5956` 之后并包含共享构建/导航门禁输入；不能继续使用旧 `7bc5956` 清单作为当前候选证据。
- 不新增支付、医保、临床写入、患者绑定或 Provider 业务范围。

## 已验证

```text
pnpm typecheck                                      通过
pnpm test                                           9 个 workspace 全部通过；小程序 267 pass / 0 fail / 2659 expect()
pnpm migration:breadth:audit                       首页 22 个、我的 9 个可见 action 全部有固定分发
pnpm --filter @hospital/miniprogram runtime:verify:pending 通过
```

构建尝试发现 `dist/` 被微信开发者工具占用；发布器保留了旧 live 目录和当前 pending 候选，没有清空或半替换运行包。

随后再次执行 `runtime:publish-pending` 仍收到 `EBUSY`：当前微信开发者工具窗口或真机调试会话继续持有 `apps/miniprogram/dist/`。本次没有删除、覆盖或强制终止占用进程，旧 live 目录和 pending 候选状态不变。

关闭微信开发者工具和真机调试会话后，按顺序执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须从新的运行包重新生成二维码；旧的 `7bc5956`、`1404a03`、`fcc6630e` 和线上 `13f597e` 只能作历史/运行边界记录，不能混入本候选真机证据。
