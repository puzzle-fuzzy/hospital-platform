# 小程序候选 `fcc6630e` 构建记录（2026-08-25）

> 本文只证明本地微信运行包的来源、构建边界和自动化回归，不代表线上小程序已经替换，也不代表微信真机或众阳业务已经验收。
> 本候选没有修改旧 Python 服务、服务器配置、MySQL 或 Redis。

## 1. 候选来源

| 项目 | 结果 |
| --- | --- |
| Git 提交 | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b` |
| 运行目录 | `apps/miniprogram/dist/` |
| 页面数量 | 16 |
| 预览二维码 | `E:\__Super_Core__\hospital-platform\.local\device-acceptance\fcc6630-preview.png` |
| 微信 AppID | `wx4bc833cb3358c8d8` |
| 线上服务端 | `8eb51b5ffe85b0b8f8a032783f893117d3df549d`，仅使用现有测试域名 API |

`dist/build-info.json` 保存完整来源指纹；它只包含提交号、页面数量和生成时间，不包含会话、患者、Provider 或密钥。

## 2. 本次代码变化

1. App 级用户资料仓库继续作为“我的”、普通资料页和主 Tab 的唯一资料来源。
2. `/me`、`/me/profile` 的启动读取使用单飞 Promise；资料就绪后再次切换 Tab 不会重新请求普通资料。
3. 修正资料读取成功时返回“发布后的冻结快照”，避免调用方和 `App.globalData` 拿到字段相同但引用不同的对象。
4. 架构审计区分“登录链路禁止隐式微信资料授权”和“用户点击资料授权”，并排除不会进入 `dist` 的测试 fixture。

首次微信头像/昵称弹窗仍然只能由用户明确点击触发；自动启动只负责静默微信会话、读取服务端普通资料和共享全局状态。

## 3. 自动化证据

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @hospital/miniprogram test` | 247 pass / 0 fail / 1975 expects |
| `pnpm --filter @hospital/miniprogram typecheck` | 通过 |
| `pnpm --filter @hospital/miniprogram build` | 通过，16 个页面脚本存在 |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过 |
| `pnpm architecture:audit` | 68 条规则通过 |
| `pnpm docs:audit` | 659 个文档无断链 |

工具测试中仍有发布基线的并行边界：`packages/adapters/src/zhongyang-appointments.ts` 是另一会话的未部署运行时代码，
因此 `release:baseline:audit` 按设计保持 fail-closed。本候选没有修改、暂存或部署该文件。

## 4. 尚未证明的事项

- 尚未取得本候选二维码对应的真机页面截图和客户端 `requestId`。
- 尚未把客户端请求与线上 Elysia/Pino `traceId`、业务事件和 Provider 低敏请求号组成同链证据。
- 尚未替换线上微信小程序版本；服务器仍保持新 Elysia `18081` 与旧 Python `8001` 共存。
- 预约写入、取消、费用支付、医保、退款、二维码、病历和 HIS 回写继续关闭。

## 5. 真机验收顺序

1. 只打开 `apps/miniprogram/dist/`，不要打开 `src/`、父目录或历史 `mp-weixin` 项目。
2. 扫描本记录的 `fcc6630-preview.png`，确认启动日志中的来源指纹一致。
3. 进入“我的”，确认服务端资料自动加载；首次头像/昵称授权必须点击头像区域。
4. 在四个原生 Tab 间切换，确认资料不重复请求、底栏只有一份且选中态正确。
5. 再按只读手册验证患者切换、我的挂号、爽约和门诊费用；任何一项都不能点击支付或写入入口。
