# 小程序当前候选 `e050fa0` 本地构建记录（2026-08-20）

## 1. 当前版本事实

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0e360d3` |
| 小程序客户端 | `e050fa0` |
| 小程序构建来源 | `e050fa026f2cb5b2de4af4de98024cfdb946229c` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 注册页面/生成页面脚本 | 14 |
| 是否上传线上小程序 | 否 |
| 是否完成真机验收 | 否 |

`dist/build-info.json.sourceRevision` 必须与上表完整 40 位来源一致。服务端 `0e360d3` 已完成生产切换；本记录只表示小程序运行包仍未上传。
文档提交本身不改变
小程序运行输入，因此本候选来源仍锁定最近一次影响运行包的代码提交 `e050fa0`；开发者工具的
`project.config.json` 和 `.codegraph/` 本地状态不属于候选运行输入，不能被暂存或提交。

## 2. 本候选包含的业务边界

本候选包含患者范围页面在会话失效、患者切换、目录同步过期和异常文案上的边界修正，继续支持
微信登录、患者目录、显式就诊人选择、预约/爽约/门诊费用只读页面和普通资料页面的代码级流程。

报告 Provider、病历、二维码、预约写入、费用支付、医保结算、HIS 回写、退款和患者新增/绑卡
仍然保持关闭或迁移提示；没有因为页面或接口已经存在就把未确认的 Provider 响应当成成功业务。

## 3. 本地验证证据

本候选生成前后必须执行以下门禁，输出应以当前工作树实际结果为准：

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @hospital/miniprogram runtime:verify
```

其中：

- `pnpm build` 必须通过 Turbo 的全部工作区构建，并生成 14 个页面的 JavaScript 运行文件；
- `runtime:verify` 必须校验 `sourceRevision`、页面脚本和根文件，不能只检查 TypeScript 源码；
- 运行输入必须在构建时干净；仅允许文档和本地开发者工具配置保持未提交；
- 静态检查、单元测试和运行包校验不能替代微信真机、众阳 Provider、支付或医保验收。

## 4. 真机验收前置条件

1. 在微信开发者工具中重新编译 `apps/miniprogram/dist/`，确认来源指纹等于本记录的完整 SHA-1；
2. 只使用新的 `miniprogram` 项目窗口生成二维码，旧 `mp-weixin` 窗口和旧二维码不计入验收；
3. 按 [`miniprogram-real-device-acceptance-checklist-2026-08-19.md`](miniprogram-real-device-acceptance-checklist-2026-08-19.md)
   采集页面、HTTP trace 和低敏服务端日志三层证据；
4. 如果 Provider 返回未配置、拒绝、超时或非法包络，必须保留对应错误语义并停止该业务域，不能
   用空列表或兼容数据冒充成功；
5. 旧 Python `8001`、旧域名、旧数据库和旧 Redis 命名空间不因本候选验收而停止或切换。
