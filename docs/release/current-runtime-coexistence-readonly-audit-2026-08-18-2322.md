# 2026-08-18 23:22 CST 重启后运行共存只读复核

本文件记录 2026-08-18 23:22 CST 通过 SSH 对 `ps@192.168.112.172` 的只读核对。它只证明当前运行层和新旧服务共存，不证明微信真机、患者切换、预约、报告、门诊费用、支付、医保或 HIS 业务完成。

## 1. 只读结果

| 项目 | 结果 |
| --- | --- |
| 服务器 current | `/home/ps/code/hospital-platform/current -> /home/ps/code/hospital-platform/releases/c26e696` |
| 新 API | `hospital-platform-api-v2.service=active`，Bun 主进程 PID `826690` |
| 新 API 启动时间 | `2026-08-18 22:56:49 CST` |
| Worker | `hospital-platform-worker-v2.service=inactive` |
| 新 API 监听 | `10.0.0.3:18081`，进程为 Bun |
| 旧 Python 监听 | `0.0.0.0:8001`，进程为 Gunicorn；本次未停止、未重启、未修改 |
| 内网 live | `GET http://10.0.0.3:18081/health/live` 返回 `200` |
| 内网 ready | `GET http://10.0.0.3:18081/health/ready` 返回 `200`，`database/redis/schema=ok` |
| 公网 live | `GET https://test-hp.meiyi.pro/api/v2/health/live` 返回 `200` |
| 公网 ready | `GET https://test-hp.meiyi.pro/api/v2/health/ready` 返回 `200`，`database/redis/schema=ok` |

## 2. 结论和边界

- 本次只读取 release 指针、systemd 状态、监听端口和健康接口，没有执行 migration、MySQL/Redis 业务写入或服务重启。
- 新 API 的恢复没有影响旧 Python 服务；旧端口仍保持监听，不能用新 API 的 readiness 推断旧端业务已迁移。
- 当前本地小程序验收候选为 `a45d35e`，完整来源为
  `a45d35edd91aab1a3a83c77301c9984402686145`；它尚未因本次只读复核上传或替换线上小程序包。
- 本次没有携带微信会话，也没有取得患者目录、显式切换、预约历史、爽约、报告或门诊费用的请求/页面/低敏成功事件，因此 P0 真机业务验收仍待按手册执行。
- 服务器登录提示系统尚有待重启的操作系统更新；这不是本次应用重启或新旧服务故障证据，后续如需处理必须另行安排维护窗口。

## 3. 下一步

1. 使用来源为 `a45d35edd91aab1a3a83c77301c9984402686145` 的本地运行包完成真实微信会话验收。
2. 依次采集患者同步/显式切换、我的挂号、爽约、门诊费用的页面、HTTP trace 和低敏日志三层证据。
3. 在上述只读业务稳定前，继续保持全部挂号、预约写入、支付、医保、退款、HIS 回写和报告详情 gate 关闭。

