# `4ea15b8` 原生 Tab 运行包发布候选（2026-08-24）

> 本记录只描述本地重制小程序候选，不代表已经上传微信、替换线上小程序或完成真机视觉验收。旧 Python 服务、线上服务、数据库和 Redis 未修改。

## 当前来源

| 项目 | 结果 |
| --- | --- |
| 小程序代码与构建链提交 | `4ea15b8cdfe285c62f4fb37c7432a2229f8d30c8` |
| 运行包目录 | `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist` |
| `build-info.json.sourceRevision` | 与上方 40 位提交号一致 |
| 页面入口 | 16 个页面脚本完整 |
| TabBar | 微信原生 `custom=false`、`position=bottom`，四项共用一份系统底栏 |
| 选中资源 | 四项均声明独立 `selectedIconPath`，资源存在且为蓝色 active PNG |
| 小程序测试 | `234 pass / 0 fail / 1886 expect()` |
| TypeScript、Biome、运行包校验 | 通过 |
| pending 运行包 | 无；本次构建已直接完成原子发布 |

## 本轮修正的运行链

构建脚本现在会先完成页面、资源和来源指纹校验，再原子替换 `dist/`。如果 Windows 开发者工具锁定旧 `dist/`，构建不会删除旧运行包，而会把完整候选保留到仓库内受控的 `apps/.hospital-miniprogram-pending/`；释放工具后可执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

本次没有生成 pending 目录，因为 `dist/` 已成功发布。构建后的 `dist/app.json` 已现场核对为原生 TabBar，页面自身没有第二套自绘底栏；`app.js` 启动时会打印完整 `sourceRevision`，用于排除旧二维码和开发者工具旧增量包。

## 开发者工具和真机验收

1. 打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，确认 `miniprogramRoot=dist/`，不要打开 `src/` 或旧 `mp-weixin` 项目。
2. 执行一次“普通编译”，在控制台确认：`[医院小程序] 运行包来源：原生 TabBar；revision=4ea15b8cdfe285c62f4fb37c7432a2229f8d30c8`。
3. 重新生成二维码后依次点击“医疗服务、就诊、互联网医院、我的”。四项应始终只有一份固定在窗口底部的原生 TabBar，当前项显示对应蓝色选中图标，切换不把主 Tab 压入普通页面栈。
4. 如果仍看到旧底栏、选中态消失或切换闪动，先停止业务验收；记录当前页面 route、完整 revision 和开发者工具项目根目录。revision 不是 `4ea15b8...` 时，问题仍是旧运行包/旧增量缓存，不是本候选的页面代码。

本候选继续关闭预约写入、患者绑定、支付、医保授权/结算、取消和 HIS 写回；当前只做导航、视觉和已具备 contract 的只读业务验收。
