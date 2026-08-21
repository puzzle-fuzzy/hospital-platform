# 公网新 API 运行层只读复核（2026-08-21 11:12 CST）

> 本记录只证明公网 `/api/v2` 的运行和鉴权边界，不证明微信、患者、预约、门诊费用、Provider 或真机业务已经完成。请求未携带 Bearer，会话外部依赖未被调用，也没有写入 MySQL/Redis。

## 复核结果

| 请求 | 结果 | 语义 |
| --- | --- | --- |
| `GET /api/v2/health/live` | `200`，`Cache-Control: no-store` | 进程存活探针正常 |
| `GET /api/v2/health/ready` | `200`，`Cache-Control: no-store` | 当前服务依赖 readiness 正常 |
| `GET /api/v2/me` | `401` | 未携带会话时鉴权边界正常 |
| `GET /api/v2/patients` | `401` | 未携带会话时患者目录不会泄露 |
| `GET /api/v2/appointments/records` | `401` | 未携带会话时预约历史不会泄露 |
| `GET /api/v2/payments/outpatient/records?patientId=probe&status=unpaid` | `401` | 门诊费用公共路由存在，但未携带会话时不会进入患者/Provider 查询 |
| `GET /api/v2/medical-records` | `404` | 门诊病历保持未注册 |
| `GET /api/v2/payments/insurance/authorization` | `404` | 医保授权保持未注册 |

## 当前候选与下一步

本次运行层复核对应服务端 release `5a31427`；小程序当前本地候选为 `c86a788`，完整运行包来源为
`c86a788c01760fd5a74ac8c2769871025297a4fc`，尚未上传线上。上述结果不替代真机三层证据；下一步仍是用该候选重新普通编译、生成二维码，依次取得微信登录、患者目录/显式切换、预约历史、爽约和门诊费用的页面、客户端请求与服务端低敏日志。

本次没有修改旧 Python 服务、服务端 release、线上配置、数据库或 Redis。
