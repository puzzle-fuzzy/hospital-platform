# Hospital Platform

医院小程序平台，包含原生微信小程序、Bun API、异步 Worker 和 Admin 2.0。

先读[系统设计](docs/架构/系统设计.md)了解运行链路与模块职责，再按[文档导航](docs/README.md)进入业务契约和运维手册。本轮清理范围、证据和后续顺序见[整理台账](docs/治理/整理台账-2026-10-28.md)。

## 工程入口

| 目录 | 职责 |
| --- | --- |
| `apps/api` | HTTP 路由、认证、服务编排及运行组合根 |
| `apps/worker` | 查单、outbox、异步补偿及独立进程生命周期 |
| `apps/miniprogram` | 微信原生客户端；开发者工具统一打开构建后的 `dist/` |
| `apps/admin2` | Admin 2.0 既有 Vben 前端；旧 `apps/admin` 已退役，日志查询保持删除 |
| `packages/*` | 领域、契约、Provider 适配、持久化、配置、日志和 AI 运行能力 |
| `tools` | 当前工程审计、资料接收与受控运维工具，后续按职责收敛 |
| `infra` | 当前本地 Compose、Nginx 和 systemd 声明；路径迁移单独实施 |
| `docs` | 契约、架构决策、操作手册、来源登记和历史证据 |

[目录与工具链](docs/治理/目录与工具链.md)说明当前结构及目标结构；[文档治理](docs/治理/文档治理.md)说明保留、归档与删除条件。

## 工具链

根工作区使用 `pnpm@11.9.0`、`Bun 1.4.0`、`Node 24.12.0`、Turbo 和 Biome，以 `package.json`、版本文件和锁文件为准。

Admin 2.0 前端是独立 Vben workspace，保留自身 pnpm、Node 与锁文件约定；通过根 `admin2:*` 命令进入，不把两套安装链混用。现有页面继续使用同源 `/api`；开发代理配置保持原样。

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm check:candidate
```

API 默认 `http://localhost:3000`；内部路由前缀 `/api/v1`。既有公网 Nginx 配置使用 `/api/v2` 转发，实际线上版本和路由另行核实。

```powershell
pnpm --filter @hospital/miniprogram build
pnpm runtime:verify
pnpm admin2:dev
pnpm admin2:typecheck
pnpm admin2:test
pnpm admin2:build
pnpm admin2:verify-vben
```

Admin 2.0 依赖与运行方式见[项目说明](apps/admin2/ADMIN2.md)。`admin2:build` 仅生成 `apps/admin2/dist/client/` 静态客户端；既有后端承载和生产反向代理不在本轮变更范围。

## 验证与项目盘点

| 命令 | 用途 |
| --- | --- |
| `pnpm check:candidate` | 候选质量门禁，包括静态边界、文档、类型、测试和构建 |
| `pnpm check` | 候选门禁加发布基线一致性检查；尚未发布的源码变化会被后者阻断 |
| `pnpm docs:audit` | 仓库 Markdown 相对链接完整性 |
| `pnpm architecture:audit` | 核心架构与小程序 Provider 隔离的静态约束 |
| `pnpm repository:inventory` | 只读输出跟踪文件、依赖声明、代码热点和重复内容的 JSON 盘点 |
| `pnpm release:baseline:index:audit` | 仓库登记的候选、基线 JSON 和证据绑定关系 |

`repository:inventory` 只处理 Git 跟踪文件，不扫描未跟踪的本机数据，不跟随链接，不自动判定或删除“无用”文件。新增文件需先纳入 Git 索引才会出现在清单中。需要保存结果时重定向至受控本机目录，避免把盘点 JSON 当成又一份手工事实源。

本地持久化验证见[基础设施说明](infra/README.md)和[持久化验收](docs/发布/持久化验收.md)；支付、Provider、设备和生产验证各自保留独立证据。静态门禁和构建通过不等于真实业务验收完成。

## 业务与运行边界

- 患者端只访问平台 API；HIS、医保、微信支付和 AI 服务通过服务端适配器进入。
- owner、患者映射、金额和最终支付状态由服务端核对，客户端调起成功不能替代查单、回调和 HIS 结算结果。
- 凭据、原始业务报文、生产导出与运行备份留在受控位置；根 `.env.example` 是开发模板，部署模板及 Admin 2.0 公开配置按各自手册维护。
- 添加就诊人当前入口见[公众号绑定说明](docs/添加就诊人公众号绑定说明.md)；历史支付测试端见[退役说明](docs/迁移/miniprogram-pay退役说明.md)。
- 发布指纹读取[仓库登记索引](docs/发布/当前基线.json)与[配套候选记录](docs/发布/候选-5738a71-服务端发布-2026-08-31.md)。登记资料存在历史漂移时保留失败，不能从 README 推断线上状态。

部署、日志与回滚分别见[systemd 说明](infra/systemd/README.md)、[API 发布手册](infra/systemd/api-v2-release-runbook.md)和[日志规范](docs/日志规范.md)。
