# 服务端候选 `709b9ea0` 认证边界本地审计（2026-08-22）

> 本文记录服务端候选的本地验证事实，不代表该候选已经部署到线上。当前线上服务端仍为
> `0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；旧 Python `8001` 不在本候选范围内。

## 修正内容

新 API 的公开入口判断原先只比较 URL 尾缀。这样虽然当前已注册路由不会产生误匹配，但
`/api/v1/other/auth/wechat` 这类伪造路径理论上可能跳过认证生命周期。候选 `709b9ea0`
改为只接受无分组前缀的精确模块路径，或 `/api/v1`、`/api/v2` 分组下的精确路径；其它路径继续
进入 Bearer 认证，保持 fail-closed。回归测试同时覆盖合法路径、伪造层级和额外尾路径。

核心逻辑位于 `apps/api/src/plugins/request-authentication.ts`，测试位于
`apps/api/src/plugins/request-authentication.test.ts`；中文注释说明了 API 分组和认证边界，
没有扩大公开入口列表，也没有改变登录、支付通知或业务路由的 contract。

## 本地验证

```text
API 全量测试：210 pass / 1 fail / 869 expect()
唯一失败：P0 release baseline gate（线上仍为 0e2a366e，709b9ea0 尚未部署）
API typecheck：通过
Biome（两个变更文件）：通过
pnpm build：9 个 workspace 全部成功；服务端 bundle 重新生成
```

API 测试中的唯一失败和根 `pnpm check` 的停止点都是同一个发布保护：线上 release 仍为 `0e2a366e`，而
`apps/api/src/plugins/request-authentication.ts` 已存在未部署运行时代码。这个失败是发布保护，
不是业务逻辑测试失败；在候选完成生产 preflight、隔离 smoke 和无损切换前，不能把本地修正写成线上事实。

## 发布阻断与安全边界

本机使用批处理 SSH 只读检查 `ps@192.168.112.172` 时返回 `Permission denied (publickey,password)`；经阿里云中转到
`10.0.0.3` 时，目标主机指纹与本机此前信任的 `192.168.112.172` 完全一致，但 `ps` 公钥认证仍被拒绝。
本轮没有写入密码、没有自动操作 Xshell、没有上传文件、没有切换 `current`、没有重启服务，也没有
触碰旧 Python、MySQL、Redis 或 Provider。

获得受控 SSH 发布通道后，必须按 [`../../infra/systemd/api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md)
执行：固定 `709b9ea0` 产物、真实生产 preflight、隔离端口 smoke、记录旧 `current` 和旧 Python PID，
再原子切换并只重启 `hospital-platform-api-v2.service`；切换后重新验证新 API ready、旧 `8001`、公网
认证边界和发布基线审计。旧服务不得停止或重启。
