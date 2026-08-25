# 小程序运行包来源刷新（e1adbf7）

> 这是对 40 页业务候选 `de9c5b99` 的运行包来源补充，不代表新增业务开放。
> 上一提交修改了根 `package.json` 的校验脚本，而该文件属于小程序运行输入指纹，
> 因此必须重新构建 pending 运行包，不能继续使用旧的 `de9c5b99` build-info。

## 当前事实

| 项目 | 结果 |
| --- | --- |
| 业务页面候选 | `de9c5b996c6735ced9684bce72e493834fe9325e`（40 页业务代码） |
| 当前工作树提交 | `e1adbf7af682a3dbc58a7616196af4b66871aabd` |
| pending 运行包来源 | `e1adbf7af682a3dbc58a7616196af4b66871aabd` |
| pending 运行包 | `.local/hospital-miniprogram/pending/`，40 页 |
| 生成方式 | `pnpm --filter @hospital/miniprogram build`；因 `dist` 被锁，候选被安全保留 |
| pending 校验 | `runtime:verify:pending` 通过 |
| live `dist` | 仍为 `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，未替换 |
| 真机证据 | [`device-evidence-e1adbf7-pending.json`](device-evidence-e1adbf7-pending.json)，9 个域均为 `pending` |

本次刷新只改变运行包的可追溯来源，不改变页面、API、Provider、支付、医保、患者写入
或外部入口状态。旧 Python `8001`、线上服务、旧数据库、旧 Redis 和另一会话负责的
众阳预约适配器均未修改。

## 验收边界

- `runtime:verify:pending` 通过只证明 pending 文件完整、无测试脚本、无 workspace
  依赖和来源指纹正确；不能证明开发者工具已经加载该包；
- 关闭开发者工具并执行原子发布前，不能生成二维码或沿用旧候选的真机证据；
- 发布后仍需重新采集微信登录、患者目录/切换、预约、报告、门诊费用和普通资料的
  页面、客户端 `requestId` 与服务端 Pino 同链证据；
- C/D/E 正式 contract、健康审核 bundle 以及 F 支付/医保/HIS 回写仍按原队列关闭。

发布步骤见 [`pending-runtime-publication-runbook-2026-08-26.md`](pending-runtime-publication-runbook-2026-08-26.md)。
