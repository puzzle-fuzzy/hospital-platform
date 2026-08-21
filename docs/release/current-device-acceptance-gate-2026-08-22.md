# 当前真机准入记录（2026-08-22）

## 结论

当前新项目的代码、构建产物和仓库门禁均通过；真机业务验收仍未开始。原因不是运行包缺文件，而是桌面上的微信开发者工具会自动恢复旧项目 `mp-weixin`，不能把旧项目模拟器、旧控制台或旧网络请求当作新项目证据。

本记录只描述新项目的当前准入边界，不修改旧 Python 项目，不重启旧服务，也不把旧项目的业务日志并入新项目证据。

## 当前发布基线

| 项目 | 当前值 |
| --- | --- |
| 服务端生产 release | `002acc1be5cdd1b16c2c249f5dbbf9f7c65dbd10` |
| 小程序运行包来源 | `90fd7832e3ad1031c9c916f118f90cc0f2840aff` |
| 小程序短提交 | `90fd783` |
| 小程序运行根目录 | `apps/miniprogram/dist/` |
| 注册页面数 | 14 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |

上述基线由 `pnpm release:baseline:audit` 和 `pnpm --filter @hospital/miniprogram runtime:verify` 共同校验；不能只凭开发者工具标题或模拟器画面判断来源。

## 本轮门禁结果

在仓库根目录 `E:\__Super_Core__\hospital-platform` 执行 `pnpm check`，结果为通过：

- 架构边界审计通过，共 67 条规则；
- 14 页迁移台账、Provider 文档接收审计和 443 篇 Markdown 链接审计通过；
- 发布基线与当前服务端/小程序来源一致；
- Biome 格式检查和 lint 通过；
- 9 个 workspace 包 typecheck/test/build 全部通过；
- API 测试 204 pass、0 fail；
- 小程序构建再次生成完整 `dist/`，并通过运行时页面清单门禁。

这些结果只证明代码和运行包候选可进入验收，不证明微信登录、患者切换、预约、报告或门诊费用已经在真机完成。

## `single-flight.test.js` 错误的固定处理

`src/services/single-flight.test.ts` 是测试输入，不能复制到 `dist/`。构建脚本会在 TypeScript 编译配置和最终文件清单两层排除测试脚本；若真机错误仍指向
`dist/services/single-flight.test.js`，说明开发者工具或旧真机调试会话保留了旧增量模块索引。

正确处理顺序是：

1. 结束旧真机调试会话；
2. 关闭开发者工具当前项目或清理其编译/文件缓存；
3. 重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，不能打开 `dist` 或 `src`；
4. 普通编译后确认项目配置的 `miniprogramRoot` 仍为 `dist/`；
5. 再生成二维码并开始真机验收。

禁止手工新增 `dist/services/single-flight.test.js`，否则会把测试代码混入运行包，并掩盖开发者工具来源错配。

本次重新加载新项目时还发现过 `module 'services/@hospital/contracts.js' is not defined`：这是微信运行时不解析
pnpm workspace 裸模块名造成的真实运行包问题，已在前一候选 `47be0bc` 中改为小程序本地的无第三方依赖时间校验模块，
并增加了与共享契约边界一致性的测试。当前重新编译后的控制台不再出现该错误；不能通过向 `dist/` 手工复制 workspace 包来规避。

## 当前未形成的证据

当前没有以下新项目三层证据：

- 微信登录请求、会话签发、患者目录同步的同链服务端日志；
- 多就诊人切换和会话漂移后的页面证据；
- 预约目录/历史、报告目录、门诊费用的真实 Provider 请求号和真机结果；
- 支付、医保、HIS 写回等副作用证据。

因此下一步仍应先完成当前候选的真实微信登录和患者切换，再按只读预约、报告、门诊费用顺序验收。支付、医保、退款、预约写入和 HIS 回写继续保持最后专项。
