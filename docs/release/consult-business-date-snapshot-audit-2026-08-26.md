# 就诊页业务日快照审计（2026-08-26）

## 结论

已修复一个跨零点会改变页面业务语义的问题：就诊页服务端查询、未来/历史分组和本地加载更多现在共享同一个中国标准时间业务日快照。

这不是视觉微调。预约历史返回的是一批已经取得的只读事实，页面切换标签不应因为设备当前时间变化而重新解释这批事实；只有用户重新进入页面或主动重试，才建立新的读取批次和新的业务日。

## 原问题

旧实现只在首次读取预约记录时使用 `requestNow` 计算业务日：

- 首次加载能够保持服务端查询范围与页面分组一致；
- 点击“未来就诊/历史就诊”时重新调用 `formatPlatformDate(new Date())`；
- 点击加载更多时再次重新读取当前日期；
- 页面如果在中国标准时间零点前打开、零点后操作，同一批结果会发生标签漂移；
- 空的业务日字符串还可能被当作全部记录的比较基准。

## 代码调整

| 文件 | 调整 |
| --- | --- |
| `apps/miniprogram/src/pages/consult/consult.ts` | 在 `loadContext()` 开始时固定 `requestNow` 和 `businessDate`，标签切换/加载更多只读取页面快照 |
| `apps/miniprogram/src/services/consult-record-view.ts` | 集中生成记录窗口，明确 today 实时壳、未来/历史筛选、分批展开和空快照 fail-closed |
| `apps/miniprogram/src/services/consult-record-view.test.ts` | 覆盖跨零点语义、加载更多保持快照和空快照不误判为未来 |
| `docs/release/candidate-0d28b72-miniprogram-runtime-2026-08-26.md` | 记录本候选运行包、门禁和发布边界 |

代码中的中文注释明确说明：`businessDate` 是服务端读取批次的业务日，不是每次点击时重新计算的设备日期；今日实时队列仍然关闭，不能把预约摘要当作叫号事实。

## 验证证据

- 定向就诊窗口测试：4 pass / 0 fail / 12 expect()；
- 小程序全量测试：288 pass / 0 fail / 3225 expect()；
- 小程序 TypeScript 类型检查：通过；
- 三个相关文件 Biome 检查：通过；
- pending 运行包验证：通过，来源 `0d28b7241f40de95f4049d7d2a18e07f6f162268`，20 个页面；
- live `dist` 发布：因微信开发者工具锁定返回 `EBUSY`，旧 live 运行包保持不变，pending 候选已保留。

## 广度迁移边界

本次只修复 A 批次只读预约历史页面的时间一致性，不扩大预约写入、取消、支付、医保、HIS 回写、实时就诊或 Provider contract。旧 Python 服务、旧数据库、旧 Redis 和另一会话负责的众阳预约适配器均未修改。

真机验收仍需在发布 `0d28b72` pending 后重新生成二维码，并在预约历史域追加“跨零点后切换标签仍使用同一读取批次”的页面、客户端 requestId、服务端 traceId 和 Provider 低敏 requestId 证据。
