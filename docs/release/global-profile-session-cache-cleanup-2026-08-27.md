# 全局微信资料会话缓存清理修正（2026-08-27）

## 结论

本轮只修正新原生小程序的会话边界，不修改旧 Python 服务、线上 API、MySQL 或 Redis。
会话失效、账号切换或授权链收到会话变化时，先捕获失效前的 owner，再清理该 owner 绑定的
本机微信昵称/头像缓存，最后发布匿名全局资料快照。缓存按 owner 隔离仍然保留，但不再把“新账号
不会直接读取”当作旧账号隐私已经清理。

## 代码边界

| 位置 | 责任 |
| --- | --- |
| `apps/miniprogram/src/services/global-user-profile.ts` | 全局资料清理、授权回调和启动失败的会话失效分支，在 owner 被清空前删除本机缓存 |
| `apps/miniprogram/src/services/wechat-user-profile.ts` | 继续负责 owner 绑定缓存的 key、读写和删除，不保存 openid、token 或原始授权响应 |
| `apps/miniprogram/src/services/global-user-profile.test.ts` | 验证会话通知清理旧账号缓存，并验证清理后全局资料回到匿名初始态 |

患者选择缓存没有在这里被删除。它属于单独的 owner/会话代际边界，由患者选择和患者范围页面
在重新读取 `/me`、患者目录后判定是否仍可用；清理资料缓存不能替代患者归属校验。

## 验证

已执行：

```powershell
pnpm exec biome format --write apps/miniprogram/src/services/global-user-profile.ts apps/miniprogram/src/services/global-user-profile.test.ts
pnpm --filter @hospital/miniprogram exec bun test src/services/global-user-profile.test.ts
```

结果：`10 pass / 0 fail / 56 expect()`。

这只证明代码和本地回归边界，不代表微信真机授权、真实账号切换或公网业务验收完成。当前没有微信开发者工具会话，
因此不生成二维码、不执行真机验收，也不改变当前 live 运行包。
