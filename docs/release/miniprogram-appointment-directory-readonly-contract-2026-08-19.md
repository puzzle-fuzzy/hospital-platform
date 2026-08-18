# 小程序预约科室与排班只读响应边界（2026-08-19）

## 结论

本轮继续收紧原生小程序预约目录的读取边界，不开放锁号、预约写入、取消、微信支付、医保结算或 HIS 回写，
也不修改 Provider、MySQL、Redis、旧 Python 服务或线上服务端 release。

预约页是“两列级联”页面：先读取科室，用户明确选择科室后，再读取该科室的排班。此前客户端只检查
`total === items.length`，没有在收到 JSON 后复核每条科室/排班记录；现在 `dashboard-service.ts` 增加第二道
canonical 运行时门禁：

- 科室必须有安全且唯一的 `departmentId`、有效 `displayName`，可选的 `departmentCode`/`location` 也必须符合文本边界；
- 排班必须有唯一的 opaque `scheduleId`、完整医生/科室展示字段、真实自然日和有限的 `timeGroup`；
- `availableSlots`、`totalSlots` 必须是非负安全整数，且不能出现可用号源大于总号源；
- 排班的 `departmentId` 必须等于本次右栏请求对应的科室，防止快速切换或代理串台后把其他科室号源展示出来；
- 任何一条记录异常都整批返回 `provider-response-invalid`，不能筛掉坏数据后伪装成完整目录；校验后只重新投影公开字段。

## 业务边界

`scheduleId` 只是服务端生成的 opaque 只读引用，不是客户端预约授权，也不能直接转换为锁号、挂号或支付参数。
页面仍按既有 token 和科室选择状态机处理异步响应，服务端仍负责 Provider 归属、排班快照、过期时间和未来写入前的
授权校验。小程序的运行时校验不能替代服务端权限判断。

## 本地证据

- `dashboard-service.test.ts` 新增科室重复标识、异常展示字段、排班科室串台、非法日期、号源越界、未知时间分组和重复
  `scheduleId` 的回归用例；
- 小程序定向测试 `148` 项通过、`1178` 个断言通过，TypeScript 类型检查通过；
- 代码提交为 `add8266`，已推送 `origin/main`；用户已有的 `apps/miniprogram/project.config.json` 未触碰、未暂存、未提交。

## 未完成项

本轮没有取得新的真机页面、当前服务端 trace 或 Provider 业务证据，因此不能把本地响应校验宣称为预约目录真实验收。
预约写入、锁号、取消、挂号费、微信支付、医保授权、退款和 HIS 回写继续保持关闭。
