# 小程序候选 `474b044` 本地构建记录（2026-08-19）

> 历史候选记录：本文只保留 `474b044` 当时的构建与验收前置事实，不能作为当前真机运行包。当前候选请阅读
> [`candidate-e050fa0-local-build-2026-08-20.md`](candidate-e050fa0-local-build-2026-08-20.md)。

## 1. 当前版本事实

| 项目 | 值 |
| --- | --- |
| 服务端 release | `398be8e` |
| 小程序客户端 | `474b044` |
| 小程序构建来源 | `474b0444736599c848a4cef9f47fd930884e401d` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 生成页面脚本数量 | 14 |
| 小程序回归 | `163 pass / 0 fail / 1302 expects` |
| 是否上传线上小程序 | 否 |
| 是否完成真机验收 | 否 |

`apps/miniprogram/dist/build-info.json` 已记录上述完整来源指纹。之前的 `48ba22f`、`4822884`、
`b451cc6` 及更早候选只作为历史记录，不能与本候选混用。

## 2. 本候选包含的变更

本候选删除了患者范围页面入口的 boolean/本地 token 默认兼容分支：预约记录、爽约记录、报告目录和门诊费用页面
在患者目录读取前先验证 `/me`，并显式维护 `checking`、`valid`、`invalid`、`unavailable` 四态会话状态。
“更换就诊人”只能消费最近一次服务端会话验证结果，不能因为设备仍保存 token 就提前放行。

本候选继续保持报告 Provider、病历、二维码、预约写入、费用支付、医保结算、HIS 回写和退款关闭，
也没有修改旧 Python 项目、旧服务、数据库或 Redis。

## 3. 本地验证

- `pnpm check`：通过，架构、迁移/provider/docs/release、格式、lint、工具测试、类型检查、单元测试和构建全部通过；
- 小程序专项测试：`163 pass / 0 fail / 1302 expects`；
- 小程序构建：通过，生成 14 个页面脚本，`build-info.json.sourceRevision` 与完整 Git 提交一致；
- 用户已有的 `apps/miniprogram/project.config.json` 修改保持未暂存、未提交；它属于本地开发者工具配置，不纳入运行输入来源指纹；
- 真机前仍需人工确认 `appid`、`miniprogramRoot=dist/`、公网域名和设备连接状态。

## 4. 真机前置条件

1. 在微信开发者工具中重新编译当前 `dist/`，确认来源指纹等于本记录的完整 SHA-1；
2. 只在新的 `miniprogram` 项目窗口生成二维码；旧 `mp-weixin` 窗口、旧二维码和模拟器画面不计入验收；
3. 按 [`miniprogram-real-device-acceptance-checklist-2026-08-19.md`](miniprogram-real-device-acceptance-checklist-2026-08-19.md)
   采集页面、HTTP trace 和低敏服务端日志三层证据；
4. 如果 Provider 返回空列表、未配置、权限拒绝或暂时失败，必须保留对应错误语义，不能用空页面冒充业务成功。
