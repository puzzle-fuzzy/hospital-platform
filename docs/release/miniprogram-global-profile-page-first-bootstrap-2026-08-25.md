# 小程序全局资料页面先行启动边界（2026-08-25）

## 结论

本轮修正了 App 启动脚本与页面脚本初始化顺序交错时的资料读取边界。正常路径仍由
`App.onLaunch` 创建唯一的全局资料初始化 Promise；如果页面先看到全局资料处于 `idle`，
页面等待函数会接管同一条启动链，而不会把“尚未开始验证”误判成“未登录”。

本修正只影响新小程序的进程内资料协调，不修改旧 Python 服务、旧数据库、旧 Redis、Provider
适配器或线上运行进程。

## 业务不变量

1. `idle` 只表示本次 App 容器尚未开始资料初始化，不表示微信用户已经退出。
2. `loading`、`ready` 和 `error` 都是已经进入过初始化链后的状态；页面不能把 `error` 静默变成
   自动重试，避免网络故障时切换 Tab 形成无提示请求风暴。
3. 页面接管启动时必须继续复用 `ensureGlobalUserProfile()` 的进程内单飞和 `App.globalData`
   Promise；不能重新创建独立的 `/me`、`/me/profile` 请求链。
4. `/me` owner 证明、普通资料快照和会话代际校验完成前，页面不得把昵称、头像或患者上下文
   当作当前账号事实。
5. 资料增强失败不能阻断已验证的微信会话；明确会话失效或代际变化时才清理旧账号资料。

## 为什么需要这条边界

微信开发者工具热重载、页面单独恢复以及 App IIFE 与页面 CommonJS bundle 的加载交错，可能让
页面调用 `waitForGlobalUserProfile()` 时尚未看到 `App.onLaunch` 写入的 Promise。旧逻辑会立即
返回 `idle` 快照，首页、“我的”和就诊页随后可能显示“未登录”或停止继续读取；这不是业务上的
未登录，而是初始化竞态。

本轮只对明确的 `idle` 初始态接管启动。已经是 `error` 的状态继续等待用户点击重试，避免把依赖
故障伪装成页面切 Tab 自动恢复；已经存在 Promise 时始终等待原 Promise。

## 代码与测试

- 业务实现：`apps/miniprogram/src/services/global-user-profile.ts`
- 回归测试：`apps/miniprogram/src/services/global-user-profile.test.ts`
- 覆盖场景：页面先于 App 启动、多个 Tab 单飞、资料授权单飞、会话切换后旧授权回调隔离。
- 本地验证：`bun test apps/miniprogram/src/services/global-user-profile.test.ts`

## 发布边界

该修正仅进入新小程序候选运行包。发布前仍必须校验候选来源、`dist` 文件锁、微信开发者工具
编译结果和真机链路；本地测试通过不等于线上或真机资料已验收。旧服务继续保持原进程和原配置，
如需发布新候选必须采用可回滚的运行包替换，不覆盖旧服务。
