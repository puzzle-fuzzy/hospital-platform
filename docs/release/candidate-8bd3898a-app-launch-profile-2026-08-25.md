# 小程序候选 `8bd3898a`：App 启动资料初始化与授权点击修复（2026-08-25）

> 本文记录的是已经完成 staging 校验、但尚未替换 live `dist/` 的候选。微信开发者工具当前占用 `apps/miniprogram/dist/`，原子发布因此被安全地阻断；不能用本记录证明真机已经运行新候选。
> 本次没有修改旧 Python 服务、服务器配置、MySQL、Redis 或线上微信小程序。

## 1. 候选边界

| 项目 | 结果 |
| --- | --- |
| Git 提交 | `8bd3898a7841404cb69d9c091f5f59a7530eb3cf` |
| 已验证 staging | `.local/hospital-miniprogram/pending/` |
| 当前 live dist | 仍为上一份完整运行包，来源 `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b` |
| 页面数量 | 16 |
| 构建指纹 | `.local/hospital-miniprogram/pending/build-info.json` |
| 发布结果 | staging、页面入口、相对依赖、无测试脚本均通过；替换 live 时收到 Windows `EBUSY`，pending 已保留 |

运行包发布器采用“staging 完整校验 → 原子替换 live”的顺序。开发者工具锁住 live 目录时不会清空旧包，也不会半发布新包；关闭占用窗口后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

## 2. 本次业务修正

### 2.1 App 进入即启动全局资料初始化

`apps/miniprogram/src/app.ts` 的 `onLaunch` 现在直接启动 `ensureGlobalUserProfile()`。页面不再负责创建首次资料请求，而是调用 `waitForGlobalUserProfile()` 等待 App 已启动的同一条 Promise。

全局仓库将以下内容写入同一份 `App.globalData` 快照：

- 当前服务端 owner 与普通资料；
- 当前设备、当前 owner 的微信昵称和头像展示缓存；
- 资料状态、错误状态和授权提示；
- App 与页面模块共用的资料初始化 Promise、订阅集合和会话代际。

App 全局脚本和页面 CommonJS 模块由微信分开加载，不能只依赖模块级变量。本候选因此把 Promise、监听器和会话代际都放入 `globalData`，避免出现“字段相同但请求重复”或“合法响应被误判为 session changed”。

### 2.2 修复“未授权”提示点击无效

原问题是“我的”页的 `loading` 同时代表患者目录加载；患者目录刷新时，头像/昵称授权点击处理会提前 return。用户看到“未授权，可点击此处重新获取”时，点击实际上被吞掉，页面看起来只是闪动。

现在只有 `wechatProfileState === "loading"` 才会阻止重复授权；患者目录 loading 不再阻断微信资料授权。提示区域也扩大为独立可点击区域，拒绝授权后保留稳定文案并显示明确 Toast。

首次头像、昵称和性别授权仍必须由用户手势触发；App 自动启动只做静默会话恢复、服务端资料读取和全局共享，不会自动弹出微信资料授权。

## 3. 自动化证据

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @hospital/miniprogram test` | 248 pass / 0 fail / 1988 expects |
| `pnpm --filter @hospital/miniprogram typecheck` | 通过 |
| App global-script bundle | Bun bundled 7 modules，产物无 CommonJS 启动壳 |
| staging 页面/资源门禁 | 通过，16 个页面脚本存在 |
| staging 测试脚本门禁 | 通过，未发现 `*.test.js` / `*.spec.js` |
| `git diff --check` | 通过 |

## 4. 下一步验收

1. 关闭占用 `apps/miniprogram/dist/` 的微信开发者工具窗口和真机调试会话；不要强制删除旧包。
2. 执行上面的 `runtime:publish-pending`，确认 `runtime:verify` 来源变为 `8bd3898a...`。
3. 从新 `dist/` 重新生成二维码后扫码；旧 `fcc6630e` 二维码不能证明本候选。
4. 进入小程序后观察 App 启动资料初始化；切换四个主 Tab 不应重新请求 `/me` 或 `/me/profile`。
5. 在患者目录仍显示加载时点击“未授权，可点击此处重新获取”，应出现微信授权弹窗；拒绝后文案稳定，再次点击可以重试。

患者、预约、费用仍按只读 contract 验收；支付、医保、结算、预约写入、取消、二维码、病历和 HIS 回写继续关闭。
