# 原生小程序运行包验证（2026-08-18）

本文记录当前 `main` 生成的微信小程序运行包完整性。它只证明开发者工具可以读取一套结构完整的 `dist/` 运行目录，
不证明真实微信登录、患者 Provider、预约/费用业务或真机页面已经验收。

## 1. 候选版本与范围

| 项目 | 结果 |
| --- | --- |
| 小程序运行输入来源提交 | `144b5b4`（`修复就诊人手动刷新事件边界`） |
| 小程序根目录 | `apps/miniprogram/` |
| 开发者工具运行根目录 | `dist/` |
| `src/app.json` 注册页面 | 14 个 |
| `dist/` 生成文件 | 171 个 |
| 生成页面脚本 | 14 个 |
| 构建来源指纹 | `144b5b44f6e221569b458fda87e33b064f49a000` |
| 原生验收 | 112 项通过，979 个断言 |

## 2. 本次验证

在仓库根目录执行：

```text
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
pnpm --filter @hospital/miniprogram test
```

结果：

- TypeScript 类型检查通过，构建脚本从 `src/app.json` 生成全部 14 个页面 JavaScript；
- `runtime:verify` 通过，14 个页面均具备运行所需的 `.js/.json/.wxml/.wxss`；
- `runtime:verify` 同时将 `dist/build-info.json.sourceRevision` 与最近一次影响小程序运行输入的提交对照，避免
  提交更新后继续导入旧的 `dist/`；脱离 Git 的归档验证必须显式设置
  `HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION`；
- 构建阶段继续检查 WXML 事件方法、已注册页面跳转、本地资源存在性，以及 WXSS 不通过 `background-image` 读取本地图片；
- 页面生命周期守卫、患者切换、会话恢复、报告详情和费用/预约只读边界的原生验收全部通过；
- 当前提交还包含患者选择空目录的 stale 语义修正，以及首页/选择页不能覆盖同步解析结果的门禁：已有选择不会被降级为“从未绑定”，测试覆盖该业务边界。

## 3. 开发者工具使用边界

开发者工具必须打开 `apps/miniprogram/`，并使用公共 `project.config.json` 的 `miniprogramRoot=dist/`。
修改 `src/` 后必须重新执行 build；不能直接把 `src/` 作为小程序根目录，也不能只上传单个页面目录。

本机 `project.private.config.json` 仍由开发者工具管理，且构建检查要求 `setting.ignoreDevUnusedFiles=false`；
它不属于业务源码或发布证据。当前工作树中已有用户自己的 `project.config.json` 修改，本次构建未覆盖该修改。

## 4. 尚未证明的事项

本记录不能证明：

1. 开发者工具和真机已经加载本次 `dist/`；
2. 微信 `wx.login()`、Redis TTL、会话恢复和患者目录同步成功；
3. 多就诊人切换、失效/恢复和旧患者异步结果隔离已通过真实页面验收；
4. 预约历史、报告目录、门诊费用的 Provider、公网和真机链路成功；
5. 支付、医保、预约写入、退款、HIS 回写或二维码协议已经开放。

下一步必须在受控微信会话中按“登录 → 患者同步 → 显式切换患者 → 我的挂号 → 门诊费用只读”逐页取证，
并同时保存页面结果、服务端 `traceId/requestId` 和低敏业务日志；代码测试或运行包存在不能替代这些证据。
