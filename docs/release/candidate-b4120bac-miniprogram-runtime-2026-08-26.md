# `b4120bac` 小程序运行候选（运行来源 `25cd7c4a`，2026-08-26）

## 当前事实

- 功能提交：`b4120bac`；运行来源：`25cd7c4a323c9767b9367d319be14a82f681b37b`。
- pending 运行包：`.local/hospital-miniprogram/pending/`。
- 页面数量：25 个；四个主入口继续由微信原生 `tabBar` 统一管理。
- 当前源码回归：`293 pass / 0 fail / 3269 expect()`。
- `runtime:verify:pending`：通过，25 个页面脚本和根文件完整。
- 当前 live `dist`：仍由微信开发者工具占用，构建返回 `EBUSY` 时没有覆盖旧运行包。
- 真机证据：本候选尚未采集；不能沿用上一候选的业务证据。

## 本候选迁移内容

本轮首先扩大页面覆盖范围，新增四个原生页面外壳：

| 页面 | 当前阶段 | 已迁移内容 | 仍关闭的能力 |
| --- | --- | --- | --- |
| 门诊病历 | `surface-only` | 页面外壳、患者选择入口、查询范围说明、稳定关闭态 | HIS/EMR 目录、正文和详情授权 |
| 住院信息 | `surface-only` | 页面外壳、患者选择入口、独立 episode 边界、稳定关闭态 | 住院 episode 来源、患者映射和状态读取 |
| 我的医生 | `surface-only` | 页面外壳、患者选择入口、医生关系/目录边界、稳定关闭态 | 医生目录、关系 owner 和失效规则 |
| 电子导诊单 | `surface-only` | 页面外壳、患者选择入口、导诊单事实边界、稳定关闭态 | 专用来源、读取权限和保留周期 |

四个页面共用 `clinical-entry-surface.ts` 的注册逻辑。共享工厂只负责页面展示和安全导航，
不发起 Provider 请求、不生成假记录、不把当前用户直接当作就诊人。真实业务准入仍保持
`blocked-provider`，`surface-only` 不能计入 `replaced`。

## 构建与发布边界

构建阶段已经完成 TypeScript 编译、页面事件绑定、注册页面跳转、WXSS 本地资源限制、
运行包测试脚本排除、相对依赖和来源指纹校验。随后尝试原子替换 `apps/miniprogram/dist/`
时被微信开发者工具文件句柄拦截，错误为 `EBUSY`；旧 live 运行包保持不变，完整候选保留在
pending 目录。

开发者工具窗口和真机调试会话关闭后，执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须重新打开 `apps/miniprogram/dist/` 独立运行工程，再采集四个页面的截图、
页面状态、客户端 `requestId` 和服务端 Pino 关联；在此之前不能把页面外壳写成临床业务完成。

## 本轮未触碰范围

- 旧 Python 服务、旧数据库、Redis 和线上运行进程；
- `packages/adapters/src/zhongyang-appointments.ts`（另一会话负责）；
- 临床 Provider API、病历/住院/医生/导诊真实读取；
- 协议同意写入、患者新增/绑定、二维码、医保、支付、外部 WebView 和 HIS 回写。

## 关联文档

- [`../migration/native-page-migration-status.md`](../migration/native-page-migration-status.md)
- [`../migration/current-breadth-audit-2026-08-26.md`](../migration/current-breadth-audit-2026-08-26.md)
- [`../migration/full-migration-handoff-2026-08-25.md`](../migration/full-migration-handoff-2026-08-25.md)
