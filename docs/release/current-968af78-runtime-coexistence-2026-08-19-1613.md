# `968af78` 16:13 运行层与双服务共存只读复核

本记录只保存当前服务器的运行层事实，不把健康检查、端口监听或公网可达性解释成微信、Provider、患者、预约、报告或费用业务成功。

## 1. 复核结果

| 检查项 | 结果 |
| --- | --- |
| 服务器 | `192.168.112.172` |
| 复核时间 | `2026-08-19 16:13:17 CST` |
| 当前新服务 release | `/home/ps/code/hospital-platform/releases/968af78` |
| 新 API systemd 服务 | `hospital-platform-api-v2.service=active` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python API 监听 | `0.0.0.0:8001` |
| 内网 live | `http://10.0.0.3:18081/health/live` 返回 `200`，状态 `ok` |
| 内网 ready | 返回 `200`，`database=ok`、`redis=ok`、`schema=ok` |
| 公网 live | `https://test-hp.meiyi.pro/api/v2/health/live` 返回 `200`，状态 `ok` |
| 公网 ready | 返回 `200`，`database=ok`、`redis=ok`、`schema=ok` |

## 2. 安全范围

- 本次只执行 SSH 只读命令和健康检查请求。
- 没有重启服务，没有修改旧 Python、Nginx、systemd、环境文件、数据库或 Redis。
- 没有调用 Provider 业务接口，没有使用真实微信会话，也没有写入患者、预约、报告或费用数据。
- 健康检查只证明运行层和新旧端口共存仍正常；不增加任何业务域的真实验收等级。
- 当前小程序真机验收仍必须使用与服务端证据配套的候选包，并同时保存页面、HTTP trace 和低敏日志。

## 3. 下一步

继续使用当前小程序候选按以下顺序取得业务证据：

1. 微信登录、`/me`、患者目录读取和完整同步；
2. 显式更换就诊人，确认 owner、平台 opaque `patientId` 和 `his-patient` 映射一致；
3. “我的挂号”和爽约记录只读查询；
4. 门诊费用待缴/已缴只读查询；
5. 以上链路稳定后，再评估 LIS/PACS/ECG 报告目录。

预约写入、锁号、取消、支付、医保、二维码和 HIS 回写继续保持关闭。
