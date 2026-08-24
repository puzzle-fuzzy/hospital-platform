# 预约记录与爽约记录跨版本查询链路审计（2026-08-24）

> 本文是旧项目与重制项目的只读源码对照记录。审计期间没有修改 `G:\\fuck\\hospital`，没有调用旧服务接口，也没有读取或改写患者数据。
> 文中“新端”指 `E:\\__Super_Core__\\hospital-platform` 的重制版本；它尚未作为正式小程序候选发布。

## 1. 审计结论

本轮没有发现需要立即修改的新端查询逻辑。新端已经保留了旧端最关键的业务语义，同时把旧端容易产生歧义的部分收紧为明确契约：

1. “在线挂号”和“全部挂号”是两个不同的 Provider 查询意图，不在客户端把在线结果复制成全部结果。
2. “爽约记录”只取过去 90 天，并且只展示服务端归一化为 `missed` 的记录；进入页面不再强制打开患者选择模块。
3. 页面始终先建立固定的列表状态外壳，再在外壳内部切换加载、错误、空数据和记录内容，避免加载文字消失后空状态图片把卡片高度突然撑大。
4. 新端使用 `status` 归一化结果过滤记录；旧端在线列表使用了返回模型中没有声明的 `statusCode`，这是旧端的历史缺陷，新端没有继续复制。

因此，如果后续真机上“我的挂号”仍然为空，下一步应该采集当前线上候选的客户端请求、服务端 `requestId`、Pino `appointment-records` 事件和 Provider 响应摘要，再判断是患者映射、Provider 数据、时间窗口还是服务端异常；不能仅凭页面空状态继续改日期或状态过滤。

## 2. 旧端实际查询语义

旧端链路为：

```text
my_registration.vue
  -> companion / appointment module
  -> getAppointmentInfosApi(patId, params)
  -> /msun-middle-business-appointment-server/v1/appointment-infos/{patId}
```

关键行为如下：

| 页面意图 | `requestChannel` | 日期范围 | 旧端来源 |
| --- | --- | --- | --- |
| 在线挂号 | `3` | 当前日期前后各三个月 | `hospital-app/src/pagesB/user/my_registration.vue` |
| 全部挂号 | `4` | 不主动限制日期 | 同上 |
| 未来就诊辅助查询 | 默认由接口函数回退到 `4` | 当前日期至未来三个月 | `hospital-app/src/api/modules/companion.ts` |
| 历史就诊辅助查询 | 默认由接口函数回退到 `4` | 过去三个月，旧代码还会传带时分秒的范围 | 同上 |

旧端还固定传递 `isMzFlag=1` 和 `dateFlag=1`。记录映射使用 Provider 的 `status` 数字：`0` 已预约、`1` 已取消、`3` 已就诊、`4` 爽约、`5` 停诊、`6` 替诊、`7` 已登记，其他值回退到 Provider 的 `statusName`。

### 旧端发现的缺陷

旧端在线列表的过滤代码是：

```ts
registrations.value.filter((item) => item.statusCode !== 1)
```

但同一文件映射时保存的是 `status: item.status`，没有生成 `statusCode`。这会导致已取消记录不能按预期被排除，并且把一个未声明字段当成业务状态来源。该问题属于旧项目历史代码，本次没有直接修改旧项目。

## 3. 新端当前查询语义

新端把 Provider 数字渠道隐藏在 adapter 内部，只向页面暴露稳定的 `online | all` 意图：

| 页面意图 | 内部 scope | Provider 渠道 | 日期范围 |
| --- | --- | --- | --- |
| 我的挂号 - 在线 | `online` | `3` | 中国标准时间前后各 90 天 |
| 我的挂号 - 全部 | `all` | `4` | 不带日期参数，由 Provider 返回历史范围 |
| 爽约记录 | `online` | `3` | 中国标准时间过去 90 天 |

服务端 adapter 还固定传 `isMzFlag=1`、`dateFlag=1`，并且对 `all` 发现日期参数时直接拒绝，不让 Provider 猜测调用方意图。新端的核心链路为：

```text
小程序页面
  -> dashboard-service 生成患者作用域查询
  -> 新 API 的预约记录路由
  -> provider patient reference 解析
  -> zhongyang appointment adapter
  -> domain 归一化公共读模型
```

对应实现位置：

- [`packages/adapters/src/zhongyang-appointments.ts`](../../packages/adapters/src/zhongyang-appointments.ts)：渠道、日期参数、`isMzFlag/dateFlag` 和 Provider 字段映射；
- [`packages/domain/src/appointments.ts`](../../packages/domain/src/appointments.ts)：记录状态、日期、时间和展示字段的运行时校验；
- [`apps/miniprogram/src/services/dashboard-service.ts`](../../apps/miniprogram/src/services/dashboard-service.ts)：中国标准时间窗口和患者作用域查询；
- [`apps/miniprogram/src/services/appointment-record-view.ts`](../../apps/miniprogram/src/services/appointment-record-view.ts)：在线/全部展示过滤；
- [`apps/miniprogram/src/pages/appointment-records/appointment-records.ts`](../../apps/miniprogram/src/pages/appointment-records/appointment-records.ts)：标签切换重新请求对应 scope，并做本地分页；
- [`apps/miniprogram/src/pages/missed-appointments/missed-appointments.ts`](../../apps/miniprogram/src/pages/missed-appointments/missed-appointments.ts)：独立爽约页面入口和 `missed` 状态过滤。

### 新端为什么不直接复用旧端 `patId`

页面只提交平台内部 `patientId`。服务端先确认登录用户与患者绑定关系，再解析短生命周期的 Provider 患者引用交给 adapter；公共响应重新投影为部门、医生、日期、时间、地点、序号和稳定状态，不把 `patId`、预约主键、费用字段或支付字段返回给小程序。

这条边界会让“数据为空”的排查更依赖日志链，但能避免前端缓存旧患者 ID、患者切换竞态或 Provider 主键泄露。不能为了让页面出现数据而把旧端的 Provider ID 直接塞回新端。

## 4. 页面状态与患者上下文

### 我的挂号

预约历史页面会先读取当前登录用户和当前选中的患者，再请求对应记录；切换标签时重新请求对应 Provider scope。请求期间旧记录会清空，但患者选择行、标签栏和列表状态外壳保留，避免上一位患者的记录短暂挂在新患者名下。

记录过多时，Provider 结果仍按完整查询语义取得，小程序只按 10 条一批展开本地渲染。这不是 Provider 分页，也不能被解释为“只查到第一页”。

### 爽约记录

爽约页面是登录用户范围内的独立入口。它会使用当前已选患者读取过去 90 天记录，并在服务端读模型基础上只保留 `status=missed`；页面没有嵌入“选择就诊人”模块，只有顶部已选患者条可以跳转到患者选择页。未登录时才会进入登录边界。

### 加载、错误和空数据

页面 WXML 保留固定的列表状态外壳：

```text
固定卡片/列表容器
  ├─ loading：骨架占位
  ├─ error：错误说明与重试
  ├─ empty：空状态图与“未查询记录”
  └─ success：记录卡片
```

这样加载态和空态在同一个容器内切换，不再因为“正在加载……”文字先出现、随后被图片替换而改变父卡片高度。患者信息加载期间使用不可点击的骨架行，避免把尚未确认的患者上下文误当成可操作数据。

## 5. 当前证据边界与下一步

本次是源码和测试审计，不是线上业务验收。当前本地小程序候选为 `d32c5ce9653935e6f66bead9526bc8d0fa639b37`，线上配套运行包仍为 `13f597ea9ee3f65b9be858117826d948339d904a`；本地候选没有发布到线上。

后续如果继续核对“我的挂号”原数据，应按以下顺序留证：

1. 真机确认当前页面、当前患者姓名和当前标签；
2. 记录客户端预约请求的低敏 URL、scope 和 requestId；
3. 在同一 requestId 下检查服务端的 `appointment-records`、患者作用域解析和 Provider trace；
4. 区分“Provider 返回空数组”“患者引用未解析”“日期窗口无记录”“公共模型拒绝响应”和“依赖暂时不可用”；
5. 只有证据确认契约错误后，才修改 adapter、日期窗口或页面过滤。

本审计没有打开预约写入、爽约写入、支付、医保授权、结算或 HIS 回写，也没有修改旧服务、旧数据库、旧 Redis 或线上配置。
