# 患者端业务正确性规则

本文档把患者端当前已经实现的业务不变量集中记录下来，供新会话、代码评审和真实 provider 验收使用。
代码或 provider 契约发生变化时，必须同时更新本文档和对应测试；“页面能显示”不能代替业务事实已经正确。

## 1. 患者上下文

患者查询的真实调用链固定为：

```text
微信会话 -> 服务端 userId -> owner-scoped 内部 patientId
        -> provider 引用映射 -> provider adapter -> 脱敏读模型
```

API 路由层另外有 `pnpm architecture:audit` 的 owner-scope 结构门禁，检查资料、患者目录、
挂号历史、报告、门诊费用和订单入口仍从当前 Bearer principal 进入 service。该门禁只防止
迁移时的结构漂移，不能把静态字符串检查当成越权验收；owner 条件、Provider 映射和响应脱敏
仍以 API/repository 测试及真实账号验收为准。

### 身份交换的双重边界

微信 `code2session` 的 adapter 负责把微信原始响应收敛成最小身份结果；`session_key`、原始报文和
Provider 扩展字段不得离开 adapter。`AuthService` 在调用 `hp_identity_users` 写入前还必须对可替换的
`WechatIdentityGateway` 结果执行第二次运行时校验和白名单投影，只允许有界的 `providerSubject`、可选
`unionId` 以及固定 provider/operation 的低敏 `trace.requestId` 继续流转。结果对象缺失、身份值含控制字符、
空 `unionId` 或 trace 不符合 contract 时，必须 fail-closed 为 `provider-response-invalid`，不能写入身份表、
不能签发 Redis 会话；日志只记录固定的 `resultViolation`，不记录异常身份值、临时 code 或 provider 原文。

身份仓储返回值也必须经过第二道读模型门禁：登录时 `providerSubject` 必须等于本次 code2session 的身份，
患者同步和预支付时 `userId` 必须等于当前 Bearer owner；`userId`、`providerSubject` 和可选 `unionId` 必须
是有界且无控制字符的 opaque 标识。异常身份读模型统一返回 `persistence-invalid`，不会签发 Redis 会话、
访问患者 Provider、创建预支付尝试或把仓储未知字段带入下游；日志只记录固定 `identityViolation`。

会话 principal 也是持久化读模型，而不是因为 `SessionTokenService.verify()` 的 TypeScript 返回类型就天然可信。
Redis 旧值、手工写入值、内存 fixture 和替换的 token 实现都必须在统一 `requirePrincipal` 入口重新投影：
`userId` 只能是无控制字符、无首尾空白且不超过 64 个字符的 opaque 标识，未知字段必须丢弃。异常 principal
不能降级成 401（否则会把持久化损坏伪装成登录过期并触发无意义重试），也不能进入任何 owner-scoped 查询；
统一返回 `persistence-invalid`，请求日志只保留固定 `readModelViolation=user-id-invalid`，不记录原始会话值。

Provider 读模型的 `trace` 同样不能只依赖端口类型：预约目录/历史、报告目录/详情和门诊费用在 service
层会重新投影 `provider`、`operation`、`requestId` 以及可选的 provider order reference，只允许有界、无控制字符
的低敏字符串进入日志或内部关联，并确认 Provider 仍是当前已配置的 `zhongyang`。trace 异常统一按
`provider-response-invalid` 处理，固定记录 `readModelViolation`，不能把原始 trace 写入 Pino，也不能把错误 Provider
当作成功读模型继续展示。该规则只保护只读链路的证据边界，不代表预约写入、支付、医保或 HIS 已开放。

### 支付订单与报价的持久化读模型边界

支付仍处于“真实支付最后处理”的 gate 之外，但其内部订单状态机不能因为支付尚未开放就放宽数据边界。
订单和报价仓储返回值在进入状态迁移、outbox 或 API 之前，必须由 domain 重新投影：

- 订单的 `orderId`、`ownerUserId`、`patientId` 和幂等键必须是有界 opaque 标识；owner、订单号、患者号和幂等键
  在需要时还要与本次请求的期望值一致。
- `totalFen = insuranceFen + cashFen`、金额为安全整数且总额大于 0；未知状态、非法版本或非法时间戳直接 fail-closed。
- 服务端报价同样必须校验 owner、患者、金额、有效期和来源；不能把报价仓储返回的金额当成“因为有 TypeScript 类型所以可信”。
- 读模型异常统一返回 `persistence-invalid`，请求日志只记录固定 `readModelViolation`，不记录订单原值、完整幂等键、
  provider 报文或支付凭证。该门禁只保护内部事实，不代表微信支付、医保结算、退款或 HIS 回写已经开放。

必须满足：

1. 小程序只保存服务端返回的 opaque `patientId`，不保存 `openid`、`unionid`、完整卡号、身份证号或 provider 患者号。
2. `patientId` 每次都要和当前会话的 `ownerUserId` 联合校验；不能因为客户端传入了一个格式正确的 ID 就直接访问 provider。
   `patientId`、`reportId` 以及预约过滤标识还必须在服务层复核非空、长度不超过 128、无首尾空白和控制字符；这只是形状校验，不能替代 owner、TTL 或 provider 映射校验。
3. 患者目录的 `thirdPatientId` 只属于 `directory` 引用；预约历史、报告和门诊费用显式使用 `his-patient` 引用。
4. 没有 `his-patient` 映射时必须在 provider 请求前失败，不能回退到目录 ID，也不能返回伪造的空成功。
5. 患者目录的“可展示”与“可查询”是两个状态：公共字段 `clinicalAccess=ready` 才允许进入预约历史、
   报告或门诊费用页面；`unavailable` 记录可以保留脱敏资料帮助用户核对，但不能被选中，不能让页面
   把 `directory` 引用当作 `his-patient` 使用。首次没有历史选择时只能默认第一位 `ready` 患者，
   如果已有选择变为 `unavailable`，必须保留该选择的失效原因并要求用户显式选择其他可用患者。
6. 选择页切换患者后，调用页必须重新读取患者目录并重新请求业务数据，不能沿用上一个患者的报告、挂号记录或缴费列表。首页、我的和患者选择页统一使用 `patient-selection-service.ts` 的目录解析错误码；预约记录、爽约记录、报告目录和门诊费用页统一通过 `dashboard-service.ts` 的 `loadCurrentPatient` 完成这次读取与选择解析，并通过 `patientContextErrorMessage` 或 `patientSelectionResolutionMessage` 统一解释患者上下文错误；发起查询和写回异步结果前还必须通过 `isCurrentSelectedPatient` 校验当前 opaque patientId，避免跨页面切换后的旧响应覆盖新患者。该函数只重读平台目录，不隐式触发 Provider 同步。同步只由登录恢复和独立患者选择页负责，完整边界见 [`migration/patient-context-read-contract.md`](migration/patient-context-read-contract.md)。
7. 如果本地已有的 `patientId` 已不在当前 owner 的有效目录中，页面必须进入“请重新选择就诊人”状态；只有本地从未保存过选择时才允许默认目录第一位，不能用 `patients[0]` 静默替换已失效的患者。

   当前目录暂时为空时只清空页面展示，不删除本地选择；目录恢复后仍按已有选择进入 `stale`，必须由用户显式重选。

   患者 service 读取仓储结果时还会执行第二道读模型门禁：目录单次最多 128 条，重新确认每条记录属于当前 owner、
   `patientId` 唯一且有界、展示文本无控制字符、关系/来源/临床可用性属于固定枚举，并重新构造
   公共对象；`cardNumberMasked` 还必须是“前面最多 5 位可见字符 + 连续 `*` + 后面最多 4 位可见字符”，
   或明确的 `未绑定` 哨兵值。完整卡号即使碰巧是合法的短字符串，也必须被判定为
   `patient-card-number-invalid`，不能依赖小程序再做一次脱敏。读模型异常不能降级成 `items: []`，
   服务端只记录固定 `readModelViolation`，返回 `persistence-invalid`，避免损坏数据触发首页把用户误判成“没有就诊人”
   或静默默认到另一位患者。

   患者同步在快照事务前还必须执行 gateway 结果的第二道门禁：完整标志、患者目录字段、provider 患者号唯一性、
   允许的 `directory`/`his-patient` 引用和低敏 trace 都由 domain 重新投影。`complete` 缺失或为假、完整卡号、
   重复 provider 患者号以及未知引用字段统一记录固定 `resultViolation`，返回 `provider-response-invalid`，
   不得创建成功快照，也不得把异常数据留给下一次 GET 才发现。

   快照事务返回值还要经过独立的持久化读模型门禁：事务返回后先记录
   `patient.directory.snapshot.committed`，再重新校验 `activePatients` 的 owner、唯一 ID、脱敏字段和
   `deactivatedPatientCount` 的非负安全整数。只有二次投影成功才记录 `patient.directory.synced`；如果数据库已经提交但
    返回值损坏，只记录 `patient.directory.read.failed`，不能因为读模型异常把已提交快照误报为同步失败，也不能把未经验证的数量
    作为同步成功证据。

    患者完整快照还必须按 owner/provider 串行提交：带 operation lease 的 MySQL
    快照事务会重新锁定 owner 身份行，并拒绝早于已提交成功 operation 的 `observedAt`。
    这样即使旧 Provider 请求在租约过期后才返回，也不能把新快照已经停用的患者重新激活；
    这类结果返回 `patient-sync-stale`，并记录为明确的过期快照事件，而不是伪装成 Provider 故障。
8. 患者目录、报告、挂号记录和门诊费用页面使用“最后一次请求获胜”规则；旧的异步响应即使晚返回，也不能回写当前页面。
   挂号记录和爽约记录在新请求开始时还必须先清理上一位患者的卡片和列表；最新请求守卫只能阻止旧响应回写，
   不能替代请求等待期间的展示隔离。
   爽约页还必须把当前患者卡片和本次已筛选的 `missed` 记录一起提交；在预约历史请求完成前不能先写入患者卡片，
   否则患者切换期间会出现卡片与列表不属于同一患者快照的短暂错配。
   报告目录和门诊费用页同样只能在对应报告/费用读模型通过当前请求和当前患者校验后提交患者卡片；
   只读请求失败、过期或跨患者时，页面不得保留这次请求提前写入的患者上下文。
   门诊费用页在初始患者目录仍在读取时切换待缴/已缴标签，只记录最后点击的状态，不能创建新守卫取消
   owner-scoped 患者读取；确认患者后才允许按该状态查询费用。
9. 预约目录也必须使用“最后一次请求获胜”规则：左栏科室目录和右栏排班是两层异步读取，
   快速切换科室或下拉刷新时，旧科室排班不能覆盖当前科室，旧刷新也不能恢复旧的日期分组和号源。
   下拉刷新开始时还必须清空上一轮科室和排班读模型；仅使旧请求失效不足以阻止 WXML 在新请求等待期间
   继续展示旧号源，失败时也不能把旧目录当作当前事实。Provider 明确返回空科室目录时是可见的空结果，
   页面必须展示空态，不能留下空白页面或把空结果伪装成错误。目录请求和科室排班请求拥有独立的
   loading 结束权：外层目录请求被新科室选择淘汰后不能提前关闭新排班的 loading 状态。
10. 首页下拉刷新必须等待健康检查和服务端患者目录读取结束；患者选择页在目录读取后还必须等待
   完整医院目录同步结束，才能停止刷新指示器。“刷新动画停止”不能被当作临床患者映射已经更新的事实，
   普通首页刷新也不能隐式扩大为 provider 同步请求。选择页只有完整同步成功后才允许点击患者返回调用页；
   页面首帧、目录读取期间或同步失败后可以保留列表帮助诊断，但必须禁止选择，不能让调用页使用尚未确认
   `his-patient` 映射的上下文；从读取或同步开始就必须清除上一轮“当前”展示标记，只有最新目录和
   临床映射同步成功后才能恢复，避免把待确认或失效上下文伪装成仍然有效。本地 opaque `patientId`
   可以保留用于恢复和 stale 判断，但不得在失败时静默换人或删除。
11. 会话恢复没有拿到当前 principal 时，首页不得继续把旧患者派生数据交给预约、报告或费用页面；
   页面应清理自己的患者上下文。依赖暂时失败但 token 尚未被判失效时，只保留 token 供后续重试，
   不能伪造登录成功，也不能把旧患者卡片当作当前微信登录证据。首页的患者目录读取或临床映射同步失败时，
    同样必须清理首页展示状态；本地显式选择可以保留用于恢复和 stale 判断，但不能继续作为当前患者卡片展示。
   “我的”页同样必须清理自身的用户标签、患者卡片和患者数量，但不能因为一次暂时失败删除本地显式选择，
    以便下一次成功的 owner-scoped 目录读取继续恢复正确患者。

   预约记录、爽约记录、报告目录和门诊费用在患者为空、stale 或读取失败时，空态必须提供可点击的患者选择入口；
   不能只显示依赖 `selectedPatient` 卡片的“上方更换”，否则页面虽然安全地清除了旧患者，却把用户留在无法恢复的死路。
12. 小程序任意页面的患者同步正在进行时，所有进入患者选择页的入口都必须停止导航并提示稍后重试。
   不能让不同页面实例用不同的幂等键同时同步同一 owner/provider；进程级协调器负责复用在途 Promise，
   服务端 owner/provider 租约仍是最终保护。只有当前快照收敛后，才允许进入选择页继续读取和切换患者。

   选择页的“目录读取 + 临床同步”必须使用独立的刷新周期 guard；旧同步晚于新一轮刷新返回时，
   不能淘汰新读取，也不能让新调用方只拿到一个绑定旧闭包的 `void` Promise。页面级 single-flight
   可以共享远端同步结果，但每个调用方仍要按自己的刷新周期和同步 token 判断是否有资格回写列表、
   `selectionReady`、错误和 loading 状态。目录先于临床映射返回时，列表可以先用于展示，但必须显式
   禁止恢复本地“当前”标记；只有完整同步成功后才允许恢复选择，避免渲染批次短暂出现未经确认的患者上下文。

   首页 `onSyncPatients()` 的 Promise 只表示本次同步生命周期已经结束，不返回患者数组；成功的空目录和同步失败
   不能通过同一个 `[]` 结果混淆。只有服务端明确返回成功快照时，页面才更新患者展示；失败分支清理展示上下文并
   保留错误和重试能力，不能把错误转换成业务空结果交给后续调用方。

13. 患者范围业务页的入口必须先经过统一四态门禁：会话验证中只能等待，服务端明确未登录时
    回到首页建立平台会话，服务暂时不可用时保留重试状态，只有 `/me` 成功且当前会话有效时才继续；
    已登录但没有当前 `clinicalAccess=ready` 患者进入独立选择页，只有两项都满足时才打开
    我的挂号、爽约记录、报告或门诊费用页面。登录成功后应继续用户刚才触发的动作；预约目录
    是不依赖患者的只读目录，可以跳过患者同步，但不能跳过平台会话。入口门禁只负责路由，
    不替代业务页再次读取 owner-scoped 目录和校验当前 patientId；这样既避免无意义的 401，
    又保留页面级 stale、失效映射和异步回写保护。页面不得以本地 `access_token` 存在替代
    `/me` 验证，也不得用 boolean 兼容参数绕过四态门禁。

14. 只要求平台会话的资料页和患者选择页也必须经过会话门禁：会话失效时回到首页重新登录，
   不能让“我的”页的资料、家庭成员或就诊人入口直接产生 401。患者选择页在会话有效后仍需
   继续执行同步中的导航门禁；会话门禁和同步门禁是两个不同阶段，不能用其中一个替代另一个。
15. “我的”页不能用本地 `access_token` 存在与否直接决定入口是否可用：页面加载期间为 `checking`，
   `/me` 成功后才是 `valid`；服务端明确返回 `unauthorized` 才是 `invalid`，网络、持久化或其他依赖
   故障统一是 `unavailable`。`checking` 和 `unavailable` 只提示等待/刷新，不导航也不删除本地会话，
   防止过期 token 被延迟到资料、患者或挂号页面才暴露，也防止一次 503 被误处理为退出登录。
   `/me` 成功确认当前 principal 后，才能启动“我的”页的患者目录和普通资料读取；
   已被新的页面周期淘汰的旧请求不能再扩展出新的受保护业务请求。这样会话失败不会制造额外的 401 噪声，
   且患者上下文不会在会话状态尚未收敛时提前进入页面状态。
16. 没有保存最近 `/me` 结果的旧患者范围页面调用选择页时，统一入口至少实时读取本地 token；如果上一轮
   401 已清除 token，不能继续使用默认 `true` 绕过登录门禁。实时 token 检查只是最低保护，不能替代页面
   已有的四态验证结果，也不能把 token 存在推导成未过期。

17. 首页的 `sessionStatus` 必须映射到统一的四态会话门禁：`验证会话中` 只能等待，
    `已恢复会话`/`已登录` 才算最近一次验证成功，`未登录` 才允许走微信登录，
    `会话暂不可用` 只能提示重试并保留 token。预约目录、报告、我的挂号、门诊费用和
    更换就诊人不能只用 `hasPlatformSession()` 直接跳转；登录成功后的原动作仍由首页继续，
    避免恢复中的 token 提前发出患者范围请求或把持久化暂时故障误判成已退出。

18. 任意页面收到 `401/unauthorized` 并清理全局 token 后，首页下一次 `onShow` 必须同时清理
    页面患者派生数据和 `sessionStatus`；主动重新登录从发起请求起进入 `验证会话中`，直到服务端
    成功或明确收敛为失败。不能只清除 token 而保留“微信已登录”文案，也不能在登录请求期间继续让
    预约、报告、挂号或费用入口使用上一次的有效状态。

19. 小程序请求层只能对幂等的受保护 `GET` 读取自动刷新会话并重试一次；`PUT`、`POST` 和 `DELETE`
    命令收到 `401` 后不得把原请求体、幂等键或支付意图带到新会话。若请求等待期间已经发生账号切换，
    必须返回 `session-changed` 并保留新 token；若当前 token 已失效，只清理旧会话并让页面在用户确认
    当前账号后重新触发业务动作。资料保存、患者同步和支付预支付都不能依靠通用鉴权重试来保证命令安全，
    必须由调用方显式重新点击/确认，服务端仍以 owner、幂等键和最终状态查询作为第二道边界。

预约历史状态按旧端源码明确使用的业务含义保留：`0=scheduled`、`1=cancelled`、`3=completed`、
`4=missed`、`5=stopped`、`6=substituted`、`7=registered`；该映射的来源是旧端
`src/pagesB/hospital/registration_detail.vue` 和 `src/api/modules/companion.ts`，它是当前只读迁移的
legacy evidence，不等于已经取得新的 Provider 写入契约。只有新 Provider 文档/脱敏 fixture 未确认的状态才进入
`unknown`；一旦新合同与旧端实现不一致，必须先更新 adapter contract 和测试，不能继续沿用旧数字。停诊、替诊和已登记不能折叠成
未知，否则患者无法区分医院侧变更与自身未就诊。

预约记录 Provider 的 HTTP 成功和业务成功必须同时成立：旧接口确认的 `success=true` 或 `code=0/0000`
才允许进入记录映射；`HTTP 200 + data=[]` 不能覆盖业务失败码。adapter 映射后，service 还要再次验证日期、
状态和展示字段，并只投影公共字段，避免可注入网关把 `appointmentInfoId`、患者号、费用或支付字段带入响应。
任一条记录不符合 contract 都拒绝整批，记录 `appointment.records.failed` 的有限 `resultViolation`，返回
`502/provider-response-invalid`；只有明确成功的空数组才能显示“暂无预约”。

预约科室和排班目录同样不能直接浅拷贝 gateway 结果：service 必须再次校验科室/排班的文本边界、
真实工作日、时间分组、号源数量和 Provider 排班号唯一性，并重新构造公共对象。Provider 扩展字段不能
进入 API 或排班快照；排班快照只保存服务端生成的 `scheduleId` 与服务端内部的 Provider 引用，不能因为
快照写入成功就推导出已具备锁号、预约或支付授权。非法目录结果记录固定 `resultViolation` 并返回
`provider-response-invalid`，不能筛掉坏科室/坏排班后伪装成完整级联目录。

“我的挂号”的“在线挂号/全部挂号”标签必须区分渠道事实和状态筛选：旧端的在线查询
固定使用 `requestChannel=3`，并在页面排除明确的 `cancelled`；全部挂号则需要独立的
`requestChannel=4` 请求。新端当前只完成前者，因此保留全部标签的视觉位置，但点击只提示
“查询正在迁移中”，不能把同一批在线结果复制成全部记录，也不能在小程序内猜测渠道参数。
只有 `requestChannel=4` 的 provider contract、owner 映射、日期窗口、失败/超时语义和脱敏样例
冻结后，才允许开放全部标签；当前缺口与停止条件见
[`migration/request-channel-4-all-records-contract-audit-2026-08-18.md`](migration/request-channel-4-all-records-contract-audit-2026-08-18.md)。

## 2. 同步和历史数据

患者同步现在采用“完整 provider 目录快照 + 事务状态更新”：重复同步不会因为随机生成新的内部 ID 而重复创建相同目录患者；
本次目录出现的患者恢复 `active`，本次完整目录中没有出现的 provider 患者标记为 `inactive`。数据库唯一键和 repository
负责最终并发保护。

10. 小程序页面的“首次 `onShow` 不重复 `onLoad` 请求”状态必须属于页面实例本身，不能使用模块级变量。页面栈
    叠加、快速返回或开发者工具热重载时，模块变量可能被多个实例共享；共享后会漏掉患者切换后的刷新，或把
    旧页面的生命周期判断套到新页面上。首页、预约记录、爽约记录、报告目录、门诊费用和“我的”页统一使用实例内的
    `hasShown` 状态，首次展示只消费 `onLoad` 已发起的请求，后续返回才重新读取 owner-scoped 患者目录。

当前代码通过 `0015_patient_directory_sync_operations` 形成跨进程、跨重启的 operation ledger、租约代次和
当前读模型重放能力，并通过已应用的 `0016_patient_directory_sync_owner_index` 增加同一 owner/provider 的
跨幂等键活跃租约索引。当前服务器新 API 的线上 release 是 `687690e`，schema marker、索引列和 schema probe 均已核对通过；发布与共存证据见
[`release/687690e-production-acceptance-2026-08-18.md`](release/687690e-production-acceptance-2026-08-18.md)。此前 release 的运行记录只作为历史证据保留。真实患者并发、provider 和真机证据仍缺，
不能把基础 runtime smoke 当作线上业务验收。因此不能把患者同步的重复请求语义直接当作预约写入、患者绑定或支付命令的
幂等实现；高风险命令开放前仍必须分别冻结各自的持久化操作状态、处理中结果和 key 冲突规则。
具体实现边界、租约接管和“患者快照与操作成功同事务”要求见
[`migration/patient-sync-idempotency-contract.md`](migration/patient-sync-idempotency-contract.md)。

“provider 当前目录中已不存在的患者”不能直接物理删除。报告引用、费用记录和未来支付订单可能仍然依赖该内部患者，
因此同步事务只更新状态并保留内部 ID：

```text
当前目录快照 -> active/inactive 状态
历史业务引用 -> 保留 owner + patient 约束
重新出现的患者 -> 恢复 active，不更换内部 patientId
```

只有 adapter 明确返回完整目录（当前众阳接口返回 `complete: true`）时才允许执行失效回收；如果未来 provider 改为分页，
必须先在 adapter 内合并全部分页再提交快照。事务失败时整批回滚，不能留下半套目录。生产环境的 0013 migration
和 schema probe 已完成，但仍需受控账号验收失效/恢复语义，不能把代码测试或 schema 完成当作业务状态证明。

同步并发还必须满足“快照发起时间单调生效”：`observedAt` 在 provider 请求发出前采样，
持久化层拒绝用更早的快照覆盖更新资料、临床引用或 `active` 状态。这样即使较早请求因网络抖动晚返回，
也不会把新同步已经停用的患者重新激活；同一规则在内存测试仓储和 MySQL 条件更新中保持一致。

完整快照对用途专用映射也具有权威性：如果当前患者没有返回 `his-patient`，持久化层必须在同一
事务中清除旧临床映射；目录 `thirdPatientId` 仍可用于展示目录，但预约、报告和门诊费用不能再
复用旧 `patId`。旧快照不能执行这次清理，普通单条 upsert 也不能假装自己是完整快照。

## 3. 日期和时间

- API 的日期筛选使用 `YYYY-MM-DD`，服务端先验证真实日历日期，再调用 provider。
- 当前预约排班、预约历史和报告目录按 `endDate - startDate` 的 UTC 日历零点差值限制跨度，分别为 31、366、366 天；
  这不是把首尾都计入后的日期条目数量，provider 的 `endDate` 包含规则仍待合同冻结。
- 预约科室目录的日期窗口由服务端生成；排班公共接口当前仍接收 startDate/endDate，服务端只校验真实日期和
  31 天跨度，小程序再按中国标准时间生成未来 7 天窗口。这个过渡边界必须在 Provider 的 endDate 包含规则和
  公共调用方范围确认后再收紧为完全服务端生成，不能把客户端日期直接当作 Provider 授权或分页事实。
  门诊费用的最近 30 个中国标准时间日则由服务端生成；所有这些窗口都不等于 provider 分页。
- 众阳门诊费用接口的时间格式固定为 `YYYY-MM-DD HH:mm:ss`，业务时区是 `Asia/Shanghai`。
- 任何 provider 时间窗口都不能使用 `Date#getHours()`、`getDate()` 等服务器本地时区方法；必须显式声明业务时区并写跨时区测试。
- 小程序预约历史、报告和门诊费用的查询窗口也统一按中国标准时间计算，不能因为用户设备时区
  或开发者工具时区变化而跨日；“我的挂号”覆盖当前日前后各 90 天，“爽约记录”只覆盖过去 90 天，
  报告继续使用过去 30 天；服务端仍会再次校验日期范围，客户端不能放宽服务端上限。
- 原生小程序的 `createAppointmentRecordQuery` 是“我的挂号”和“爽约记录”共享的唯一查询构造边界：
  `history` 只能生成前后各 90 天，`missed` 只能生成过去 90 天，并在生成请求前拒绝空的内部
  `patientId`。客户端还必须与服务端 opaque contract 对齐，拒绝首尾空白、控制字符和超过 128
  个 UTF-16 code unit 的损坏标识；这只是请求前置清理，不替代服务端 owner 校验。页面不应分别拼接
  日期或把 Provider 患者号带入请求；对应的自然日、窗口和标识形状回归测试必须保持在 dashboard service 层。
- 预约历史的 Provider smoke 也必须发送与“我的挂号”相同的前后各 90 天窗口；只验证过去到当天
  会漏掉未来预约，不能作为该业务不变量的验收证据。
- Provider 失败不能只记录一个笼统的 `Error`：认证、预约、门诊费用和报告的失败事件必须在不记录
  原始报文的前提下保留 `providerOperation`、`providerRequestId`、`providerStatusCode` 和
  `providerRetryable`（有值时）。这样 `provider-request-rejected` 可以和 Provider 网关请求关联，
  但不能把 Provider 的患者数据、费用字段、URL 或凭证写入日志。
- Provider smoke 构造日期时必须把绝对时间转换为 `Asia/Shanghai` 的自然日；UTC 时间在北京时间
  午夜附近不能直接截取 `toISOString()` 的日期部分，否则会让预约、报告和排班验收跨日偏移。
- 预约和门诊费用 adapter 进入公共读模型前必须拒绝控制字符、首尾空白和超长展示文本；排班快照的
  `scheduleId`、provider 排班引用和 request id 也必须经过同样的安全文本边界。不能把 Provider 返回的
  异常文本保存为快照后再依赖页面或数据库转义补救，否则会污染日志关联、页面布局和未来写入前的引用事实。
- 患者目录 adapter 对 `unionId`、目录患者号、姓名、卡号和 HIS `patId` 使用同一控制字符边界；发现
  控制字符必须拒绝整次目录快照，不能静默清洗后继续建立患者映射。档案接口缺少 `patId` 也不能直接
  解释成“患者没有档案”，除非 Provider contract 明确区分“无记录”和临时/权限/响应异常。
- 患者目录响应数组的每一项必须是普通对象；`null`、字符串和嵌套数组等形状错误必须在 adapter
  边界保留 Provider request id 并映射为 `provider-response-invalid`，不能落成原生 TypeError、500
  或部分成功，也不能在坏元素被发现前启动其它患者的档案查询。
- 预约、报告和门诊费用 adapter 也必须沿用同一错误事实边界：响应包络、条目、字段、状态或重复标识
  不合法时设置 `responseInvalid=true`；只有 Provider 明确返回失败布尔值或失败业务码时才设置为 false。
  这样 API 才能稳定区分 `provider-response-invalid` 与 `provider-request-rejected`，日志聚合和小程序提示
  不会把上游格式污染误判为业务拒绝。
- adapter 之后的 service 仍必须对可注入 gateway 结果做第二道运行时校验并重新投影。不能因为 TypeScript
  端口已经声明了报告摘要或 LIS 详情类型，就直接展开返回对象；报告目录/详情只能构造 contract 白名单字段，
  非 LIS 报告号、重复 LIS 报告号、非法状态、非法检测项和 Provider 扩展字段必须整批拒绝或丢弃，且失败日志
  只能记录有限的 `resultViolation`，不能记录 Provider 原文、患者字段、文件 URL 或报告号。
- 患者目录的整批结构校验必须先于逐患者 `patInfosFind` 查询；不能因为 Promise 并行而让有效患者先产生
  档案查询副作用，再在另一位患者字段非法时整体失败。只有全量预校验通过后才允许并行查询，且 HIS
  引用重复仍必须让整批失败。
- 报告详情的短期 opaque 引用在创建、过期计算和 owner + patient 查询时必须使用同一个服务端应用时钟；
	不能分别读取各机器本地时间，否则会出现目录刚返回引用、详情却被提前判定过期的错误。
- 报告详情不能把 `reportId` 当作独立授权凭证；仓储查询必须同时绑定当前会话 owner、当前选中
  `patientId`、`reportId` 和 TTL。这样即使旧页面栈或手工请求带入另一位就诊人的引用，也只能得到
  `report-not-found`，不能访问 Provider。
- 小程序报告详情页在发起请求前、以及响应准备回写前，也必须确认页面携带的 `patientId` 仍等于设备当前
  明确选择的患者；这只是旧页面栈和慢响应的展示隔离，不能替代服务端 owner + patient + reportId + TTL
  复核。患者切换后必须丢弃旧详情，不得因为该报告对同一账号仍然合法就继续展示。
- 报告目录一次 provider 响应生成的所有短期详情引用必须共享同一个观察时间样本；
  不能在批量处理每条报告时分别取时钟，避免同一批数据出现不一致的 `createdAt`/`expiresAt`。
- 单条报告的短期详情引用持久化失败时，目录必须保留该报告的安全摘要并省略 `reportId`，同时记录
  `report.detail_reference.failed`；不能把详情能力的短暂故障扩大成整批报告目录失败，也不能把失败伪装成“没有报告”。
- 预约目录返回的 `workDate` 是医院业务日历值；页面展示星期和月日时必须按固定日历解析，不能
  使用设备本地时区的 `getMonth()`、`getDate()` 或 `getDay()`。

## 4. 列表和大结果集

- 当前患者端列表响应的 `total` 必须等于本次返回的 `items.length`；它不是 provider 的隐藏总数，
  也不能被页面当作分页总页数。
- 小程序 `dashboard-service.ts` 在患者目录读取与同步、预约科室/排班/历史、报告目录和门诊费用的统一
  列表边界重新校验 `items` 数组、非负安全整数 `total` 以及两者相等关系；网关、缓存或前后端版本错配时
  返回 `provider-response-invalid`，不能把协议异常降级成空列表、成功同步快照或继续展示不一致的“加载更多”。
- 当前没有服务端分页字段。预约排班和报告页的“加载更多”只是本地渲染分批，不能降低 provider 请求的
  返回量；服务端日期窗口仍是防止无限查询的第一道边界。
- 已确认的 provider 空数组只能映射为 `200 + items: [] + total: 0`；映射失败、身份缺失、权限拒绝、
  依赖未配置和暂时不可用必须保持错误状态，不能静默变成空态。
- 预约历史的输入校验、依赖未配置、owner 映射和 Provider 请求失败都必须记录
  `appointment.records.failed`；只有 Provider 明确返回空数组时才记录 `appointment.records.synced` 且
  `itemCount=0`。页面不能从缺失的失败日志或 HTTP 200 反推“没有预约”。
- 报告目录的日期校验、owner 映射和 Provider 失败必须记录 `report.directory.failed`；详情依赖未配置、
  owner/patient/TTL 查询和 Provider 失败必须记录 `report.detail.failed`。只有 Provider 明确返回空目录时才记录
  `report.directory.synced(itemCount=0)`；报告详情依赖未配置不能被解释为“报告不存在”。
- 报告目录未指定来源时是 LIS、PACS、ECG 的完整聚合查询；由于公共 contract 没有 `partial` 状态，
  任一来源失败必须整批失败，不能用 `Promise.allSettled` 只返回成功来源并静默漏掉其他报告类型。
- 首页二维码入口只能在当前页面已经确认同一会话的患者目录后展示“二维码协议未开放”状态；
  本地缓存的 opaque `patientId` 只用于 stale 恢复判断，不能被当成当前患者事实，也不能据此生成、
  拼接或发送二维码内容。医院扫码字段、有效期、短期 token 和失效语义未冻结前，未确认患者只能显示
  “请先登录并选择就诊人”，不能把缓存 ID 误报成可扫码患者。
- 科室、排班、预约历史和门诊费用当前保留 adapter 返回顺序；报告 adapter 明确按报告时间倒序、类型和
  标题升序排列。客户端不能把“第一项”或数组位置当作业务优先级、本人患者或最终状态。
- 门诊费用 `recordId` 必须由 Provider 单据、就诊或项目稳定标识组合生成，不能使用返回数组下标；
  缺少稳定标识或同一响应生成重复 ID 时，adapter 必须拒绝整批结果。待缴与已缴查询的返回顺序或金额变化
  不能让同一费用记录更换平台引用，否则后续详情、订单和支付编排无法安全关联。
- Provider 费用文本必须在 adapter 边界按公开 contract 的长度拒绝：科室名和医生名最多 128 个字符，账单日期最多 64 个字符；不能让超长 Provider 文本先进入业务读模型，再依赖响应序列化阶段兜底。
- 门诊费用 `billDate` 不是任意展示文本，必须严格符合 `YYYY-MM-DD HH:mm:ss`，并校验真实自然日及时分秒范围；带时区的 ISO 文本、非法日期和越界时间必须在 adapter 边界整批拒绝，不能交给小程序按设备时区猜测。服务层还必须再次确认每条账单落在本次服务端生成的最近 30 个中国标准时间日闭区间内，不能只依赖 Provider 筛选。
- 门诊费用金额和展示字段只能使用 Provider 已确认的 contract 字段；旧端遗留的 `waitPayAmount`、`registerDept`、`registerDoctor` 未确认前必须忽略，不能作为 `amountFen` 或科室/医生名称的 fallback。
- 2.6.33 的 `tradeStatus` 不能压扁成二值支付状态：只有 `1=待支付` 映射为公共 `unpaid`、`3=已支付` 映射为公共 `paid`；
  `2=已生成结算`、`4=退款中`、`5=已退款`、`9=作废` 在独立结算/退款 contract 确认前必须整批 fail-closed，不能显示为已支付或可支付。
- 报告详情的单位字段必须在 adapter 边界限制为最多 64 个字符；报告名称、检测结果和参考范围则分别遵循公开 contract 的 256 字符上限，且报告 adapter 的所有展示文本都要归一化首尾空白并拒绝控制字符。短期 `reportId`、患者内部 ID 和 provider 报告号落库前也必须拒绝首尾空白和控制字符，不能让内部任务绕过 adapter 后污染引用和日志检索。
- 普通资料的昵称和邮箱同样必须在 API service 边界拒绝控制字符；不能只依赖小程序单行输入、正则或数据库列类型，避免绕过页面的直接请求把换行/NUL 写入资料读模型。
- 预约历史如果 Provider 返回 `appointmentInfoId`，adapter 必须拒绝同一响应中的重复预约号；
  缺少预约号时只保留安全摘要，不根据日期、流水号或数组位置伪造公共业务 ID。页面的渲染 key
  只是列表 diff 辅助值，不能被详情、取消或状态刷新当作预约身份。
- 真正服务端分页/游标开放前，必须先冻结排序键、快照一致性、重复记录、续取失败和 `total` 语义，并补充
  provider 样例、adapter 测试、页面竞态测试和公网/真机证据。

## 5. 只读业务和写入边界

当前患者端只读链路为：患者目录、预约科室/排班、预约历史、报告摘要、门诊费用列表。只读 provider 响应必须先经过 adapter 白名单映射，再进入 API contract。

门诊费用除 adapter 的第一道映射校验外，`OutpatientPaymentService` 还必须对注入网关的公开读模型做第二道
校验：每条记录的归一化状态必须等于本次查询状态，`recordId` 必须是有界 opaque 标识且在同一响应内唯一，
账单时间必须是严格有效的中国标准时间并落在本次请求窗口内，金额和展示文本必须满足公共 contract。任一项失败都返回 `502 provider-response-invalid`，记录
低敏的 `resultViolation`；校验通过后还必须重新构造白名单对象，不能把 gateway 的额外字段浅拷贝到 API。
不记录原始响应，不过滤坏记录后继续返回，也不把异常降级成空列表。

门诊费用页即使展示“待缴费”记录，也仍然只是查询结果；页面提示不得沿用会暗示支付、退费或医保已开放的旧端文案，支付入口必须等独立契约验收后再出现。

以下结果不能从 HTTP 200、页面点击成功或支付回调直接推导：

- 号源已经锁定；
- 预约已经写入 HIS；
- 门诊费用已经结算；
- 微信支付或医保支付已经最终成功；
- HIS 已经完成回写。

这些操作必须分别具备状态机、幂等键、最终状态查询、金额守恒、补偿和真机验收证据后再开放。

## 6. 错误和日志

业务失败必须保留安全错误码和 `traceId`，页面给出可重试或明确迁移状态；页面只能通过稳定错误码映射
用户文案，不能直接读取 `Error.message`，也不能把 provider 原始错误报文展示给患者。未知错误码必须回退
到页面安全文案，同时保留 `requestId/traceId` 供日志排障。

日志允许记录内部资源 ID、状态、provider 操作名、provider request id、HTTP 状态和可重试判断；禁止记录 token、openid、unionid、session_key、完整患者身份、provider 患者号、原始报文、支付签名和密钥。

门诊费用服务在调用 owner-scoped 患者映射前拒绝空白 `patientId`；映射、持久化或 provider 失败都必须留下
`outpatient.payment.records.failed`，不能只返回错误而没有业务事件，也不能把失败伪装成空费用列表。服务层还必须拒绝
超长、首尾空白或控制字符标识；这些非法值在失败日志中统一记为 `patientId=invalid`，不能原样回写日志。
网关读模型校验失败同样必须进入该失败事件，日志只保留有限枚举的 `resultViolation`，不能写入费用单号、金额或
Provider 原始错误文本。

普通个人资料更新也必须 fail-closed：请求体只允许 `version`、`displayName`、`gender`、`age` 和
`email`。`avatar`、`openid`、`unionid`、`userId` 或其他未知字段必须在 API contract 边界返回
`400 validation`，不能依赖序列化层静默清洗后返回成功；否则旧端字段会被误认为已迁移，后续维护也无法
判断资料更新到底保存了哪些内容。通过校验后仍必须执行当前 Bearer owner 检查和 `version` 乐观锁，
版本过期返回 `409 user-profile-conflict`。

资料 service 不能把 TypeScript 的仓储返回类型当作数据库事实：`get` 和 `update` 返回前都必须再次确认
当前 owner、昵称/邮箱的无控制字符和长度边界、性别枚举、年龄范围以及持久化版本，并按公开资料白名单
重新投影。读模型错 owner、非法字段或非法版本时必须 fail-closed 为 `persistence-invalid`，不能降级成
“微信用户”、空资料或已更新成功；`user.profile.loaded` / `user.profile.updated` 只能在这道门禁通过后写入，
否则日志会把响应层失败错误地记录成业务成功。

小程序资料页的 GET 和 PUT 必须共用同一套服务端快照投影。PUT 成功后不能只回写 `version`，也不能继续
把本地输入当作最终资料；页面必须完整采用服务端返回的昵称、性别、年龄、邮箱和版本。这样服务端在
持久化边界执行 trim、空值归一化或其他合法规范化时，页面不会出现“提示保存成功但仍展示请求前值”的
短暂假事实；同一投影也能避免 GET 与 PUT 分别维护字段映射而产生漂移。

资料页和患者选择页的成功返回不是“调用后立刻无条件 `navigateBack`”：toast 期间允许用户手动离开，
所以延迟返回必须绑定到当前页面实例，并由 `onUnload` 直接清理定时器；页面卸载后不能再调用 `setData`。
延迟回调执行前还要再次检查页面实例的
待返回标志，防止旧页面在页面栈已经变化后误弹出调用页或其他新页面。性别 picker 的事件值也必须先
归一化到页面声明的 `male`、`female`、`unknown` 三个选项，再同时更新枚举值、索引和文案，不能把
非法索引写入页面状态。

## 7. 当前未完成验证

代码和单元测试通过不等于真实业务完成。当前仍需在受控测试身份上分别完成：

- 重新打开 `apps/miniprogram/` 的正确开发者工具项目并使用当前 `3a89312` 运行包完成真机三层证据；
  近期复扫只形成健康检查日志，尚未形成微信登录、患者同步和页面 HTTP 的同链证据；
- 患者重新同步后的 `his-patient` 映射证据；
- 公网 API 和真机的预约历史、报告、门诊费用只读验收；
- 受控账号上的患者目录失效/恢复数据、真机证据和同步日志中的 `hisPatientReferenceCount`；
- 预约写入、现金支付、医保结算、HIS 回写和二维码协议的独立契约验收。
