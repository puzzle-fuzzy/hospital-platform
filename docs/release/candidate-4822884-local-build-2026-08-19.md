# 小程序候选 `4822884` 本地构建记录（2026-08-19）

## 1. 当前版本事实

| 项目 | 值 |
| --- | --- |
| 小程序源码提交 | `4822884` |
| 完整来源指纹 | `482288496c6de90ff86fb2f2eb54db3b9ae0bae5` |
| 服务端配套 release | `65219e2` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 生成页面脚本数量 | 14 |
| 是否上传线上小程序 | 否 |
| 是否完成真机验收 | 否 |

`apps/miniprogram/dist/build-info.json` 已记录上述完整来源指纹。它是当前本地候选的唯一来源证明；旧的
`b451cc6` 及更早候选仍只作为历史记录，不能与本候选混用。

## 2. 本候选包含的变更

本候选包含门诊费用列表日期展示边界修正：服务端和公共读模型继续保留完整 `billDate`，原生小程序仅在渲染边界
生成 `billDateLabel`，恢复旧端只展示 `YYYY-MM-DD` 的视觉行为。该投影不参与查询窗口、记录引用、支付、医保或结算判断。

本候选没有打开报告 Provider、病历、二维码、预约写入、费用支付、医保结算、HIS 回写或退款，也没有修改旧 Python
项目、旧服务、数据库或 Redis。

## 3. 本地验证

- `pnpm check`：通过，9/9 workspace package 完成架构、迁移/provider/docs/release、格式、lint、工具测试、类型检查、
  单元测试和构建。
- 小程序构建：通过，生成 14 个页面脚本，`build-info.json.sourceRevision` 与完整 Git 提交一致。
- 用户已有的 `apps/miniprogram/project.config.json` 修改保持未暂存、未提交；它属于本地开发者工具配置，不纳入运行输入
  来源指纹。真机前仍需人工确认该配置的 `appid`、`miniprogramRoot=dist/` 和网络设置。

## 4. 真机前置条件

1. 在微信开发者工具中重新编译当前 `dist/`，确认来源指纹等于本记录的完整 SHA-1。
2. 只在新的 `miniprogram` 项目窗口生成二维码；旧 `mp-weixin` 窗口、旧二维码和模拟器画面不计入验收。
3. 按 [`miniprogram-real-device-acceptance-checklist-2026-08-19.md`](miniprogram-real-device-acceptance-checklist-2026-08-19.md)
   采集页面、HTTP trace 和低敏服务端日志三层证据。
4. 如果 Provider 返回空列表、未配置、权限拒绝或暂时失败，必须保留对应错误语义，不能用空页面冒充业务成功。
