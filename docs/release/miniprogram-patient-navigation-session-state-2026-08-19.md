# 小程序患者入口会话状态收紧（2026-08-19）

> 状态：已完成本地代码、测试和类型检查；尚未上传或替换线上小程序包，未修改 Elysia 生产服务、数据库、Redis 或旧 Python 服务。

## 1. 发现的问题

患者范围页面的“更换就诊人”入口原先允许导航函数使用默认值：只要本地存在
`access_token`，就可能被当作已经登录。这个判断只能证明设备上有一个待尝试的凭证，
不能证明服务端仍接受它，也不能证明它属于当前会话代际。

受影响的页面是：

- 我的挂号；
- 爽约记录；
- 报告目录；
- 门诊费用。

这些页面虽然进入后仍会通过受保护请求暴露 `401`，但入口层已经先错误放行，造成
“页面可以进入、随后才发现会话失效”的不一致体验，也让业务代码继续依赖兼容性判断。

## 2. 修正后的业务规则

所有受保护导航统一只接受以下四态：

| 状态 | 来源 | 入口行为 |
| --- | --- | --- |
| `checking` | `/me` 尚未完成 | 提示验证中，不导航 |
| `valid` | `/me` 成功并通过 owner 校验 | 允许进入选择页/业务页 |
| `invalid` | 服务端明确返回未授权 | 提示登录并回首页 |
| `unavailable` | 网络、Redis、持久化等暂时故障 | 提示稍后重试，不删除可重试会话 |

四个患者范围页面现在都遵循同一顺序：

```text
页面开始加载
  -> 清理上一轮患者读模型
  -> 调用 /me 验证当前会话
  -> 验证成功后读取 owner-scoped 患者目录
  -> 校验当前显式 patientId
  -> 读取预约/报告/门诊费用
```

页面不能把 `loadCurrentPatient()` 内部的请求层自动登录当作入口授权状态；
入口状态必须由页面实例显式保存并传递给 `patient-navigation`。

## 3. 代码边界

- `apps/miniprogram/src/services/patient-navigation.ts` 不再接受 `boolean`，也不再默认读取本地 token；
- `AppointmentRecordsPageData`、`MissedAppointmentsPageData`、`ReportDirectoryPageData`、`OutpatientPaymentPageData` 增加 `sessionState`；
- 四个页面先调用 `getCurrentUser()`，再启动患者目录和业务读取；
- 异步请求被旧页面周期淘汰时，不得把 `valid` 或错误状态写回新周期；
- 该门禁只负责会话入口，不替代服务端 owner 校验、患者映射校验和页面级异步 request guard。

## 4. 验证证据

- 小程序测试：`163 pass / 0 fail`，`1302` 个断言；
- 小程序 TypeScript：`pnpm --filter @hospital/miniprogram typecheck` 通过；
- 变更文件 Biome lint：通过；
- acceptance 门禁新增断言：导航函数必须显式接收会话状态，不能出现 `hasPlatformSession()` 默认放行；
- 本轮没有使用真实微信会话，没有把模拟器或静态测试写成真机验收证据。

## 5. 发布和后续边界

这次修正只影响小程序源码和本地候选构建，不需要重启服务端，也不触碰旧 Python
服务的 `8001` 端口。提交后仍需重新执行全量 `pnpm check` 和小程序构建，生成新的
候选来源后才能进入扫码前门禁。真实手机验收仍必须同时取得页面、HTTP trace 和
服务端低敏日志三层证据；支付、医保、预约写入、患者绑定和二维码继续保持各自的
contract gate。
