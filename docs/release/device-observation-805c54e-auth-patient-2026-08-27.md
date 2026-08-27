# 真机首批微信登录与患者目录观察（2026-08-27）

> 本文只记录当前候选在真机调试窗口中已经观察到的低敏链路，不把局部成功扩大为整个业务域完成。
> 记录中的 requestId/traceId 仅用于服务端关联；不保存 token、openid、患者姓名、身份证号、卡号或响应正文。

## 运行包与设备

- 小程序运行包来源：`805c54ea9fa943385ad6feebed1401d521fbad3c`（`805c54e`）；
- 开发者工具打开目录：`apps/miniprogram/dist/`；
- 设备：iPhone 17 Pro，iOS 26.5.2，微信 8.0.75，基础库 3.17.2 `[1632]`；
- 连接方式：4G；真机调试窗口显示连接状态和服务状态正常。

## 已观察的客户端与服务端同链事件

| 客户端 requestId | 客户端请求 | 服务端请求 | 结果 | 业务观察 |
| --- | --- | --- | --- | --- |
| `mp-mtbdipen-i7jb0sx7` | `GET /patients` | `GET /api/v1/patients` | HTTP `401` | 登录前访问被正确拒绝，不计为业务失败 |
| `mp-mtbdiprv-y4yi1of4` | `POST /auth/wechat` | `POST /api/v1/auth/wechat` | HTTP `200` | 微信身份交换成功，服务端记录 `auth.wechat.login.requested` 与 `auth.wechat.login.succeeded` |
| `mp-mtbdiqfe-h1uf55c4` | `GET /patients` | `GET /api/v1/patients` | HTTP `200` | 服务端读模型加载 `1` 条记录 |
| `mp-mtbdjhtu-av2kxgrz` | `GET /patients` | `GET /api/v1/patients` | HTTP `200` | 服务端读模型再次加载 `1` 条记录 |

服务端低敏日志中，微信登录链路的 `requestId`、`traceId` 和客户端记录一致；
患者目录读取分别记录了 `patient.directory.read.requested`、`patient.directory.read.loaded`
和 HTTP 完成事件。日志没有在本文或验收记录中复制凭证和患者正文。

## 后续患者目录读取观察

真机保持连接期间又观察到以下 3 次患者目录读取；客户端和服务端的请求号仍能一一对应，
每次服务端读模型均加载 `1` 条记录：

| 客户端 requestId | 客户端请求 | 服务端结果 |
| --- | --- | --- |
| `mp-mtbdli9f-9qieg592` | `GET /patients` | `/api/v1/patients` HTTP `200` |
| `mp-mtbdm75z-j3n54hv4` | `GET /patients` | `/api/v1/patients` HTTP `200` |
| `mp-mtbdmp7j-s61u99vu` | `GET /patients` | `/api/v1/patients` HTTP `200` |

当前真机 WXML 根页面仍为首页，尚未观察到进入“选择就诊人”页面或显式切换其他患者；
这些重复读取不计作患者切换成功。

## `SdkReport` 处理结论

本次真机 Network 面板还观察到多条 `SdkReport` 请求。它们是微信基础库的诊断/统计流量，
不属于医院 API 业务请求，也不能证明登录、患者、预约或费用成功；业务日志和验收统计继续忽略它们。

## 当前边界

本次只证明：当前运行包可以在真机建立调试连接，微信登录成功后能够读取患者目录，
以及未登录患者读取会被服务端拒绝。以下证据仍缺失，因此九域清单保持 `pending`：

- 真机页面截图/页面状态证据；
- 患者目录空结果、暂时失败和账号切换清理；
- 显式切换其他就诊人及过期选择恢复；
- 预约历史/爽约、门诊费用和普通资料的真实链路；
- 患者同步、Provider 请求号及其对应的业务场景。

支付、医保、预约写入、取消和 HIS 回写未触发。
