# Redis 就绪探针并发边界审计（2026-08-20）

## 发现

API 的 readiness、会话读写和 Redis TTL 维护命令可能在同一时间首次访问 Redis。
旧实现的每条路径都在发现连接未 ready 后直接调用 `client.connect()`；在 ioredis
处于 `connecting` 的短窗口内，第二次连接调用可能被判定为连接竞争，进而把真实的
连接建立过程误报为 `persistence-temporarily-unavailable`。

这个问题与业务写入无关，但会影响登录、患者读取以及真机验收时对“数据服务暂时不可用”
的判断，因此必须在基础设施边界修正，不能由小程序重复点击掩盖。

## 修正规则

`packages/persistence/src/runtime.ts` 现在为同一个 Redis 客户端建立共享连接单飞：

- readiness、会话 `GET/SET` 和 TTL 审计复用同一条连接建立 Promise；
- 只合并连接建立动作，不合并业务命令；
- 不因为网络异常重放资料更新、患者同步或支付等业务写入；
- 连接失败会释放单飞状态，后续请求仍可重新连接；
- 连接错误只进入既有低敏错误类型/错误码日志，不记录 Redis URL、key 或原始错误正文。

## 验证

- 并发连接调用只产生一次 `connect()`；
- 连接失败后下一次调用可以重新建立连接；
- `@hospital/persistence` 类型检查通过；
- persistence 测试 83 项通过；
- 本次未连接线上 Redis、未修改 ACL、未重启服务、未修改旧 Python 服务。

## 业务验收边界

本修正确保依赖连接竞争不会制造假故障，但不等于 Redis 实际 TTL、微信登录、患者
同步或 Provider 业务已经完成真实验收。真机验收仍必须关联同一时间窗口的页面、HTTP
request id 和低敏服务端日志。
