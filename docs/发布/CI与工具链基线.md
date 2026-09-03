# CI 与工具链基线

本文登记仓库级代码质量门禁和可复现构建所依赖的工具链。它只约束新项目仓库，
不自动发布服务端、不重启线上进程，也不改变旧 Python 服务的运行方式。

## 固定版本

| 工具 | 版本来源 | 当前版本 |
| --- | --- | --- |
| Bun | [`.bun-version`](../../.bun-version) | `1.4.0` |
| Node.js | [`.node-version`](../../.node-version) | `24.12.0` |
| pnpm | 根 `package.json` 的 `packageManager` | `11.9.0` |

`package.json` 的 `engines` 与两个版本文件保持精确一致。`pnpm-lock.yaml` 继续由
`pnpm install --frozen-lockfile` 保护，不能在 CI 中隐式更新依赖锁文件。

## CI 责任边界

`.github/workflows/ci.yml` 在 `main` push 和针对 `main` 的 Pull Request 上执行：

1. 按版本文件安装 Bun、Node.js 和固定版本 pnpm。
2. 执行 `pnpm toolchain:audit`，检查版本声明、版本文件和 workflow 没有漂移。
3. 执行 `pnpm install --frozen-lockfile`。
4. 执行 `pnpm check:candidate`，覆盖仓库静态审计、文档、类型检查、测试和构建。

这条 CI 只证明候选代码可检查、可测试、可构建。生产发布仍必须遵循
``ssh-access-recovery-and-release-gate-2026-08-22.md``
的受控窗口；当前服务端 release 之后仍存在未部署运行时代码漂移，不能因为 CI 通过就自动切换线上服务。
