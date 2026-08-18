# 小程序就诊人手动刷新事件边界修正（2026-08-18）

## 结论

提交 `144b5b4` 修正了选择页“刷新就诊人”不会真正发起同步的逻辑缺陷。此前按钮直接绑定 `onSyncPatients(loadToken?)`，但微信小程序的 `bindtap` 会把事件对象作为第一个参数传入；事件对象被当成加载 token 后，页面请求守卫始终判定为过期，用户点击刷新只能看到页面无变化。

修正后分成两个明确边界：

- `onSyncPatients()`：只作为 WXML 真机事件入口，忽略事件对象并创建当前页面新的加载 token；
- `syncPatientDirectoryForLoad(loadToken)`：只接收数字 token，负责页面级 single-flight、进程级患者同步和过期响应拦截。

这样既保留了“目录读取完成后继续等待临床映射同步”的完整生命周期，也避免框架事件对象污染业务状态机。

## 验收证据

- 小程序 typecheck：通过。
- 小程序测试：112 项通过、0 失败、979 个断言。
- 关键静态门禁：确认 WXML 绑定 `onSyncPatients`，确认内部流程只接受 `number` 加载 token，确认目录生命周期调用 `syncPatientDirectoryForLoad(loadToken)`。
- Git diff：本次代码提交只包含小程序页面和验收测试；用户已有的 `apps/miniprogram/project.config.json` 未暂存、未修改。

## 运行与发布边界

- 当前候选来源指纹：`144b5b44f6e221569b458fda87e33b064f49a000`。
- 服务端仍为线上 `4ae2a31`；本次尚未部署新客户端，也未重启或修改旧 Python 服务。
- 真机验收前必须执行小程序构建和 `runtime:verify`，核对 `dist/build-info.json.sourceRevision` 为上述完整指纹；之后再按只读业务验收手册验证患者刷新、显式切换和业务页回访。

## 后续

1. 重新构建并核对来源指纹。
2. 真机验证选择页首次加载、手动刷新、第二位患者显式切换和返回首页后的 owner 目录重读。
3. 只有页面、HTTP trace 和低敏日志三层证据同时对齐，才推进预约历史、爽约和门诊费用只读验收；支付、医保、报告详情和 HIS 写回仍保持关闭。
