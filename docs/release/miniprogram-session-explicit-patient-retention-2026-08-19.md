# 会话失效后的显式就诊人选择保留边界（2026-08-19）

更新时间：2026-08-19

本文记录小程序会话失效、重新登录和本地就诊人选择之间的安全状态边界。它只描述
新原生小程序的 owner-scoped 客户端逻辑，不代表真实微信真机、多账号切换或 Provider
业务已经验收。

## 1. 业务不变量

用户在选择页明确点选的 `selectedPatientId` 不能因为 token 过期、401 自动清理、
Redis 暂时不可用或微信 code 兑换失败而被静默改成目录第一位患者。

页面展示态必须立即清空，避免失效会话继续展示姓名、关系和脱敏卡号；但本地只保存的
opaque ID 可以保留，等待下一轮 owner-scoped 目录解析：

- 同一微信账号恢复成功，解析为 `selected`，恢复原患者；
- 当前账号目录不再包含该 ID，解析为 `stale`，要求用户显式重选；
- 新账号目录包含其他患者时仍不会自动选择第一位。

## 2. 当前实现

- 首页 `onShow()` 无会话时调用 `clearDisplayedPatientContext()`，不再调用
  `clearSelectedPatientId()`。
- 首页 `onLogin()` 在登录前和登录失败时只清理页面派生数据，不删除本地显式选择。
- `resolveStoredPatientSelection()` 仍负责把当前 owner 的目录与本地 ID 合并；
  患者详情、provider 患者号和身份证信息不会进入本地 storage。
- 用户显式选择新患者时，选择页才会写入新的 opaque ID；服务端绑定写入仍未开放。

这不是放宽跨账号访问：所有患者范围请求仍必须通过服务端 Bearer owner、当前目录和
内部 patientId 门禁；保留本地 ID 只影响下一次目录解析，不能单独授权任何业务请求。

## 3. 回归门禁

- 首页源码门禁：`apps/miniprogram/scripts/acceptance.test.ts`
- 患者解析单元测试：`apps/miniprogram/src/services/patient-selection-service.test.ts`
- 本轮小程序回归：`156 pass / 0 fail`，共 `1248` 个断言
- 类型检查：`pnpm --filter @hospital/miniprogram typecheck`

本轮没有修改 API、数据库、Redis、Provider、线上服务、旧 Python 项目或用户的
`apps/miniprogram/project.config.json`。
