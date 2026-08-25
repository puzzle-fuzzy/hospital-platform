# 当前小程序 pending 运行包候选（f97f9f0）

> 本记录只描述当前源码构建出的 pending 运行包，不代表已经发布到微信开发者工具、线上服务或真机验收通过。

## 候选事实

| 项目 | 当前值 |
| --- | --- |
| 小程序源码提交 | `f97f9f0302c3d2bd9a83351614808b7627ce3fab` |
| pending 位置 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 20 |
| 运行包来源 | `build-info.json.sourceRevision` |
| 真机证据清单 | [`device-evidence-f97f9f0-pending.json`](device-evidence-f97f9f0-pending.json)，9 个域均为 `pending` |
| 服务端候选 | `b42922f`，尚未与线上旧 release 切换 |

## 本地验证

- `pnpm --filter @hospital/miniprogram typecheck`：通过；
- `pnpm --filter @hospital/miniprogram runtime:verify:pending`：通过，20 个页面脚本和根文件完整；
- `pnpm --filter @hospital/miniprogram build`：源码编译和候选生成完成，但发布到 live `dist/` 时被微信开发者工具文件锁安全阻止；
- `pnpm --filter @hospital/miniprogram runtime:publish-pending`：同样因 `dist/` 被锁定而停止，旧完整运行包保留未变。

## 发布与验收边界

关闭当前微信开发者工具窗口和真机调试会话后，在仓库根目录执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后才可以使用本候选重新生成开发者工具二维码，并按证据清单采集页面截图、客户端 requestId
和服务端低敏同链事件。旧 live `dist/` 没有被覆盖前，不能把本候选的代码测试或 pending 清单写成真机业务完成。

本候选不打开预约写入、患者新增绑定、二维码真实生成、临床问卷、外部 WebView、支付、医保或 HIS 回写；
这些业务继续遵守各自的 contract 和 release gate。
