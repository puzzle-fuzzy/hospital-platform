# `ff931d7c` 原生小程序主导航修正候选构建记录（2026-08-24）

> 本文只记录重制项目的本地候选，不代表已经上传微信开发者工具、替换线上小程序、部署服务端或完成真机验收。

## 来源与范围

- 页面代码提交：`ff931d7cbbc50e18649a38e14cd93f389d7487e3`；
- 构建命令：`pnpm --filter @hospital/miniprogram build`；
- 运行包目录：`apps/miniprogram/dist/`；
- `app.json` 页面入口：16 个；
- 新增运行包根组件：`custom-tab-bar/`；
- 线上配套小程序仍为 `13f597e`，本候选尚未发布。

## 本候选包含的修正

1. 四个主入口（医疗服务、就诊、互联网医院、我的）统一注册为正式 Tab 页面；
2. 使用一个共享 `custom-tab-bar` 渲染底部导航，避免首页和“我的”各自复制一份底栏；
3. 主 Tab 切换统一调用 `wx.switchTab`，不再用 `wx.navigateTo` 把“我的”压入普通页面栈；
4. 新增“就诊”和“互联网医院”正式入口，但其未迁移业务保持明确的迁移中状态，不猜测旧外部地址、不伪造业务成功；
5. 保留普通业务页面的 `navigateTo`，仅对主 Tab 使用 `switchTab`；会话失效时的 `reLaunch` 仍是有意的安全回首页行为。

## 校验结果

- 小程序回归：`231 pass / 0 fail / 1747 expect()`；
- 小程序 TypeScript `typecheck`：通过；
- 根目录 Biome lint/format：通过；
- `pnpm --filter @hospital/miniprogram build`：通过，16 个页面脚本和共享 Tab 组件已生成；
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过，运行包中没有测试脚本；
- `docs:audit`：通过，无 Markdown 断链；
- 主导航专项审计：通过，未发现首页/“我的”之外的重复底栏模板或把普通业务页误当主 Tab 的同类结构。

## 发布边界

- 这是本地未发布候选，不是线上小程序运行包；线上配套运行包仍为 `13f597e`；
- 旧 Python `8001`、线上 API、数据库和 Redis 未修改；
- 真实微信登录、患者切换、四个主 Tab 真机页面截图和服务端日志三层证据仍待重新采集；
- “就诊”和“互联网医院”的具体业务迁移仍未完成，当前只完成正式入口和安全迁移提示；
- 支付、医保、预约写入、取消、退款和 HIS 回写继续按迁移台账保持关闭或未注册。
