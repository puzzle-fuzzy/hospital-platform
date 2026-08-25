# 小程序当前 pending 运行包候选（de9c5b99）

> 本文记录源码提交 `de9c5b99` 生成的 40 页 pending 运行包。它证明构建、来源和静态门禁，
> 不代表已经替换微信开发者工具的 live `dist`，也不代表真机业务已经验收。

## 当前事实

| 项目 | 结果 |
| --- | --- |
| 功能提交 | `de9c5b996c6735ced9684bce72e493834fe9325e` |
| 短提交 | `de9c5b99` |
| 构建输出 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 40 |
| 小程序测试 | `309 pass / 0 fail / 3522 expect()` |
| 类型检查 | 通过 |
| pending 运行包校验 | `runtime:verify:pending` 通过 |
| live `dist` 发布 | 未替换；微信开发者工具锁定目录，发布阶段返回 `EBUSY`，旧运行包保留 |
| 真机证据清单 | [`device-evidence-de9c5b99-pending.json`](device-evidence-de9c5b99-pending.json)，9 个域均为 `pending` |
| 线上服务 | 未修改；旧 Python `8001` 继续共存 |

安全发布的逐步操作、`EBUSY` 保留策略和发布后取证顺序见
[`pending-runtime-publication-runbook-2026-08-26.md`](pending-runtime-publication-runbook-2026-08-26.md)。

## 本候选新增的跨业务修正

- 预约、爽约、报告和就诊摘要共用的日期窗口拒绝 `Invalid Date`、无穷大、负数和非整数天数；
- 本地日期损坏统一映射为 `date-range-invalid`，不会生成 `NaN-NaN-NaN` 请求；
- 日期窗口修正只改变客户端本地参数边界，不扩大任何 Provider、支付、医保或患者写入能力；
- 旧端 64 个入口的状态分布不变，C/D/E 的临床、患者写入和外部入口仍保持关闭。

## 发布前置

关闭占用 `apps/miniprogram/dist/` 的微信开发者工具和真机调试会话后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须核对 `dist/build-info.json.sourceRevision` 等于完整来源 SHA，
再从这一运行包重新生成二维码并开始真机验收。不能使用 `ad7bd1f` 或更早候选的截图、日志和 requestId 作为本候选证据。

## 证据边界

- 本批没有修改旧 Python 服务、旧数据库、旧 Redis、线上进程或众阳预约适配器；
- pending 校验不能证明微信真机已加载本候选；
- 协议同意、患者绑定、签名、临床 Provider、外部会话、支付、医保、HIS 回写和患者写入不能因为页面可打开而被标记为成功。
