# 当前服务端真实业务事件窗口（2026-08-21）

> 本记录来自服务器 `192.168.112.172` 上新 API 的只读 journald 聚合。它证明服务端曾经收到真实微信登录和患者同步请求，但不能证明这些请求来自当前小程序候选 `acf5a85`，因此不计入当前候选真机验收。

## 1. 证据边界

| 项目 | 结果 |
| --- | --- |
| 服务端观察对象 | `hospital-platform-api-v2.service` |
| 服务启动模式 | `production` |
| 当前小程序候选 | `acf5a85` |
| 当前运行包来源 | `acf5a8596e70e1fb2b8d220a0b41eb69418ae086` |
| 当前运行包构建时间 | `2026-08-21T00:36:58.572Z`（08:36:58 CST） |
| 事件窗口 | 最近 60 分钟，只读聚合事件名称与数量 |
| 事件时间 | 约 08:16 CST |
| 当前候选是否验收通过 | 否；事件早于当前运行包构建时间，客户端来源无法匹配 |

## 2. 低敏事件计数

| 事件 | 数量 |
| --- | ---: |
| `auth.wechat.login.requested` | 1 |
| `auth.wechat.login.succeeded` | 1 |
| `patient.directory.read.requested` | 2 |
| `patient.directory.read.loaded` | 2 |
| `patient.directory.requested` | 1 |
| `patient.directory.operation.started` | 1 |
| `patient.directory.snapshot.committed` | 1 |
| `patient.directory.synced` | 1 |
| `http.request.completed` | 11 |
| `http.request.failed` | 10 |

这说明真实服务端链路曾完成“微信登录 → `/me`/患者目录读取 → 患者同步提交”。本记录不保存 token、微信 code、用户 ID、患者 ID、provider 请求号、姓名、卡号或原始日志报文。

## 3. 为什么不能作为当前候选证据

当前 `acf5a85` 运行包构建时间为 08:36 CST，而本窗口中的业务事件约在 08:16 CST 已发生。即使事件本身真实，也无法从服务端事件名称反推出手机使用的是哪个小程序运行包；因此不能把它回填为 `acf5a85` 的页面、客户端 HTTP 和服务端三层证据。

在当前二维码重新打开后，最近 20 分钟没有新的微信、患者、预约历史、门诊费用或普通资料事件。下一次扫码必须重新建立窄时间窗口，并同时记录：

1. 真机页面结果；
2. 脱敏客户端路径、状态码和 `requestId/traceId`；
3. 同一时间窗口的服务端低敏业务事件。

如果三层来源、患者上下文或候选版本不能相互匹配，继续保持“待验收”，不把真实但来源不明的服务端事件升级为当前候选成功。

## 4. 影响范围

本次只读 SSH 检查没有部署、重启、写入配置、调用 Provider 或修改 MySQL/Redis；旧 Python 服务和 `8001` 端口未触碰。支付、医保、预约写入、退款、患者绑定、报告 Provider 和 HIS 回写继续保持关闭。
