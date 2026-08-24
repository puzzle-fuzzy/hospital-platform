# `d32c5ce` 原生小程序本地候选构建记录（2026-08-24）

## 来源

- 源码提交：`d32c5ce9653935e6f66bead9526bc8d0fa639b37`（`d32c5ce`）；
- 构建命令：`pnpm --filter @hospital/miniprogram build`；
- 运行包目录：`apps/miniprogram/dist/`；
- `build-info.json.sourceRevision`：`d32c5ce9653935e6f66bead9526bc8d0fa639b37`；
- `build-info.json.pageCount`：14；
- 生成时间：2026-08-24 16:10 CST 左右。

## 本候选包含的修正

在 `ae0cc11` 候选的挂号卡片、爽约入口和查询状态外壳基础上，本候选继续补齐报告目录的加载占位：

1. 报告目录在 owner、患者和报告读模型完成前显示不可点击的患者骨架；
2. 骨架与真实患者条带保持同等高度，报告成功后不会突然插入患者卡片并推移提示和状态卡；
3. 不改变报告查询、患者选择、Provider 引用或详情开放边界；
4. 支付、医保、预约写入、取消、退款和 HIS 回写继续关闭。

## 校验结果

- 小程序回归：`230 pass / 0 fail / 1714 expect()`；
- TypeScript `typecheck`：通过；
- Biome：变更文件检查通过；
- `runtime:verify`：通过，14 个页面脚本和必要根文件存在，运行包测试脚本为 0；
- `docs:audit`：613 个 Markdown 文档，无断链；
- `migration:audit`：通过。

## 发布边界

- 这是本地未发布候选，不是线上小程序运行包；线上配套运行包仍为 `13f597e`；
- 配套服务端仍为 `28a5c0c1`，旧 Python `8001`、旧数据库和旧 Redis 未修改；
- 本地构建和自动化门禁不能替代真机页面、客户端请求和服务端低敏日志三层验收；
- 报告 Provider 目录/详情、患者新增绑定、二维码、支付、医保和 HIS 写回仍按迁移台账保持关闭或迁移提示。
