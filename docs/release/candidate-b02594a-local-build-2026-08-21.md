# 当前小程序候选 `b02594a` 本地构建记录（2026-08-21）

> 本文记录当前仓库提交 `b02594a521cae2d12b991d2361c80224572c79b0` 的本地小程序运行包。
> 它尚未上传微信开发者工具线上代码包，也不代表真实微信登录、Provider 或真机业务已经验收。

## 本轮变更

预约目录的日期分组、日期标签和本地展示窗口已从页面文件抽取到纯展示服务：

- `formatAppointmentDateLabel()` 固定用 UTC 读取医院 `YYYY-MM-DD` 业务日历，避免设备时区漂移；非法日期原文回退。
- `groupAppointmentSchedules()` 只负责已校验排班的展示分组和同日数量统计，不伪造 Provider 分页。
- `visibleAppointmentSchedules()` 只扩大已经取得的本地读模型窗口，并把非法、非正窗口收敛为空，避免负数 `slice()` 展示尾部数据。
- 页面仍保持左侧科室、右侧日期/号源的两层异步守卫；本轮没有打开预约写入或改变 Provider 请求合同。

核心逻辑和边界均有中文注释，行为测试直接验证纯函数，不再依赖页面源码字符串。

## 构建证据

| 检查 | 结果 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `b02594a` |
| 小程序构建来源 | `b02594a521cae2d12b991d2361c80224572c79b0` |
| 小程序代码提交 | `b02594a521cae2d12b991d2361c80224572c79b0` |
| `pnpm --filter @hospital/miniprogram test` | 189 项通过，0 项失败，1465 个断言 |
| `pnpm --filter @hospital/miniprogram typecheck` | 通过 |
| `pnpm exec biome check`（本轮源文件） | 通过 |
| `pnpm --filter @hospital/miniprogram build` | 通过；14 个 `app.json` 页面脚本已发布 |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过 |
| `dist/build-info.json` 来源 | `b02594a521cae2d12b991d2361c80224572c79b0` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | 0 个 |
| 旧 Python 服务、线上配置、MySQL、Redis | 未修改、未重启 |

## 真机前操作

微信开发者工具若仍报：

```text
ENOENT .../apps/miniprogram/dist/services/single-flight.test.js
```

这不是当前运行包缺少业务文件，而是工具仍持有历史增量模块索引。应停止当前真机调试，关闭并重新打开
`E:\__Super_Core__\hospital-platform\apps\miniprogram\`，确认 `miniprogramRoot` 为 `dist/`，先普通编译，再生成新二维码。
不要在 `dist/` 手工创建测试脚本。当前桌面工具同时存在旧 `mp-weixin` 项目时，只能操作标题为 `miniprogram` 的新项目，
不得用旧项目窗口生成二维码。

本轮自动化观察到 `miniprogram` 窗口在开发者工具进程列表中短暂出现后又消失，未操作 `mp-weixin` 旧项目；因此尚未把普通编译、扫码和手机页面结果记为完成。

## 未完成门禁

当前候选仍需人工取得同一会话的：

1. 微信登录、`/me`、患者同步的页面/HTTP/服务端低敏日志三层证据；
2. 多就诊人显式切换后预约历史、爽约和门诊费用只读链路的三层证据；
3. Provider 合同、支付、医保、退款和 HIS 回写专项证据。

支付、医保、预约写入和 HIS 写入继续保持关闭。
