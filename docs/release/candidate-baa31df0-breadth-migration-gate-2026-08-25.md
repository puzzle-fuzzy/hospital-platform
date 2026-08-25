# 小程序候选 `baa31df0`：就诊只读子集与全量入口门禁（2026-08-25）

> 本记录描述当前源码提交生成的 pending 运行包，不代表已经发布到 `dist/`、上传微信或完成真机业务验收。
> 线上服务端仍为 `8eb51b5f`，旧 Python 服务仍保持原端口；本候选没有修改服务端、旧 Python、数据库或 Redis。

## 当前来源

| 项目 | 值 |
| --- | --- |
| Git 来源 | `baa31df08f63af30266664f9fef9224653cf52bb` |
| pending 目录 | `.local/hospital-miniprogram/pending/` |
| pending 页面数 | 17 |
| pending 测试文件数 | 0 |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b` |
| 线上服务端 | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |

## 本候选内容

- 保持旧端 64 个页面的逐页落点台账、七个业务域覆盖和固定状态页入口，避免新端出现 404 或死 Toast。
- 就诊页继续使用微信原生主 Tab，读取当前 owner 的“全部挂号”只读摘要。
- 未来/历史标签按医院中国标准时间的 `workDate` 分类；当天记录排除，不把预约摘要伪装成实时叫号或排队状态。
- 记录列表每次最多展开 8 条，只在本地扩展已取得的读模型，不重复调用 Provider。
- 今日实时动态仍不连接旧 WebSocket、不直连队列接口、不读取 provider 患者号；互联网医院仍不恢复 WebView。
- 不开放预约写入、患者绑定、二维码、支付、医保、临床问卷、病历、住院、外部问诊和 HIS 回写。

## 本地门禁

```text
pnpm --filter @hospital/miniprogram typecheck   通过
pnpm --filter @hospital/miniprogram test        258 pass / 0 fail / 2432 expect()
pnpm migration:audit                            64 old page(s) + 64 catalog page(s) 通过
pnpm docs:audit                                 680 docs，无断链
pnpm architecture:audit                         68 条规则通过
pnpm format:check                               通过
pnpm lint                                       通过
```

小程序构建的类型阶段通过，发布阶段因微信开发者工具锁定
`apps/miniprogram/dist/` 停止；旧 live 运行包已保留，候选仍在 pending。
根 `pnpm test` 和 `release:baseline:audit` 对另一会话尚未部署的预约适配器保持 fail-closed，
本会话不修改、不暂存、不部署该文件，也不通过放宽发布基线掩盖漂移。

## 发布前操作

关闭当前微信开发者工具窗口和真机调试会话后，在仓库根目录执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须从新的 `baa31df0` 运行包重新编译、扫码，并按
[`readonly-acceptance-next-2026-08-25.md`](readonly-acceptance-next-2026-08-25.md) 采集页面、客户端 requestId、
服务端 trace 和 Provider 低敏请求号。旧 live、历史候选和旧二维码不能作为本候选证据。
