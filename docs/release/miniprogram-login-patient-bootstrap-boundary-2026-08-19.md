# 小程序登录后患者初始化边界（2026-08-19）

更新时间：2026-08-19

本文记录首页从微信登录到患者范围业务入口之间的状态边界。它解决的是客户端
“登录成功后是否可以继续执行刚才点击的动作”，不代表真实微信真机、Provider、
多患者切换或业务写入已经验收。

## 1. 发现的问题

首页原先把 `onSyncPatients()` 的异常留在页面内部处理，并且始终返回已完成的
`Promise<void>`。登录链无法区分以下两种情况：

1. 患者目录和临床映射同步成功；
2. 同步失败、会话代际变化或页面请求已经失去回写资格。

因此，登录成功后触发报告、我的挂号或门诊费用等患者范围页面时，可能在患者上下文
尚未确认的情况下继续执行 `afterSuccess`。同时，同步请求发出前旧患者卡片仍可能短暂
留在首页，形成“新会话验证中/临床映射未确认，但旧患者仍可用”的错误快照。

## 2. 当前契约

`apps/miniprogram/src/services/patient-bootstrap.ts` 定义四种初始化结果：

| 结果 | 含义 | 是否允许患者范围回调 |
| --- | --- | --- |
| `skipped` | 目标页面会自行读取目录，例如预约目录或选择页 | 否；仅允许非患者范围动作 |
| `succeeded` | 首页已完成本轮患者目录和临床映射同步 | 只有存在已确认患者时允许 |
| `failed` | 同步失败，页面已清理展示态 | 不允许 |
| `superseded` | 请求被新的页面请求或会话代际淘汰，旧结果不能回写 | 不允许 |

患者范围入口（报告目录、我的挂号、门诊费用）显式声明 `requiresPatient: true`。
登录链只有同时满足以下条件才调用 `afterSuccess`：

- 当前登录请求仍属于最新会话 guard；
- 初始化结果不是 `failed` 或 `superseded`；
- 患者范围动作已经拿到当前轮次确认的 `selectedPatient`。

## 3. 患者展示态处理

首页 `onSyncPatients()` 在发出同步请求前调用 `clearDisplayedPatientContext()`，只清理
页面上的患者列表、当前患者和数量，不删除本地保存的 opaque `selectedPatientId`。
同步成功后再由 `resolveStoredPatientSelection()` 按 owner-scoped 目录恢复显式选择；
同步失败或请求被淘汰时保持清理态，等待用户重试或显式重选。

这条规则很重要：本地 ID 只能用于恢复后的 stale 判断，不能在临床映射未确认时单独
充当当前患者事实，也不能因为同步失败而自动切换到目录第一位患者。

## 4. 代码与测试门禁

- 首页登录链：`apps/miniprogram/src/pages/index/index.ts`
- 初始化结果纯函数：`apps/miniprogram/src/services/patient-bootstrap.ts`
- 纯函数回归：`apps/miniprogram/src/services/patient-bootstrap.test.ts`
- 原生页面/源码契约：`apps/miniprogram/scripts/acceptance.test.ts`

本轮已通过：

- `pnpm --filter @hospital/miniprogram typecheck`
- `pnpm --filter @hospital/miniprogram test`
- 小程序测试 `155 pass / 0 fail`，共 `1244` 个断言

## 5. 未扩大的范围

本修正只改变新原生小程序的客户端状态机、中文注释和测试门禁，不新增患者绑定、
预约写入、支付、医保、HIS 或二维码协议；没有修改旧 Python 项目、旧服务、API、
数据库、Redis 或线上小程序包。真实微信登录、真实多患者切换和 Provider 字段仍须
按独立的真机与日志证据验收。
