# 新 API 最小 systemd 权限验收（2026-08-16）

本文只记录发布权限准备和新旧服务共存复核，不代表已经切换生产，不代表 provider、微信登录、真机或支付验收完成。

## 1. 变更范围

| 项目 | 结果 |
| --- | --- |
| 目标服务器 | `ps@192.168.112.172` |
| 新 API unit | `hospital-platform-api-v2.service` |
| 授权文件 | `/etc/sudoers.d/hospital-platform-api-v2` |
| 仓库规则 | [`infra/systemd/hospital-platform-api-v2.sudoers`](../../infra/systemd/hospital-platform-api-v2.sudoers) |
| 允许的免密命令 | 新 API 的 `restart`、`is-active`、`status` |
| 明确未授权 | 旧 Python unit、`hospital-platform-worker-v2.service`、任意 `systemctl *` |
| 旧服务 | `0.0.0.0:8001`，未修改、未重启 |
| 新服务 | `10.0.0.3:18081`，未修改、未重启 |
| 当前 release | `/home/ps/code/hospital-platform/releases/55fce6c` |

## 2. 权限安装证据

1. 规则文件通过 SSH 上传到临时目录，再由已有 sudo 权限安装为 root 所有、`0440` 权限。
2. `visudo -cf /etc/sudoers.d/hospital-platform-api-v2` 返回“解析正确”。
3. `sudo -n systemctl is-active hospital-platform-api-v2.service` 无密码返回 `active`。
4. `sudo -n systemctl is-active hospital-platform-worker-v2.service` 被拒绝并要求密码，证明 worker 没有进入免密授权。
5. 上传临时文件已删除；没有传输或记录任何 env、AppSecret、数据库密码或 Redis 凭证。

账号原有的输入密码后全权限 sudo 未在本次改动中收紧；本次只增加发布自动化所需的窄 NOPASSWD 规则。
如果未来要取消全权限 sudo，必须由服务器管理员单独设计应急恢复和 break-glass 方案。

## 3. 安装后共存复核

安装后只读复核确认：

- `current` 仍指向 `55fce6c`；
- `hospital-platform-api-v2.service` 仍为 `active`，主 PID 仍为 `2935571`，启动时间仍为 `2026-08-16 13:14:05 CST`；
- 旧 Python 进程仍为 PID `636918`，仍监听 `0.0.0.0:8001`；
- 新 API 仍监听 `10.0.0.3:18081`；
- Worker 仍为 `inactive`，没有因为本次权限配置被启动；
- 没有执行 `systemctl restart`、release 切换、Nginx reload、migration 或旧服务操作。

## 4. readiness 观察

安装后的第一次单次 readiness 读取曾返回 `database=unavailable`、`schema=unavailable`、`redis=ok`；
随后紧接着连续五次读取均返回 `status=ready` 且三项依赖均为 `ok`。这属于依赖探针瞬时恢复，不能
作为切换候选的唯一证据；发布 smoke 仍必须要求连续 ready、响应 `Cache-Control: no-store`，并关联
服务端 requestId/journald。

本次观察没有重启服务。由于线上当前 release 仍为 `55fce6c`，候选切换和公网 `/api/v2` no-store
验收继续保持为下一步发布任务。
