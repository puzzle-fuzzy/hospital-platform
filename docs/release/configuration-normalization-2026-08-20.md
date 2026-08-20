# 运行配置标准化复核（2026-08-20）

## 本次结论

本次复核发现并修正了微信上游地址的一个边界问题：当部署环境把
`WECHAT_IDENTITY_BASE_URL` 或 `WECHAT_PAY_BASE_URL` 设置为空字符串、全是空格时，
旧解析逻辑会把空值直接传入 adapter。由于配置闸门只在非空时校验 HTTPS，可能出现
“状态为 `configured`，实际请求地址却为空”的不一致。

现在的规则是：

| 环境变量 | 空字符串/空白值 | 非空值 |
| --- | --- | --- |
| `WECHAT_IDENTITY_BASE_URL` | 使用 `https://api.weixin.qq.com` | 继续由配置闸门校验 HTTPS |
| `WECHAT_PAY_BASE_URL` | 使用 `https://api.mch.weixin.qq.com` | 继续由配置闸门校验 HTTPS |

自定义地址仍然必须经过 provider 合同、网络可达性和人工验收；回退官方地址只解决
配置解析的一致性，不代表微信身份或支付能力已经打开。

## 小程序 ENOENT 边界

`apps/miniprogram/dist/services/single-flight.js` 是运行文件，
`single-flight.test.js` 是测试文件，不应发布到小程序运行包。当前构建会排除测试源码，
并在发布前拒绝 `*.test.js` 和 `*.spec.js`；微信开发者工具若继续请求后者，说明本地
仍然复用了旧增量模块索引。

遇到该错误时按以下顺序恢复：

1. 执行 `pnpm --filter @hospital/miniprogram build`。
2. 执行 `pnpm --filter @hospital/miniprogram runtime:verify`。
3. 确认 `apps/miniprogram/dist/` 下没有 `*.test.js` 或 `*.spec.js`。
4. 关闭真机调试，退出并重新打开当前小程序项目。
5. 先执行一次普通编译，再重新生成真机调试二维码。

禁止把测试文件复制到 `dist/`，也不要通过修改旧 Python 服务或重启线上旧服务来处理
这个本地工具索引问题。

## 验收边界

- 配置层单元测试覆盖空白地址回退。
- 运行包门禁覆盖测试文件不进入 `dist/`。
- 本记录不宣称真实微信登录、支付或 provider 联调已经完成；这些仍需真机、真实
  网络请求和低敏服务日志三层证据。
