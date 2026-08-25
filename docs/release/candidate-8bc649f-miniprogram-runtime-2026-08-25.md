# 小程序候选运行包 `8bc649f`（2026-08-25）

> 本记录只描述互联网医院安全壳分类修正后的源码候选构建和隔离暂存结果，不代表已经发布到微信开发者工具、上传微信或完成真机业务验收。

## 构建事实

- 源码候选：`8bc649f98565ae0caabf219e00426efe2dcaec7e`；
- 运行包来源：`.local/hospital-miniprogram/pending/build-info.json`；
- pending 来源：`8bc649f98565ae0caabf219e00426efe2dcaec7e`；
- 页面数量：20；
- 当前 live `apps/miniprogram/dist/`：仍由微信开发者工具锁定，未被覆盖；
- 旧 Python 服务、线上新 API、数据库和 Redis：本次均未修改。

## 本轮业务边界

互联网医院旧入口已经在迁移台账中准确归类为“部分迁移”：新端主 Tab 只展示安全壳，明确不加载外部 WebView、不接受任意 URL、不复用旧 ticket；外部 audience、HTTPS allowlist、短期会话、回跳和退出 contract 仍未开放。

## 门禁结果

构建阶段已完成 TypeScript 类型检查、页面文件生成、相对依赖检查、workspace 依赖检查、测试脚本排除和来源指纹写入。
尝试原子发布到 `dist/` 时因微信开发者工具持有目录锁失败，构建器保留了已验证的 pending 候选，没有清空或替换旧 live 包。

验证命令：

```powershell
$env:HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION = "8bc649f98565ae0caabf219e00426efe2dcaec7e"
pnpm --filter @hospital/miniprogram runtime:verify:pending
Remove-Item Env:HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION
```

结果：20 个页面及根文件通过，来源指纹与当前 pending 一致。

## 下一步

关闭微信开发者工具和真机调试会话后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布完成后，必须从新的 `dist` 重新编译，并使用
[`device-evidence-8bc649f-pending.json`](device-evidence-8bc649f-pending.json) 记录 9 个只读业务域的页面、客户端 requestId 和服务端同链证据。当前清单全部为 `pending`，不构成业务通过。
