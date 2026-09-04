# `miniprogram-pay` 分支与还原点索引

> 盘点时间：2026-09-04（Asia/Shanghai）。本文只记录版本、发布目录、业务范围和排障结论，不记录 token、患者号、请求体或 Provider 原始报文。

## 当前有效版本

| 对象 | 指向 | 含义 |
| --- | --- | --- |
| 本地当前分支 | `codex/miniprogram-pay-mixed-payment` | 医保支付 demo 的持续开发分支 |
| 本地 HEAD | `146e6cda1041bf486288d80af6b25ccc9a58bfe3` | 当前最新修复：众阳 19 位 ID 全程按字符串处理 |
| 服务器 `current` | `/home/ps/code/hospital-platform/releases/146e6cda1041bf486288d80af6b25ccc9a58bfe3` | `hospital-platform-api-v2.service` 当前运行包 |
| `main` | `0a0548680b6052819825b630f1351a7a8cc3024b` | 医保 demo 在混合支付前的本地还原点；未作为当前服务版本 |
| `origin/main` | `10c6b471c7df5ed36795c5f0d7269e38d54046af` | 新项目医保支付基础版本；当前功能分支在其之上继续开发 |
| Git tag | 无 | 目前用完整 commit SHA 作为还原点，不用可变 tag |

当前 API 已切换到 `146e6cda`，内网和公网 readiness 均通过，database、Redis、schema 均为 `ok`。本次只更新 API bundle，未修改数据库和环境变量。

## 医保 demo 的还原链

| 还原点 | 内容 | 是否可直接作为当前参考 |
| --- | --- | --- |
| `10c6b471` | 完成 `miniprogram-pay` 医保支付主链：预约写入 service、医保 registration service、API 路由、客户端流程和新持久化能力的基础实现。 | 仅作为“新项目医保主链起点” |
| `0a054868` | 在 `main` 上保存医保 demo 进入混合支付前的页面、医保服务和流程图状态。 | 可回退查看单一医保版本，不是当前运行版本 |
| `e1d66fe7` | 保存正式医保混合支付流程：医保服务、医保微信支付服务、API 组合根、支付适配器和小程序页面同步调整。 | 可回退查看混合支付接入点 |
| `8b81554f` | 发布前整理：补自费支付服务、请求上下文、错误处理、页面三按钮流程和 Provider 合同文档。 | 可回退查看发布前版本 |
| `d5d0fcb4` | 预约号源改为优先请求后天/大后天；每次支付前刷新排班和号源；处理过期快照、号源消失和取消提示；补 SSH 恢复手册。 | 可回退，但号源写入仍有后续修复 |
| `97911c88` | 处理 `groupStart === groupEnd` 的时间点号源，时间点不再被当作倒序时间段。 | 已被 `146e6cda` supersede；不能单独作为最终修复版本 |
| `146e6cda` | 修复众阳 `hisScheduleId`、`sourceId`、`patId`、预约 ID 可能为 19 位数字字符串时被 `Number` 转换破坏的问题；锁号、费用、预约、查询、取消统一保留字符串。 | 当前有效版本 |

完整分支关系：

```text
origin/main 10c6b471
        └─ main 0a054868
             └─ codex/miniprogram-pay-mixed-payment
                  ├─ e1d66fe7  医保混合支付流程
                  ├─ 8b81554f  发布整理
                  ├─ d5d0fcb4  后天/大后天号源与刷新
                  ├─ 97911c88  时间点号源
                  └─ 146e6cda  19 位 Provider ID 精度修复（当前）
```

## 服务器上的历史 release 目录

服务器 `/home/ps/code/hospital-platform/releases/` 不是 Git 分支，而是不可变发布目录。当前医保 demo 相关目录如下：

| 目录 | 实际内容/用途 |
| --- | --- |
| `146e6cda1041bf486288d80af6b25ccc9a58bfe3` | 当前运行版本 |
| `97911c889ec7358913df67d11a97485e27d67af7` | 上一版本，只有时间点号源修复 |
| `d5d0fcb41794775cc85a693c538d8490628602c1` | 再上一版本，后天/大后天号源和刷新修复 |
| `8b81554f319472fea95c659eeba9e5cdfde8866c` | 发布整理版本 |
| `worktree-20260904-mi-details` | 临时工作树发布目录，不是 Git commit，不作为回退目标 |
| `6b0799a6-mi` | 医保迁移包，migration 到 `0029`，不是当前应用代码分支 |
| `6b0799a6-mi-final` | 医保迁移包，包含 `0030` owner/patient 外键修复版本 |
| `6b0799a6-mi-fk` | `0030` 外键修复变体：直接重建医保订单的 owner-scoped 外键 |
| `6b0799a6-mi-fk3` | `0030` 外键修复变体：先补患者复合唯一键，再重建医保订单外键 |
| `6b0799a6-mi-logging` | 在 `6b0799a6-mi-final` 基础上的日志版本 |
| `6b0799a6-mi-logging-sources-bind-20260904` | 在日志版本上继续处理号源绑定的迁移包；不是当前 API release |

`6b0799a6-mi*` 是当时为迁移/外键/日志问题保留的命名目录，没有对应的 Git ref，不能只凭目录名回退或重新执行 migration。当前数据库已经按正式 migration 状态运行，回退应用版本不等于回退数据库；涉及 schema 的回退必须另行确认兼容性。

服务器中其余以短 SHA 命名的目录是 2026-08 以前的医院平台通用 API 运行基线、日志、只读业务或发布验收快照，不属于 `miniprogram-pay` 的独立分支。它们保留用于平台级回退，不能当作医保 demo 版本。盘点时以目录名、完整 Git SHA（能解析时）和发布证据三者为准。

## 刚才错误的日志结论

### 已有日志足够证明什么

失败请求已经记录了：

- 平台 `requestId/traceId`；
- `appointment.hold.requested`；
- 当前用户、平台就诊人、排班引用和号源序号；
- `providerOperation=appointment-source-resolve`；
- HTTP 状态、错误码、是否可重试和耗时。

这些信息足以确认失败发生在预约占位流程，而不是小程序按钮或医保授权页面。

### 原有日志缺什么

日志没有明确写出“平台本地校验失败、尚未发出 Provider 请求”。因此 `providerOperation=appointment-source-resolve` 配合公共 `10800` 很容易被误读成众阳真实拒绝。原日志也没有在 hold 内部逐步记录 resolve、lock、fee 三个阶段的开始/成功，但不能把患者号、费用明细或 Provider 原始报文写入日志。

### 已补的防护

1. Provider failure stage 增加 `validation`：表示尚未发出 Provider 请求；保留 `transport`、`http`、`response` 三种阶段。
2. Provider 2xx 但业务包络拒绝统一标记为 `response`，与网络失败和本地校验区分。
3. Provider ID 不再使用 JavaScript `Number`，以十进制字符串校验和传递，避免 19 位 ID 精度丢失。
4. 号源时间点、时间段、号源不存在分别保留独立的服务端处理路径。
5. 排障只使用 `traceId + providerOperation + providerRequestId + providerStatusCode + providerFailureStage`；不记录 token、请求体、患者号或 Provider 原文。

## 后续避免同类问题的规则

- Provider 标记为“整型”的 ID 也必须先按字符串接收；只有明确要求计算的金额、计数和状态码才允许转换为数字。
- 任何外部写入 adapter 都要区分：调用前校验、已发请求但无响应、HTTP 非 2xx、HTTP 2xx 业务拒绝、响应结构异常。
- 页面显示“外部服务拒绝”时，先查服务端 `providerFailureStage` 和 `providerRequestId`：没有 Provider request id 且 stage 为 `validation`，不能归因于外部服务。
- 发布前固定完整 commit SHA；服务器用独立 release 目录、checksum 和原子切换，禁止把临时工作树名称当版本号。
- 预约写入必须按 `resolve source → lock source → fact fee → create appointment` 的实际操作名排查；只看到 `hold.requested` 不代表已经锁号。

## 当前回退命令

回退前先读取当前 `current`，再从上面的索引选择经过确认的完整目标 SHA；不能把当前 SHA 当成回退目标，只回退 API，不执行数据库回退。当前版本若要回到上一个可运行包，目标是 `146e6cda1041bf486288d80af6b25ccc9a58bfe3`：

```bash
cd /home/ps/code/hospital-platform
current_sha="$(readlink -f current | sed 's#.*/##')"
target_sha="146e6cda1041bf486288d80af6b25ccc9a58bfe3"
test "$target_sha" != "$current_sha"
test -f "releases/${target_sha}/apps/api/dist/index.js"
ln -s "releases/${target_sha}" current.next
mv -Tf current.next current
sudo -n systemctl restart hospital-platform-api-v2.service
curl -fsS https://test-hp.meiyi.pro/api/v2/health/ready
```

如果 `ssh 3090-local` 不通，先按 [`3090-local SSH 连接恢复手册`](3090-local-SSH连接恢复手册.md) 建立转发，再继续发布或回退。
