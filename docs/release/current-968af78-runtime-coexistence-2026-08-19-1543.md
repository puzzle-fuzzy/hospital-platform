# `968af78` 当前运行层与新旧服务共存复核（2026-08-19 15:43 CST）

本记录只保存一次 SSH 只读运行核对结果，用来确认新 API 的发布指针、systemd 状态、监听端口和公网依赖探针没有因为后续操作发生漂移。它不是 Provider、微信真机或业务成功证据。

## 1. 只读核对结果

| 检查项 | 结果 |
| --- | --- |
| 服务器 | `192.168.112.172`；仅执行 SSH 只读命令 |
| 当前新服务 release | `/home/ps/code/hospital-platform/releases/968af78` |
| `hospital-platform-api-v2.service` | `active`；`MainPID=703078`；`ExecMainStatus=0` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python API 监听 | `0.0.0.0:8001` |
| 公网 live | `https://test-hp.meiyi.pro/api/v2/health/live` 返回 `200`，状态 `ok` |
| 公网 ready | 返回 `200`；`database=ok`、`redis=ok`、`schema=ok` |

## 2. 安全边界

- 本次没有修改旧 Python 项目、旧服务进程、Nginx、数据库、Redis、环境文件或 systemd 配置。
- 本次没有执行 migration、写入业务数据、调用 Provider 业务接口或使用真实微信会话。
- 新旧端口同时监听，只能证明共存和运行层健康，不能证明微信登录、患者目录同步、`patInfosFind`、预约、报告或门诊费用业务成功。
- 线上当前仍是服务端 `968af78`；小程序候选 `48ba22f` 只是本地构建，尚未上传或替换线上小程序包。

## 3. 下一步

真实业务仍按 [`miniprogram-real-device-acceptance-checklist-2026-08-19.md`](miniprogram-real-device-acceptance-checklist-2026-08-19.md) 取证：必须在当前候选下取得手机连接、页面结果、HTTP trace 和低敏服务端日志三层证据。任何 Provider 字段、鉴权、空结果或状态不明确时继续保持 fail-closed，不通过运行层 200 推导业务完成。
