# `9833a01` 生产切换与运行时验收（2026-08-17）

## 结论

`9833a01` 已在 2026-08-17 15:02 CST 左右通过候选 preflight 和隔离 runtime smoke，随后原子切换为新 Elysia API 的生产 `current`，只重启
`hospital-platform-api-v2.service`。公网 `/api/v2` 运行时 smoke 通过，旧 Python 服务 `8001` 全程保持监听。

本次只证明发布运行层和认证边界正确，不代表微信登录、患者同步、预约历史、门诊费用、报告 Provider 或真机业务已完成验收。支付、医保、退款和 HIS 回写继续关闭。

## 1. 候选构建与依赖预检

| 项目 | 结果 |
| --- | --- |
| 候选 commit | `9833a01` |
| 切换前 current | `3ab0a6c` |
| 候选临时端口 | `127.0.0.1:18082`，smoke 后已停止 |
| 生产环境 | `production`，启动日志明确 `runtimeMode=production` |
| MySQL / Redis / schema | `ok` / `ok` / `schemaStatus=verified` |
| schema 目标 | `0016_patient_directory_sync_owner_index` |
| 微信身份 | `configured`，仍需真实 `wx.login` 业务验收 |
| 预约历史/门诊费用 | `configured`，仍需真实患者 Provider 请求验收 |
| 报告目录/详情 | `disabled`，本次未打开 |
| 微信支付 | `disabled`，本次未调起支付 |

候选 bundle 由本地 `pnpm build` 生成，通过 tar 上传；服务器解包后 5 个 bundle 的 SHA-256 与本地一致：

```text
apps/api/dist/index.js                         fe5d9203de9d8d009be331167ee355101647cc8eb6c5b0714359cbaac1a2e572
apps/worker/dist/index.js                     f3e85e0690f55e9899e7ddf921315708b005a7dff49ea52b47c2659c7b2cbdc4
apps/worker/dist/preflight.js                 f9e8e350db6806ec2212cd2818630755bd1b6787ed1ec7631686df740c7a40ff
apps/worker/dist/provider-directory-smoke.js  ba1d1c6883f0706e76f57d56e258b0f6a8140f36f12021d2a16ef25485d2330c
apps/worker/dist/api-runtime-smoke.js         a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46
```

真实生产 `shared/api.env` 只用于候选 preflight 和进程启动，未被读取、覆盖或传入 release 包。preflight 未执行 migration、Provider 写入、支付、医保或 HIS 操作。

## 2. 候选隔离 smoke

候选在 `127.0.0.1:18082` 启动并以 SIGTERM 正常回收，连续通过：

- `health-live`：200；
- `health-ready`：连续 3/3，database/redis/schema 均为 `ok`；
- `system-ping`：200；
- `auth-boundary`：401，错误码 `unauthorized`。

启动日志同时确认 `environment=production`、`runtimeMode=production`、`persistenceRepositories=enabled`，以及报告/支付 gate 没有被意外打开。

## 3. 原子切换与新旧服务共存

切换只执行 `current.next -> current` 原子替换，并重启新 API unit；没有停止、重启或修改旧 Python 服务，也没有执行数据库 migration。

| 项目 | 切换后结果 |
| --- | --- |
| 新 API current | `/home/ps/code/hospital-platform/releases/9833a01` |
| 新 API | `10.0.0.3:18081`，systemd `active` |
| 旧 Python API | `0.0.0.0:8001`，仍监听 |
| Worker | 未启动 |
| 内网 `/health/ready` | 200，database/redis/schema 均为 `ok` |
| 内网 `/health/live` | 200，`Cache-Control: no-store` |

## 4. 公网运行时 smoke

通过 `https://test-hp.meiyi.pro` 执行 `api-runtime-smoke.js`，使用公网前缀 `/api/v2`：

- `health-live`：200；
- `health-ready`：连续 6/6 通过，`Cache-Control: no-store` 保留；
- `system-ping`：200；
- `auth-boundary`：401，错误码 `unauthorized`。

本轮最终 trace 仅用于运行时关联，不代表 Provider 业务成功：

- live：`b3e42e14-3acd-4e64-a17e-3043db16b143`；
- ready：`7b5e1fbe-6ab9-4ced-8022-e70d5758afa8`，以及连续采样 trace 链；
- system ping：`7a3a680a-d677-4783-bf4c-6f81341abe6f`；
- 认证边界：`d6ab14c2-c153-48a1-a3d4-93496152a7b5`。

## 5. 权限与失败路径说明

本次第一次尝试使用 `sudo -n systemctl restart hospital-platform-api-v2.service` 时，服务器返回需要密码；软链接随后已由失败路径恢复到 `3ab0a6c`，只读核对确认旧 current、服务和端口均一致。

之后使用 SSH 提供的密码进行交互式 sudo 认证，只操作 `hospital-platform-api-v2.service`，完成 `9833a01` 切换。旧 Python unit 没有执行任何 sudo 命令。服务器管理员后续应重新核对 `/etc/sudoers.d/hospital-platform-api-v2` 的 NOPASSWD 生效状态，再恢复无人值守发布流程；在此之前不能假设 `sudo -n` 可用。

候选上传过程中首次使用 Windows zip 在 Linux 解包出现路径分隔符错误；该包没有进入 `current`，随后改用 POSIX tar 并完成 checksum 验证。临时候选端口已停止，未删除任何既有 release。

## 6. 业务验收边界

本次没有携带真实微信会话执行 `/me`、患者目录、预约历史、报告目录或门诊费用查询；也没有读取 Redis 会话 TTL、调用 Provider 写入、支付、医保授权、退款或 HIS 回写。因此当前状态仍为：

1. 运行时和公网认证边界已验收；
2. 微信登录、患者同步/切换需要在当前 `9833a01` 真机重新验收；
3. 预约历史、门诊费用和报告仍需逐域保存 traceId、Provider requestId、字段映射和真机结果；
4. 医疗病历、二维码、预约写入、支付、医保、退款和 HIS 回写不因本次切换而开放。

下一步继续使用受控微信账号执行：微信登录 → 患者目录/切换 → 我的挂号 → 门诊缴费待缴/已缴。若出现 Provider 字段错误、`persistence-temporarily-unavailable` 或患者上下文错配，立即停止该域验收并保持 gate，不降级为空列表。
