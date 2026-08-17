# 当前生产服务 P0 只读观察（2026-08-17 22:57 CST）

本文记录 2026-08-17 22:57 CST 通过 SSH 对 `192.168.112.172` 的只读核验结果，
用于区分“服务运行正常”“服务产生过业务事件”和“真机业务验收完成”这三个不同结论。
本次没有修改服务器文件、没有写入环境变量、没有切换 release、没有重启服务。

## 1. 发布与共存边界

| 项目 | 只读观察结果 |
| --- | --- |
| 新服务托管 | `hospital-platform-api-v2.service`，Bun + Elysia，运行用户 `ps` |
| 新服务启动时间 | 2026-08-17 20:30:25 CST |
| 当前目录 | `current -> releases/bf67b9673708a6e5188880eba9a6d29b8e78f0c5` |
| 新服务进程 | `/home/ps/.bun/bin/bun .../current/apps/api/dist/index.js` |
| 新服务监听 | `10.0.0.3:18081` |
| 旧 Python 服务 | `/home/ps/code/Hospital-Backend`，Gunicorn/Uvicorn，4 个 worker |
| 旧服务监听 | `0.0.0.0:8001` |
| MySQL / Redis | MySQL 服务运行并监听 3306；Redis 服务运行并监听本机 6379 |

部署目录是发布 bundle，不是带 `.git` 的工作树；因此本文只记录服务器上的 release 目录名，
不把目录名误称为当前可验证的 Git commit。新旧服务分别监听 18081 和 8001，旧服务仍在运行，
证明本次观察没有破坏共存拓扑。

## 2. 新服务启动配置与依赖探针

当前启动日志记录：

- `runtimeMode=production`；
- MySQL、Redis、schema 探针均为 `ok`，persistence repositories 为 `enabled`；
- 认证运行状态为 `ready`，微信身份配置为 `configured`；
- 预约目录、预约记录、门诊缴费查询配置为 `configured`；
- 微信支付配置为 `disabled`；报告目录和报告详情为 `disabled`。

这些字段只说明配置门禁和启动依赖状态，不等于 provider 业务已经成功，也不等于支付、医保或报告
已经开放。微信支付保持关闭符合当前迁移顺序。

## 3. 当前 release 的低敏日志计数

计数窗口从当前服务启动边界 `2026-08-17 20:30:25 CST` 开始，日志只做事件名、状态码和稳定错误码
聚合，不输出 Token、openid、unionid、患者姓名、证件号、卡号、provider 患者标识或请求正文。

| 事件 | 次数 |
| --- | ---: |
| `auth.wechat.login.requested` | 2 |
| `auth.wechat.login.succeeded` | 2 |
| `patient.directory.requested` | 31 |
| `patient.directory.synced` | 31 |
| `patient.directory.read.requested` | 62 |
| `patient.directory.read.loaded` | 62 |
| `appointment.*` | 0 |
| `outpatient.payment.*` | 0 |
| `report.*` | 0 |
| `http.request.completed` | 169 |
| `http.request.failed` | 26 |

当前窗口 HTTP 状态码只有 `200=169` 和 `401=26`；失败稳定错误码为 `unauthorized=26`。
这证明真实微信登录事件和患者目录读取链已经由当前进程记录，但当前 release 启动后还没有新的
预约历史或门诊费用业务事件，不能把“我的挂号”或门诊缴费标记为线上业务验收完成。

## 4. 公网边界复核

2026-08-17 22:58 CST 对 `https://test-hp.meiyi.pro/api/v2` 发起只读请求：

| 路径 | 结果 |
| --- | --- |
| `/health/live` | `200` |
| `/health/ready` | `200` |
| `/system/ping` | `200` |
| `/appointments/records`（无会话） | `401 unauthorized` |
| `/payments/outpatient/records?status=unpaid`（无会话） | `401 unauthorized` |

公网健康探针和系统探针可达，预约历史与门诊费用的认证边界生效。无有效会话的请求不能证明患者
归属、provider 只读查询或页面渲染成功；本次也没有从服务器提取任何会话凭据来冒充真机操作。

## 5. “我的 / 我的挂号”视觉对照结论

对照旧端以下事实来源：

- `G:\fuck\hospital\hospital-app\src\pages\user\user.vue`；
- `G:\fuck\hospital\hospital-app\src\jsonData\userNavData.json`；
- `G:\fuck\hospital\hospital-app\src\pagesB\user\my_registration.vue`；
- `G:\fuck\hospital\hospital-app\src\components\health\patient-hospital-selector.vue`。

当前原生实现已经保留：

1. “我的”页旧背景、头像尺寸和家庭成员管理卡片；
2. 三个同名“我的订单”分组、原始功能顺序、四列网格、20rpx 行列间距、50rpx 图标和 26rpx 文案；
3. 9 个旧端菜单图标、底部四 Tab 图标和激活态；
4. 固定底部导航、安全区预留以及页面内容底部留白；
5. “我的挂号”全宽患者/院区两行选择区、在线/全部双标签、`#f5f5f5` 列表背景、白色 16rpx
   圆角卡片、预约状态图标、预问诊/院内导航按钮和静态科室位置弹窗。

当前有意保留的非视觉差异：

- 患者选择进入独立原生选择页；展示服务端脱敏卡号，不展示 provider 患者 ID；
- 在线/全部只过滤当前安全读模型，不重新发送旧端 `requestChannel=3/4`；
- 挂号详情、预问诊、支付、医保和动态院区在没有独立契约前只显示迁移/未开放状态。

这些差异是身份、隐私和业务正确性边界，不是页面设计缺失。仍需在微信开发者工具和真机上完成
背景比例、底部固定、患者切换后重新加载以及长列表首帧的视觉验收。

## 6. 下一步

1. 使用当前运行包和有效微信会话，逐页取得“我的”与“我的挂号”的页面截图、请求、traceId 和
   低敏日志三层证据；
2. 先完成预约历史只读业务的 provider 归属、记录字段和空结果验收；
3. 再完成门诊缴费只读查询的患者映射、状态和金额展示验收；
4. 微信支付、医保授权、预约写入、取消/退款和 HIS 回写继续放在最后，未取得状态机和回调契约前
   不因页面按钮存在而开放。
