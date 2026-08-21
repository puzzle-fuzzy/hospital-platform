# 候选 `4f2d890` 患者卡号边界本地构建记录（2026-08-22）

> 这是服务端 adapter 的未部署候选，不是线上 release。线上服务端仍为
> `7181e99e3a352244102f5591279528b3b66332c9`；候选发布前不得把本记录当作线上、Provider 或真机业务验收证据。

## 候选来源与变更

| 项目 | 结果 |
| --- | --- |
| 服务端候选 | `4f2d890d8e7190858d7b2e17abc51cd0df12763d` |
| 线上服务端 | `7181e99e3a352244102f5591279528b3b66332c9`，未因本轮本地提交改变 |
| 小程序运行包来源 | `b0e093565493285de07fe549879f8b87eda649cc7` |
| 小程序页面入口 | 14 个，全部生成 `.js/.json/.wxml/.wxss` |
| 测试运行脚本 | 0 个 `*.test.js` / `*.spec.js` |

本轮只修正众阳患者 adapter 的卡号边界：平台资源上限固定为 64 个字符，超长卡号在
目录字段映射阶段直接返回 `provider-response-invalid`，不再由脱敏函数把异常卡号伪装为
`未绑定`，也不会继续调用 `patInfosFind`。该边界不是对医院卡号业务长度的猜测；超过边界的
Provider 响应必须重新取得合法数据后再同步。正常 15/18 位卡号仍保留前五位和后四位。

## 验证结果

- 众阳 adapter：`108 pass / 0 fail`；
- API typecheck：通过；API 测试 `205 pass / 1 fail`，唯一失败是线上基线一致性门禁，
  因 `4f2d890` 尚未部署而按设计阻断，不是本次业务测试失败；
- 小程序：`205 pass / 0 fail`，typecheck、build 和 `runtime:verify` 通过；
- 小程序 `dist/build-info.json` 来源仍为 `b0e0935`，这是正确结果：本轮没有修改小程序运行
  输入，不能人为改成服务端 commit；
- 本轮没有调用众阳、没有写 MySQL/Redis、没有修改或重启旧 Python 服务。

## 发布停止条件

当前候选仍需先按 [`api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md)
完成本地 bundle、真实生产 env preflight 和临时端口 smoke，再只切换
`hospital-platform-api-v2.service`。当前 SSH 对阿里云 `8.130.127.184` 仍返回
`Permission denied (publickey)`，因此本轮没有上传或切换；旧 Python `8001` 必须继续保持不变。

发布完成后，服务端基线和小程序运行包来源必须重新成对记录，再进行真实微信登录、患者切换、
预约历史和门诊费用三层验收。支付、医保、二维码、患者绑定和 HIS 回写仍保持关闭。
