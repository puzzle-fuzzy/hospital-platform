# 小程序候选 `99c7e8fd`：健康百科只读链路与全量入口门禁（2026-08-25）

> 本记录描述当前源码提交生成的 pending 运行包，不代表已经发布到 `dist/`、上传微信或完成真机业务验收。
> 本轮只修改新项目；旧 Python 服务、线上 API、MySQL、Redis 和另一会话负责的众阳自动化均未修改。

## 当前来源

| 项目 | 值 |
| --- | --- |
| Git 来源 | `99c7e8fd76bd7b38de50d1c5cfdbc7002cba4a15` |
| pending 目录 | `.local/hospital-miniprogram/pending/` |
| pending 页面数 | 20 |
| 小程序测试 | `259 pass / 0 fail / 2445 expect()` |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b` |
| 线上服务端 | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |

## 本候选内容

- 在旧端 64 页面逐页台账的基础上，新增健康百科目录、症状查疾病结果、疾病详情和药品详情三个原生页面落点。
- 小程序只调用平台 `/api/v2/knowledge/health/...` 路径，不持有旧端 URL、provider 标识或旧库快照。
- 健康内容必须由服务端版本化审核 bundle 提供；没有已发布 bundle 时，服务端和页面共同 fail-closed，不把关闭态伪装成空内容。
- 疾病详情和药品详情均为审核资料只读展示；药品资料不构成处方或个体化用药建议。
- 保持四个主入口由微信原生 `tabBar` 单一管理；不新增页面级底栏，不改变支付、医保、预约写入、患者绑定、二维码和 HIS 回写的关闭边界。

## 本地门禁

```text
pnpm --filter @hospital/miniprogram typecheck   通过
pnpm --filter @hospital/miniprogram test        259 pass / 0 fail / 2445 expect()
pnpm migration:audit                            20 registered page(s) 通过
pnpm docs:audit                                 682 docs，无断链
pnpm architecture:audit                         68 条规则通过
pnpm format:check                               通过
pnpm lint                                       通过
```

构建已经通过 TypeScript 编译、页面入口、相对依赖、测试脚本隔离和运行包静态检查；发布阶段因微信开发者工具锁定
`apps/miniprogram/dist/` 返回 `EBUSY`。发布器已保留完整候选于 pending，上一份 live 运行包没有被清空或覆盖。

## 发布前操作

关闭当前微信开发者工具窗口及真机调试会话后，在仓库根目录执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须从新的 `99c7e8fd` 运行包重新编译、扫码，并分别核对四 Tab、健康百科关闭态/内容态、登录和就诊人切换。
旧 live、历史候选和旧二维码不能作为本候选证据。正式内容 bundle、临床审核和发布/撤回演练仍是健康百科真实开放前置条件。
