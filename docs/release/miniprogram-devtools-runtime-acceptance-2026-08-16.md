# 原生小程序开发者工具运行时验收（2026-08-16）

本文记录一次真实开发者工具运行错误及修复结果。它只证明本地 `dist/` 运行包的模块加载边界，
不替代微信真机登录、患者同步、Provider 或生产公网业务验收。

## 1. 复现证据

开发者工具项目为 `apps/miniprogram/`，公共配置的 `miniprogramRoot` 为 `dist/`，构建产物中实际存在：

```text
apps/miniprogram/dist/services/page-instance-state.js
```

在 `project.private.config.json` 使用 `setting.ignoreDevUnusedFiles=true` 时，模拟器首页真实报错：

```text
MiniProgramError: module 'services/page-instance-state.js' is not defined
require args is '../../services/page-instance-state'
```

调用栈落在 `pages/index/index.js`，页面内容为空。该错误不是后端接口、微信登录或 Provider 错误，
而是开发者工具没有把 CommonJS 页面脚本的间接依赖加入调试模块图。

## 2. 修复

- 本机 `apps/miniprogram/project.private.config.json` 已将 `ignoreDevUnusedFiles` 改为 `false`；该文件
  仍保持本地忽略，不把本机工具设置上传到 Git。
- `apps/miniprogram/scripts/build.ts` 在 private 配置存在时强制检查该值，避免以后重新打开错误优化；
  新机器没有 private 配置时不阻断构建。
- `apps/miniprogram/README.md` 已说明 `dist/` 运行根目录、重新构建和普通编译顺序。
- 重新执行 `pnpm --filter @hospital/miniprogram build`，14 个 `app.json` 页面脚本全部生成；原生小程序
  52 项测试通过。

## 3. 开发者工具复核

重新普通编译并等待模拟器刷新后：

- 首页完整显示旧版医疗服务布局；
- `page-instance-state.js` 模块错误消失；
- 调试器在模块加载完成时为 `Errors: 0`；
- 后续出现的 `__subPageFrameEndTime__` 空对象异常来自微信基础库/开发者工具热重载内部栈，
  与业务脚本无调用关系；同时存在基础库 `getSystemInfo`、灰度基础库和 SharedArrayBuffer 提示。

因此当前结论是“运行包模块边界已修复，微信工具自身提示仍需按工具版本处理”，不能据此宣称真机业务验收完成。

## 4. 后续操作

1. 修改 `apps/miniprogram/src` 后执行 `pnpm --filter @hospital/miniprogram build`。
2. 确认本机 private 配置保持 `ignoreDevUnusedFiles=false`。
3. 在微信开发者工具中执行一次普通编译，确认调试器没有新的业务模块错误。
4. 再进行真机微信登录和患者链路验收，并保存真机截图、`requestId` 和服务端日志事件。
