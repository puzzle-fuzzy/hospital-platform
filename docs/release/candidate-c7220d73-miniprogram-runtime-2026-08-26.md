# 小程序当前 pending 运行包候选（c7220d73）

> 本文是 2026-08-26 患者签名与消息订阅横向迁移后的运行包事实源。它记录自动化构建和来源校验，不代表已经发布到微信开发者工具、微信线上版本或真实业务验收通过。

## 当前事实

| 项目 | 结果 |
| --- | --- |
| 功能提交 | `c7220d733b95d393030af9826c2ca305a7fc1f8e` |
| 短提交 | `c7220d73` |
| 构建输出 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 40 |
| 小程序测试 | `301 pass / 0 fail / 3435 expect()` |
| 类型检查 | 通过 |
| 构建前置 | 通过；发布阶段因 `dist/` 被微信开发者工具锁定返回 `EBUSY` |
| pending 运行包校验 | 待文档提交后以 `runtime:verify:pending` 复核，运行输入来源为 `c7220d73` |
| 真机证据清单 | [`device-evidence-c7220d7-pending.json`](device-evidence-c7220d7-pending.json)，9 个域均为 `pending` |
| live `dist` | 未替换；旧完整运行包保留 |
| 线上服务 | 未修改；仍为 `8eb51b5f`，旧 Python `8001` 继续共存 |

## 本批横向迁移内容

### 患者签名

- 使用 owner-scoped `/patients` 脱敏读模型；
- 保留旧端患者列表、选中态、关系和脱敏卡号展示；
- 支持进入统一就诊人选择页，返回后重新读取目录；
- 加入顶部错误/重试、固定高度加载/空目录状态和迁移说明入口；
- 不复用旧端示例患者，不调用硬编码外部小程序，不透传患者 ID，不改变全局当前患者。

### 消息订阅

- 保留橙色提醒、当前就诊人、标题搜索、四类提醒、折叠和固定底部动作；
- 开关固定为关闭并显示“暂未接入”；
- 未调用 `wx.requestSubscribeMessage`，未写入订阅状态，未显示“设置已保存”；
- 当前就诊人加载失败与未绑定就诊人保持独立错误语义。

## 发布前置

关闭占用 `apps/miniprogram/dist/` 的微信开发者工具窗口和真机调试会话后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须核对 `dist/build-info.json.sourceRevision` 等于完整来源 SHA，再从新运行包开始真机验收。不能使用 `ed20c52` 或更早候选的截图、日志和 requestId 作为本批证据。

## 证据边界

- 本批没有修改旧 Python 服务、旧数据库、旧 Redis、线上进程或另一会话负责的众阳预约适配器；
- pending 校验只能证明运行包完整和来源指纹正确，不能证明微信真机已经加载本候选；
- 患者签名和消息订阅仍登记为 `surface-only`，真实签名会话、微信授权和发送链路继续关闭；
- 支付、医保、预约写入、HIS 回写、真实物流 provider 和其他 contract-blocked 业务继续关闭。
