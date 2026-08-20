# 小程序候选 `0dccf54` 本地构建记录（2026-08-20）

## 1. 当前候选事实

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0e360d3` |
| 小程序客户端 | `0dccf54` |
| 小程序构建来源 | `0dccf545ef65a905b58a27f38e787daea250fa54` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 注册页面/生成页面脚本 | 14 |
| 是否上传线上小程序 | 否 |
| 是否完成真机验收 | 否 |

`apps/miniprogram/dist/build-info.json.sourceRevision` 必须等于上表完整 40 位来源。
上一份 [`candidate-501e3a7-local-build-2026-08-20.md`](candidate-501e3a7-local-build-2026-08-20.md)
仍保留为历史候选追溯，不能用于本次扫码验收。

## 2. 本候选变化

本候选继续修复微信开发者工具监听 `dist/` 时的运行包发布竞态：构建先在 staging 目录完成
TypeScript 编译、静态资源复制、来源指纹和页面门禁，再替换完整的 live `dist/`；替换
失败时恢复旧运行包，不再在编译开始时删除整个 `dist/`。这解决了
`pages/report-directory/report-directory.js` 在构建窗口内暂时不存在而导致的 404。

本次进一步把 staging 和备份目录移到 `apps/miniprogram/` 项目根目录之外，避免微信开发者工具
把构建临时文件当成小程序源码重新编译。目录替换仍在同一文件系统内进行，以保留快速切换和失败
回滚能力；这只能把 live 运行包的可见切换窗口收窄到目录替换操作本身，不能宣称操作系统目录替换
绝对不可被观察。

发布器、测试和现场证据见 [`miniprogram-runtime-publish-atomicity-2026-08-20.md`](miniprogram-runtime-publish-atomicity-2026-08-20.md)。
本次不改变微信授权、患者、预约、门诊费用、报告 Provider、支付、医保或 HIS 业务语义。

## 3. 本地验证

- 小程序定向测试：165 项通过、0 项失败、1321 个断言；
- TypeScript 类型检查：通过；
- 小程序构建：通过，生成 14 个页面 JavaScript 文件；
- `runtime:verify`：通过；
- `apps/miniprogram/dist/pages/report-directory/report-directory.js`：存在；
- `apps/miniprogram/dist/build-info.json.sourceRevision`：等于
  `0dccf545ef65a905b58a27f38e787daea250fa54`；
- 最新微信开发者工具日志：旧 staging/backup 事件停留在 `15:04:21` 的历史构建，最新
  `15:09:13` 仅出现 `change dist`，未出现新的项目根内临时目录事件；
- 构建结束后 `apps/miniprogram/` 和其父目录 `apps/` 下没有残留本次发布临时目录。

这些是本地代码、运行包和开发者工具监听边界证据，不代表微信开发者工具已重新编译、手机已连接
或线上业务已验收。真机验收必须先核对完整 `sourceRevision`，再按当前真机清单取得页面、HTTP
和低敏服务端日志三层证据。
