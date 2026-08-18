# 小程序认证响应会话代际门禁（2026-08-18）

## 为什么要补这一层

上一轮已经隔离了患者同步的 single-flight，但普通患者目录、个人资料、预约记录、报告目录、门诊费用和支付预支付请求仍可能在网络等待期间跨越一次会话轮换。页面级请求 token 只能识别“当前页面是不是最新一次加载”，不能识别另一个页面或页面栈是否已经换了微信账号。

因此，旧账号的 HTTP 请求即使最终返回 HTTP 200，也不能直接交给新账号的页面。服务层必须在认证响应交付前再次确认会话代际。

## 实现规则

- `session-generation.ts` 只保存内存数字，不保存 token、openid、患者号、请求参数或日志内容。
- `api-client.ts` 的 `requestWithSession` 在确保当前 token 后记录会话代际。
- `requestForSession` 只有在响应返回时仍处于同一代际，才向业务层 resolve；代际变化时统一拒绝 `session-changed`。
- 401 的既有单次重试规则保持不变：如果其他并发流程已经拿到新 token，则以新 token 和新代际重试；否则清理旧会话、重新登录，再以新代际发起一次请求。
- 该门禁只负责阻止旧响应回写，不对已经发出的 PUT、预支付或其他副作用做回滚。资料更新依赖服务端版本冲突，支付依赖幂等键和订单查询；支付、医保和 HIS 写入仍未开放。

## 测试与检查

- 新增延迟微信请求回归：旧请求等待期间推进会话代际，随后返回 200，Promise 必须拒绝 `session-changed`，不能返回旧快照。
- 小程序 typecheck：通过。
- 小程序测试：115 项通过、0 失败、997 个断言。
- Biome format：228 个文件通过；Biome lint：229 个文件通过。
- 运行包来源必须在下一次构建后重新核对；旧 `dist/build-info.json` 不能作为本次源代码变更的运行证据。

## 发布边界

- 本轮只修改新仓库中的原生小程序客户端、客户端测试和文档。
- 未修改旧 Python 服务、数据库 schema、Redis 数据、Provider 配置或线上 release；未重启任何服务。
- 真机验收仍必须同时取得页面截图、HTTP trace 和当前 release 的低敏业务日志，不能用本地测试替代真实微信会话证据。

## 关联验收

患者同步本身的 single-flight 会话隔离见 [`miniprogram-session-generation-isolation-2026-08-18.md`](miniprogram-session-generation-isolation-2026-08-18.md)。
