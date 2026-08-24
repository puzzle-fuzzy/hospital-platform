# `ae0cc11` 原生小程序本地候选构建记录（2026-08-24）

## 来源

- 源码提交：`ae0cc11a4c4147436d8097b15ef00a3e54be8bda`（`ae0cc11`）；
- 构建命令：`pnpm --filter @hospital/miniprogram build`；
- 运行包目录：`apps/miniprogram/dist/`；
- `build-info.json.sourceRevision`：`ae0cc11a4c4147436d8097b15ef00a3e54be8bda`；
- `build-info.json.pageCount`：14；
- 生成时间：2026-08-24 16:04 CST 左右。

## 本候选包含的修正

1. “我的挂号”卡片恢复旧端阅读顺序，取消偏重的蓝色时间整块，改为紧凑日期/时段/号序信息区和轻阴影白卡；
2. “爽约记录”使用专用认证入口，不因缺少当前患者自动进入患者选择页；加载期间使用不可点击的患者骨架，避免查询结束时突然插入患者卡片；
3. 预约记录与爽约记录的状态外壳和记录列表共用外层，加载、错误、空结果和列表之间保持稳定的空间契约；
4. 新增入口与页面静态验收断言，保持只读业务边界，不开放预约写入、取消、支付、医保或 HIS 回写。

## 校验结果

- 小程序回归：`229 pass / 0 fail / 1708 expect()`；
- TypeScript `typecheck`：通过；
- Biome lint：通过；
- `runtime:verify`：通过，14 个页面脚本和必要根文件存在，运行包测试脚本为 0；
- `docs:audit`：612 个 Markdown 文档，无断链；
- `migration:audit`、`architecture:audit`、`logging:audit`：全部通过。

## 发布边界

- 这是本地未发布候选，不是线上小程序运行包；线上配套运行包仍为 `13f597e`；
- 配套服务端仍为 `28a5c0c1`，旧 Python `8001`、旧数据库和旧 Redis 未修改；
- 本地构建和自动化门禁不能替代真机页面、客户端请求和服务端低敏日志三层验收；
- 预约写入、取消、退号、挂号费、门诊支付、医保授权、结算和 HIS 回写继续关闭。
