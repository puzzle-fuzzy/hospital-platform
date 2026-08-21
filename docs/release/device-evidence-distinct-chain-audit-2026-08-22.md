# 真机双请求证据独立关联审计（2026-08-22）

## 结论

普通资料和预约目录都不是单次 HTTP 请求：

- 普通资料必须分别证明 `GET /api/v2/me/profile` 和 `PUT /api/v2/me/profile`；
- 预约目录必须分别证明科室目录和当前科室排班。

此前真机证据工具虽然校验了两条请求的方法、路径、HTTP 状态和服务端业务 contract，
但没有阻止两条证据复用同一个 `requestId/traceId` 或同一个服务端 `correlationFingerprint`。
这会让人工复制同一条链时看起来像完成了双请求闭环，削弱日志验收的可信度。

## 本次修正

`tools/device-evidence-audit.mjs` 现在对以下双请求域增加独立性门禁：

| 业务域 | 客户端必须不同 | 服务端必须不同 |
| --- | --- | --- |
| 普通资料 | `client.read` 与 `client.update` 的 `requestId/traceId` | `server.read` 与 `server.update` 的 `correlationFingerprint` |
| 预约目录 | `client.departments` 与 `client.schedules` 的 `requestId/traceId` | `server.departments` 与 `server.schedules` 的 `correlationFingerprint` |

任何一组重复都会在证据审计阶段失败，不能通过修改业务状态为 `passed` 绕过。
该修正只影响脱敏验收清单和日志关联门禁，不改变 API 路由、Provider 请求、患者数据、支付状态或旧 Python 服务。

## 验证

- 新增 4 条回归断言，分别覆盖普通资料和预约目录的客户端 requestId 重复、服务端指纹重复；
- 真机证据工具测试通过；
- 后续真实验收仍需使用同一候选取得页面、客户端请求和服务端日志三层证据，工具通过不等于业务已验收。
