# 小程序启动保护候选 `02865d3`（2026-08-27）

> 本候选只更新原生微信小程序运行包，不重启服务端；线上新 API 仍为
> `0aaa13b53cb6e21b59b332dbd4e2b982a5aba1e7`，旧 Python `8001`、旧数据库和旧 Redis
> 不在本候选的操作范围内。本记录用于区分待发布候选和当前 live 运行包，不能替代
> 微信真机、Provider、支付、医保或 HIS 业务证据。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 服务端配套 release | `0aaa13b53cb6e21b59b332dbd4e2b982a5aba1e7` |
| 小程序提交 | `02865d3` |
| 小程序构建来源 | `02865d385a9c09876dc51da1ffb71183139a559b` |
| 注册页面 | 40 |
| 当前 live `dist` | `d4f67485a34195a2e1e392071502cf2a7006dd27` |
| 候选状态 | pending，尚未覆盖 live `dist` |

## 本轮修复

- `App.onLaunch` 通过 `startGlobalUserProfileBootstrap` 同时捕获启动资料初始化的同步异常和
  Promise 拒绝；旧增量 bundle 或微信启动时序异常不会再让资料增强逻辑中断首屏。
- App 入口在调用 `App()` 前登记唯一启动容器；页面 bundle 优先读取微信返回的完整 App 实例，
  不完整、空值或抛错时回退到同一个 `globalData` 引用。
- 启动失败只沉淀为可重试的资料状态，不把本地缓存直接当成已登录事实，也不把异常详情、
  openid、session_key、患者身份或 Provider 原文写入日志。

## 验证证据

- 小程序定向回归：`146 pass / 0 fail / 2240 expect()`。
- TypeScript 检查通过，Biome 检查通过。
- pending 运行包校验通过：40 个页面、入口脚本、相对依赖、根文件和构建来源指纹完整，
  运行包不包含测试脚本。
- 使用 `getApp() => undefined` 的模拟微信启动环境执行候选入口，未出现
  `Cannot read property 'globalData' of undefined`。

## 发布边界

构建器发现微信开发者工具仍持有 `apps/miniprogram/dist` 的目录句柄，因此没有删除或半覆盖
现有 live 包，已验证候选保存在被忽略的 `.local/hospital-miniprogram/pending/`。当前错误若仍出现，
不能据此否定源码候选；必须先释放工具缓存和目录锁，再让工具重新加载完整运行包。

请关闭标题为 `hospital-platform-runtime - 微信开发者工具 Stable v2.01.2510290` 的项目窗口，
结束该项目真机调试后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist`，普通编译并重新扫码。
只有 `dist/build-info.json` 显示完整来源 `02865d385a9c09876dc51da1ffb71183139a559b`，且真机
重新产生页面、客户端 requestId 和服务端日志关联，才能继续本轮业务验收。

## 安全范围

本候选没有修改或重启旧 Python `8001`，没有修改旧数据库、Redis、线上配置或另一会话维护的众阳
预约适配器；没有启动 Worker，也没有开放支付、医保、二维码真实生成、患者绑定、预约写入或 HIS 回写。
