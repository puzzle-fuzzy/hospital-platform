# 当前 API 认证边界只读审计（2026-08-24）

> 本文只记录公网 GET 探针，不包含登录、患者读取、Provider 调用、数据库写入、Redis 写入或支付动作。旧 Python `8001`、线上配置和正式小程序包均未修改。

## 审计窗口

- 时间：2026-08-24 18:41 CST
- 公网入口：`https://test-hp.meiyi.pro`
- 服务端发布基线：`28a5c0c131794ce9dcc5f94bd3809402188ac87a`（`28a5c0c1`）
- 线上小程序运行包：`13f597ea9ee3f65b9be858117826d948339d904a`
- 本地未发布小程序候选：`2bf9d8d9f67521067d761b48cc2bfec449ef1348`

## 结果

| 请求 | 结果 | 说明 |
| --- | ---: | --- |
| `GET /api/v2/health/live` | 200 | 服务存活，返回 `status=ok` |
| `GET /api/v2/health/ready` | 200 | `database=ok`、`redis=ok`、`schema=ok` |
| `GET /api/v2/system/ping` | 200 | 版本化公共入口可达 |
| `GET /api/v2/me/profile` | 401 | 未携带会话不能读取普通资料 |
| `GET /api/v2/appointments/records` | 401 | 未携带会话不能读取预约记录 |
| `GET /api/v2/payments/outpatient/records` | 401 | 未携带会话不能读取门诊费用 |

## 业务结论

1. 新 API 的存活、依赖 readiness 和版本化探针正常；这只证明运行层，不代表 Provider 或真机业务完成。
2. 患者资料、预约记录和门诊费用仍受统一会话认证保护，没有因为只读 adapter 已配置而放开匿名查询。
3. 探针未触发微信登录、患者目录同步、预约 Provider、门诊费用 Provider、支付、医保或 HIS 写回，因此不改变线上业务数据。
4. 当前 P1 仍然是使用来源为 `2bf9d8d9f67521067d761b48cc2bfec449ef1348` 的本地候选进行真机页面、客户端 requestId、服务端 Pino 和 Provider 低敏 requestId 四方关联验收；线上 `13f597e` 不能作为本地 Tab 修正的证据。

## 代码级关联检查

- 小程序测试：234/234，通过 1882 个断言；
- API 测试：211/211，通过 873 个断言；
- 架构、迁移、Provider、文档、日志和发布基线审计均通过；
- 以上自动化结果仍不能替代真机页面截图和业务请求同链证据。
