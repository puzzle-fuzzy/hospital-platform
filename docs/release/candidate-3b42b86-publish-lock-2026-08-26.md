# 小程序候选发布锁定记录：3b42b86

> 记录时间：2026-08-26（Asia/Shanghai）
>
> 本文只记录一次安全失败的发布尝试，不代表候选已经进入微信开发者工具或真机。

## 1. 候选与运行包边界

| 项目 | 来源 |
| --- | --- |
| 小程序源码候选 | `3b42b867ae19f6dd23bacd88648d1f5917dabf26` |
| 候选运行包 | `apps/miniprogram/.local/hospital-miniprogram/pending/` |
| 候选页面数 | 21 |
| 候选回归 | `293 pass / 0 fail / 3237 expect()` |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b` |
| 微信开发者工具工程 | `apps/miniprogram/dist/` |

候选已经通过 `runtime:verify:pending`。在发布前，候选和当前 live `dist` 必须继续分开；不能通过删除当前目录、强制覆盖或手工复制单个页面来解决锁定问题。

## 2. 发布尝试与结果

执行命令：

```powershell
pnpm --filter @hospital/miniprogram runtime:verify:pending
pnpm --filter @hospital/miniprogram runtime:publish-pending
```

验证步骤通过。发布步骤被 Windows 文件句柄安全拦截，错误为：

```text
Mini program dist/ is locked by WeChat DevTools
EBUSY rename ... apps/miniprogram/dist
```

发布器保留了完整候选 pending 目录，也保留了上一份完整 live `dist`。因此本次没有产生半套运行包，没有改变当前开发者工具正在使用的旧候选，也没有触碰线上服务或旧 Python 服务。

## 3. 下次操作

停止真机调试，关闭所有指向该项目的微信开发者工具窗口，确认 `wechatdevtools.exe` 已完全退出后，在仓库根目录重新执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

然后重新导入 `apps/miniprogram/dist/`，核对 `dist/build-info.json` 的完整 `sourceRevision` 是否为 `3b42b867ae19f6dd23bacd88648d1f5917dabf26`，再开始真机验收。若工具仍占用目录，应继续保留 pending，不得强制杀进程或删除 `dist`。

## 4. 对业务迁移的影响

- A 批次五个低风险域的代码和测试仍然有效，但当前尚未取得本候选的真机证据。
- B 健康内容、C 临床只读、D 患者与便民写入、E 外部入口和 F 支付医保继续按各自准入门禁推进；发布锁不会改变这些域的业务状态。
- 当前 live `dist`、线上 API release 和旧 Python `8001` 均保持原状，本次没有任何线上切换。
