# 小程序候选 `c4dc00b9`：就诊主 Tab 广度迁移壳（2026-08-25）

> 候选来源：`c4dc00b9bea82375d79d13eb7c6e78e14e0a569d`。
> 本记录是当前候选事实源；`b3436c24` 保留为前一候选，`90d5ab03` 及更早版本仅作历史追溯。

## 1. 候选边界

| 项目 | 当前事实 |
| --- | --- |
| Git 来源 | `c4dc00b9bea82375d79d13eb7c6e78e14e0a569d` |
| staging 运行包 | `.local/hospital-miniprogram/pending/` |
| 页面脚本 | 17 个已生成页面脚本 |
| 自动化测试 | `253 pass / 0 fail / 2115 expect()` |
| 类型检查 | `pnpm --filter @hospital/miniprogram typecheck` 通过 |
| 当前 live dist | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍被开发者工具占用 |
| 旧服务 | Python `8001` 未修改、未停止；本轮没有修改服务器、MySQL 或 Redis |

## 2. 本候选完成的广度迁移

- “就诊”主 Tab 复刻旧端患者栏、今日/未来/历史三标签和固定高度查询状态容器。
- 就诊页接入 App 全局会话、owner-scoped 患者目录和统一“切换就诊人”入口；切换患者后由页面生命周期重新读取上下文。
- 仅迁移页面结构和患者上下文，不调用旧端 WebSocket、队列位置接口、旧 provider 患者号或预约历史作为实时动态。
- 新增回归门禁，确保三标签存在、患者切换可达、状态容器稳定且实时接口仍关闭。

## 3. 发布事实

构建已完成类型检查和 staging，但原子替换 `apps/miniprogram/dist/` 时收到 Windows `EBUSY`，原因是微信开发者工具仍占用 live 目录。pending 候选已保留，旧 live 运行包没有被半替换。

发布前必须关闭开发者工具及真机调试会话，然后执行 `pnpm --filter @hospital/miniprogram runtime:publish-pending`；发布后再执行 `runtime:verify` 并生成新二维码。旧 `fcc6630e` 二维码不能证明本候选。

## 4. 下一批迁移顺序

继续先完成其他旧页面的安全静态/只读落点和迁移台账，再按业务域冻结病历、问诊、住院、健康内容、互联网医院和实时就诊 contract。患者绑定、二维码、预约写入、支付、医保、退款和 HIS 回写继续最后处理。
