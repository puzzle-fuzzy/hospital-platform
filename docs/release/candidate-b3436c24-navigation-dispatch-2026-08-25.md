# 小程序候选 `b3436c24`：入口分发收口与广度迁移交接（2026-08-25）

> 候选来源：`b3436c24075063fa36e4c31c04ed28c2ad8a93bd`。
> 本记录是当前候选事实源；此前 `90d5ab03` 的候选记录保留为历史，不再代表最新源码。

## 1. 候选边界

| 项目 | 当前事实 |
| --- | --- |
| Git 来源 | `b3436c24075063fa36e4c31c04ed28c2ad8a93bd` |
| staging 运行包 | `.local/hospital-miniprogram/pending/` |
| 页面脚本 | 17 个已生成页面脚本 |
| 自动化测试 | `252 pass / 0 fail / 2100 expect()` |
| 类型检查 | `pnpm --filter @hospital/miniprogram typecheck` 通过 |
| Biome | 变更文件格式化与 lint 通过 |
| 当前 live dist | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍被开发者工具占用 |
| 旧服务 | Python `8001` 未修改、未停止；本轮没有修改服务器、MySQL 或 Redis |

## 2. 本候选完成的迁移收口

- 首页快捷入口、服务分类和“我的”菜单的可见 `action` 均有明确的代码分发 `case`。
- 新增静态回归门禁：页面配置中出现新的可见 action 时，若没有对应分支，测试直接失败，避免入口静默落入通用 Toast。
- 修正“我的”页过时的中文注释，明确 visible menu 的 action 是稳定分发键；展示标题不再被误认为业务路由。
- 保持之前的广度迁移边界：已完成的只读页面继续可用；未取得 provider/HIS/权限/回滚 contract 的入口继续进入带阻塞原因的状态页。

## 3. 发布事实

本候选构建时成功完成源码 staging、17 页依赖校验和测试，但原子替换 `apps/miniprogram/dist/` 时收到 Windows `EBUSY`，原因是微信开发者工具仍占用 live 目录。发布失败是安全的：

- pending 候选已保留，可在释放目录后执行 `pnpm --filter @hospital/miniprogram runtime:publish-pending`。
- live `dist/` 未被半替换，仍然是 `fcc6630e`。
- 在发布 pending 并重新生成二维码前，不能用旧运行包宣称本候选已完成真机验收。

## 4. 下一批迁移顺序

继续按业务域批量推进：先完成病历、问诊/互联网医院、住院、健康内容、实时就诊等只读入口的 contract 矩阵和稳定状态页；取得可验证 provider 数据、患者归属、权限、日志和真机证据后，再逐个开放。患者绑定、二维码、预约写入、支付、医保、退款和 HIS 回写继续冻结到最后。

## 5. 发布后验收

1. 关闭微信开发者工具及真机调试会话。
2. 执行 `pnpm --filter @hospital/miniprogram runtime:publish-pending`。
3. 执行 `pnpm --filter @hospital/miniprogram runtime:verify`，核对来源指纹为 `b3436c24`。
4. 直接打开 `apps/miniprogram/dist/` 独立工程并重新生成二维码。
5. 先验收四个共享原生 Tab，再验收患者显式切换、预约历史/爽约、门诊费用和资料授权；每条业务都保存客户端 requestId、服务端 traceId/业务事件和 Provider 低敏 requestId。

任何一层证据缺失，只记录为“待补证据”，不把构建通过、健康检查或空列表当成业务完成。
