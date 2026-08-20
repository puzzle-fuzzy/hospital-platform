# 小程序患者同步会话证明记录（2026-08-20）

## 发现的问题

患者同步是 `POST /patients/sync` 命令，不能把“同步请求自己在请求层自动登录”当作
会话证明。旧链路先进入进程级患者同步协调器，再由 `requestWithSession` 发现本地没有
token 并执行微信登录；登录会推进会话代际，协调器随后会把本来属于当前账号的成功响应
误判为 `session-changed`。用户可见现象是“微信登录成功，但刷新就诊人失败”。

## 当前正确顺序

```text
必要时 wx.login -> POST /auth/wechat
                    |
                    v
              GET /me（owner 证明）
                    |
                    v
              POST /patients/sync（幂等键）
                    |
                    v
          当前会话代际的进程级 single-flight
```

`syncPatientsFromHospital` 现在先调用只读 `/me`：

- 没有 token 时，安全完成一次微信 code 兑换后再进入同步协调器；
- token 过期时，GET 可以按现有规则安全换会话，避免把失效 token 直接用于命令；
- `/me` 成功后才捕获同步协调器的会话代际，患者同步返回不会再被这次合法登录误判；
- 首页、患者选择页仍共享当前会话代际的在途 Promise，服务端 owner、幂等键和持久化租约
  继续负责跨进程和重启后的最终保护。

这个 `/me` 只是会话 owner 证明，不读取头像、昵称、手机号或患者隐私字段，也不改变
患者 Provider 的字段契约；旧 Python 服务和旧端口不参与本次变更。

## 验证

- `dashboard-service.test.ts` 新增回归测试，确认无 token 时请求顺序严格为：
  `/auth/wechat` → `/me` → `/patients/sync`。
- 小程序完整测试：169 项通过，1331 个断言通过。
- TypeScript 类型检查：通过。
- 运行包构建及真机扫码仍需在本次代码提交后重新执行；这些静态证据不能替代真实微信会话、
  客户端请求号和服务端低敏日志的三层验收。
