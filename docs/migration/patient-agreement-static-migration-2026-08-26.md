# 就诊人协议静态页面迁移记录（2026-08-26）

> 本文记录协议静态页当时的迁移实现，不是业务验收证明。文中历史 pending 构建数字
> 只用于追溯；当前线上服务端 release 为 `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`；最新小程序运行包以 `62cdb8f82b4169dd1b9a6ed3403e3be2f7422328` 和
> [`release/candidate-62cdb8f-miniprogram-runtime-2026-08-27.md`](../release/candidate-62cdb8f-miniprogram-runtime-2026-08-27.md)
> 为准，已原子发布到本地 live `dist`，协议同意、撤回和审计仍未开放。

## 结论

旧端 `pagesB/patient/agreement.vue` 是一张静态协议说明页：没有请求、没有服务端协议版本、没有用户同意记录、没有撤回接口，也没有可靠的审计字段。旧端虽然在脚本中声明了 `handleAccept`/`handleReject`，但模板没有绑定这两个方法，因此不能把它解释为已经完成了协议授权流程。

本轮只迁移“阅读协议正文”这一低风险能力，不新增本地勾选、不新增“同意成功”提示、不把打开页面或滚动到底部当成同意事实。

## 旧端核对

| 项目 | 核对结果 |
| --- | --- |
| 旧端页面 | `G:\\fuck\\hospital\\hospital-app\\src\\pagesB\\patient\\agreement.vue` |
| 内容 | 顶部提示、核心说明、十一章条款和最终声明 |
| 数据请求 | 无 `uni.request`、无业务 API、无 provider URL |
| 同意动作 | 脚本存在未绑定的 `handleAccept`/`handleReject`，模板没有按钮引用 |
| 版本与审计 | 未发现协议版本、同意主体、同意时间、撤回或审计写入契约 |
| 风险边界 | 不能用静态页面替代患者绑定、实名授权或医疗数据访问授权 |

## 新端落点

- 注册页面：`apps/miniprogram/src/app.json` 的 `pages/patient-agreement/patient-agreement`。
- 页面源码：`apps/miniprogram/src/pages/patient-agreement/`。
- 迁移台账：`pagesB/patient/agreement.vue` 标记为 `replaced` 并保留 `patient-agreement` 契约关联键；说明中明确“协议版本、同意记录、撤回和审计仍未开放”。
- 页面滚动：使用唯一的外层 `scroll-view`，避免协议正文引入页面级滚动条；该页面不渲染底部主 Tab。
- 文本与样式：保留旧端 11 个章节、条款编号、提示语和主要视觉规则；移除旧端无效的 Vue 深层选择器和未挂载按钮样式。

## 两层状态必须分开

1. **静态阅读页已迁移**：用户可以查看旧端已有的协议正文，属于 A 安全静态/只读覆盖。
2. **协议同意能力未开放**：真正用于新增/绑定就诊人的版本确认、同意主体、时间、撤回、审计和幂等写入仍属于 D 患者 contract 队列；关联键只用于追踪，不代表页面已记录同意，也不能因为页面可打开就解除 `patient-agreement` 准入门禁。

这种拆分是有意的：它既补齐了旧入口的可读页面，又避免把法律文本展示误报成用户已经完成授权。

## 验证

- 小程序回归：`293 pass / 0 fail / 3237 expect()`。
- 小程序类型检查：通过。
- `pnpm migration:breadth:audit`：通过，21 个页面、31 个可见/状态入口调用、4 个主 Tab。
- `pnpm migration:boundary:audit`：通过；协议 gate 明确允许静态只读落点，但仍保留真实同意 contract 的阻断条件。
- `pnpm test:tools`：通过，`89 pass / 0 fail / 712 expect()`；readiness 与发布基线测试不会把静态页面或未部署服务端代码误报为业务完成。
- `pnpm format:check`：通过。
- pending 运行包：`3b42b867ae19f6dd23bacd88648d1f5917dabf26`，21 个页面；`runtime:verify:pending` 通过。
- 实现阶段微信开发者工具曾锁定 live `dist`，构建按保护策略返回 `EBUSY` 并保留 pending；该历史阻塞已解除，当前运行包已完成原子切换。

本轮没有修改旧 Python 服务、旧数据库、Redis、线上服务或另一会话负责的众阳预约适配器。

## 后续

- 继续按广度队列处理尚未迁移的临床、便民、外部和支付入口，不围绕协议静态页继续扩展假接口。
- 如果要开放协议同意动作，先收集正式协议版本、发布主体、同意/撤回 API、幂等键、审计字段和跨账号隔离规则，再按 `contract → domain → API → 页面 → 日志 → 真机` 实现。
