# 三类临床查询页面状态一致性记录

状态：已实现，待真机回归

日期：2026-08-28

## 1. 本轮发现

“我的挂号”“我的问诊”和“门诊病历”原先分别维护自己的加载、错误和空列表外壳：

- 页面有的用 `loading || error || !items.length` 推断状态，有的直接按 `ApiError` 显示“暂不可用”；
- 加载态、失败态和合法空结果的卡片高度与图标不一致；
- 问诊和门诊病历把患者未绑定、映射不可用、服务未配置、Provider 暂时失败等错误压成同一类文案；
- token 自动恢复时，旧实现把“token 失效 → 重新登录”误报为“登录账号已切换”。

## 2. 当前实现

三个页面现在都使用 `ClinicalQueryState`：

| 状态 | 页面行为 |
| --- | --- |
| `loading` | 固定高度查询占位，显示“正在查询记录...” |
| `ready` | 展示当前就诊人的记录窗口 |
| `empty` | 仅在查询链返回合法空结果时显示统一空图和“未查询到您的记录” |
| `error` | 顶部显示服务端稳定错误文案，卡片显示“查询未完成”和重试入口 |

公共视觉骨架位于 `apps/miniprogram/src/styles/clinical-query-state.wxss`。
页面仍保留各自的患者、业务字段和卡片内容，不把不同领域的数据模型合并。

## 3. 错误语义

页面不再使用“只要是 `ApiError` 就显示暂不可用”的分支，而是通过客户端稳定错误码翻译：

- `dependency-not-configured`、Provider 拒绝/超时、持久化故障：显示服务暂时不可用并允许重试；
- `patient-not-bound`、`patient-selection-stale`、`patient-clinical-unavailable`：显示患者上下文错误，并允许进入统一就诊人选择页；
- `appointment-record-patient-not-found`、`medical-record-patient-not-found`：显示当前就诊人暂无可查询记录，不再误报成泛化的服务不可用；
- `unauthorized`：保持登录失效语义，不引导用户把它当成空列表。

空结果和错误仍然是两个不同的状态；“暂无记录”不能用来掩盖服务未配置或 Provider 故障。

## 4. 会话恢复边界

小程序的会话事件现在区分：

- `account-switched`：只有 `/me` 或微信登录响应确认了不同 owner，页面才清理旧患者和旧记录；
- `session-invalidated`：token 失效时由全局资料仓库清理资料快照，页面级监听不打断 GET 自动恢复，因此不会无故出现“登录账号已切换”。

最近确认的 owner 保存在 `App.globalData.sessionOwnerId`，token 轮换本身不再作为账号切换事实。

## 5. 线上配置边界

2026-08-28 只读核对服务器环境得到：

- 旧 Python 仍监听 `0.0.0.0:8001`；
- 新 Elysia 监听 `10.0.0.3:18081`；
- `ZHONGYANG_APPOINTMENT_RECORDS_READY=true`；
- `ZHONGYANG_MEDICAL_RECORDS_READY` 当前未配置，按 fail-closed 默认值为 `false`。

因此门诊病历在真实环境继续显示“服务暂不可用”是配置门禁事实，不是合法空列表。未完成 Provider、公网 HTTPS 和真机证据前，不打开该 gate，也不把它改成空态。
