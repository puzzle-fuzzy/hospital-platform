# Admin 2.0

医院管理端使用 Vue 3，并基于官方 [Vben Admin](https://github.com/vbenjs/vue-vben-admin) 的 `web-antd` 应用开发。

- 官方版本：`v5.7.0`。
- 官方提交：`63a38dce49ba109f61607994e21ba921d8e970e9`。
- 上游来源和原始核心源文件 SHA-256 清单：`UPSTREAM.json`。
- 包管理器：保留官方 `pnpm@10.33.4`，保留官方 `pnpm-lock.yaml`；安装始终使用 frozen lockfile。

本项目在 Vben 上开发医院业务：业务路由、页面、API 适配、登录适配与应用配置放在 `apps/web-antd`。`packages` 和 `internal` 的官方原始源文件保持原样，不重写 Vben 布局、组件库、权限库或构建工具。官方构建所生成的 `dist`、类型声明和依赖目录不是核心源代码修改。

## 安装与本地运行

需要官方支持的 Node.js（`^22.18.0 || ^24.0.0`）、可用的 pnpm，以及用于打包和运行管理服务的 Bun。以下命令从医院仓库根目录执行：

```powershell
node apps/admin2/tools/run.mjs install
node apps/admin2/tools/verify-upstream.mjs
node apps/admin2/tools/run.mjs typecheck
node apps/admin2/tools/run.mjs dev:antd
```

执行器会把子进程的实际工作目录设为 `apps/admin2`，再调用 pnpm。因此 pnpm 会选用本项目的 `10.33.4`，不会把医院仓库根目录的 pnpm 版本误用于 Vben。不要从医院根目录用 `pnpm --dir apps/admin2 ...` 代替此入口，也不要执行非 frozen 安装或生成另一份锁文件。

开发页通过应用级 Vite 配置将同源 `/api` 代理到已有管理服务。开发者登录后执行的查询和操作仍会访问所配置的后端；UI 开发或验证应使用合成数据，不自动发起真实退款、退号、重试或 Provider 状态刷新。账号和验证码由使用者输入，不写进源码或演示数据。

## 构建与启动

```powershell
node apps/admin2/tools/build.mjs
bun apps/admin2/dist/server.js
```

构建工具依次校验官方核心源文件，调用官方 `pnpm run build:antd`，再次核验原始核心及锁文件，再把完整的 `apps/web-antd/dist` 复制到本项目 `dist/client`。同时用 `apps/admin/src/server.ts` 构建 `dist/server.js`，复用已有 Bun 同源服务端。发布时使用完整 `apps/admin2/dist`，不要只取入口 JS 或混入旧静态资源。

`dist` 是本项目的生成目录。工具在递归替换前检查绝对位置、项目边界、父目录以及目录内的符号链接 / Windows junction；检查失败会停止，不删除目标。官方前端原始产物仍位于 `apps/web-antd/dist`。构建不上传、不发布、不改线上环境或数据库。

生产环境继续由原部署系统提供现有管理服务环境配置，监听地址、上游地址、服务间令牌及只读账号配置沿用现有配置方式。参考 `apps/admin/.env.example` 的变量名；不要把配置值、账号密码、服务令牌复制到 Vben 环境文件、构建产物说明或日志中。`VITE_*` 为浏览器公开配置，只允许公开的应用名称和同源路径。

构建完成后可再次核验：

```powershell
node apps/admin2/tools/verify-upstream.mjs
node --test apps/admin2/tools/tools.test.mjs
```

校验器逐一读取 `UPSTREAM.json` 中的原始 `packages` / `internal` 文件进行 SHA-256 对比，分别报告内容变更、缺失或路径链接。它不会把正常的官方 `dist` 生成文件当作核心改动。`UPSTREAM.json` 是项目溯源清单，不是远程签名证明。

## 业务与权限

管理端提供支付记录、账本、同步任务及挂号核验，默认首页为支付记录。所有浏览器请求继续使用同源 `/api`，沿用已有请求、响应、错误和财务处理合同；内部服务令牌仅由原服务端持有。

运营管理和只读查看保留原有认证与权限。只读会话不能退款、查询会引发状态恢复的退款、取消挂号、重试同步、操作人工复核或读取接口原文。服务器仍在路由分派前校验权限，界面按钮不作为授权依据。财务只读允许已有派生账本投影及访问审计，不承诺数据库物理零写。

金额使用原支付实付事实，未确认金额不能显示成已支付；退款能力取后端返回的剩余可退范围，医院减免不参与退款。医保、微信、医院回写与挂号取消分别显示结果；未确认的操作先查询，不自动重复提交。运营原文仅在受控接口详情按需读取，通过 Vue 文本插值展示，不进入持久化状态。

## 静态资源与 CSP

原管理服务使用 `script-src 'self'` 和 `connect-src 'self'`。本应用应保留同源构建资源，关闭会注入内联脚本的默认加载页及不需要的 PWA。构建工具会检查最终 HTML 中的可执行内联脚本和远程脚本；不兼容时停止交付，不放宽服务端 CSP。

Vben 的 Iconify 图标可按名称在运行时访问外部图标服务；生产 CSP 不允许这类请求。医院应用应在应用层预注册实际使用的离线图标，或使用构建时已打包的图标。不要为图标修改官方组件或增加公网 `connect-src`。最终浏览器验收应同时检查菜单图标、主题切换、登录、只读权限和 `/api` 请求。

应用公开构建配置保存在已提交的三个固定模板：`apps/web-antd/.env.example`、`.env.development.example` 和 `.env.production.example`。开发和构建入口会先在同一应用目录生成对应的 `.env`、`.env.development` 和 `.env.production`，使 Vben 原生配置读取以及 `_app.config.js` 在全新检出时也能正确获得 `/api`。这三个生成文件被 Git 忽略，仅含浏览器公开参数，不包含部署环境或凭据。

生成前校验固定路径及符号链接 / Windows junction。已有相同字节的文件保持原样；已有不同字节时直接停止，不覆盖。所有 `.env.local`、`.env.<mode>.local` 覆盖文件均会使开发 / 构建停止，只报告路径，不读取或输出其内容。更改公开构建参数时，应审查并修改已提交的 `.env*.example`，主动核对或清理本地旧生成文件后重跑；不要用本地覆盖文件携带后端值。子进程的 `VITE_*` 也以本次固定模板为准，避免宿主环境覆盖产物。

必要时可单独核验 / 生成这三个公开文件，不接受额外路径或模式参数：

```powershell
node apps/admin2/tools/ensure-public-env.mjs
```

外层 Biome 不重排 Vben 官方源码；应用使用官方格式工具与 Vue 类型检查。

## 官方页面与功能开关

使用 Vben 5.7 官方原版的认证布局、登录表单、插画、工具栏和后台框架。应用的 `src/layouts/auth.vue` 与固定上游版本保持原字节一致；不使用自定义标题插槽、经典版背景、登录页 CSS 或强制浅色主题。医院名称、同源 Logo 和真实账号信息通过官方应用配置与组件属性接入。

登录表单沿用官方字段 Schema：首个原生选择框用于实际的运营 / 只读登录方式，随后为账号、密码与后端要求的图片验证码。模式切换使用官方字段依赖；不提供演示账号、默认密码或无后端校验的滑块验证码。登录标题、说明、按钮和记住账号行为保持官方默认。

未接入的手机登录、二维码登录、注册、找回密码及第三方登录通过 `AuthenticationLogin` 的官方开关关闭，对应认证路由不注册。通知、锁屏及无业务实现的扩展设置保持禁用；保留官方可用的主题、语言和布局设置。关闭功能只影响入口，不改变原有服务端认证、只读权限或财务处理合同。

管理端不提供实时日志及支付展示菜单或页面，其业务路由与页面组件已移除。启动时仅清理这两个页面残留的标签及搜索历史，保留其他页面状态。旧支付展示地址转到支付记录，并继续经过原有登录与权限校验。服务端运行日志、诊断接口及支付调用链保留原有边界。

业务卡片的纵向间距由原生容器管理：页面使用官方 `Page` 的 `content-class="flex flex-col gap-4"`，卡片内容、加载容器、折叠面板、抽屉和弹窗在各自内容层使用 `gap-4`（16px），紧密元数据区使用 `gap-3` / `gap-2`。不要依靠 Antd 组件根节点的 `mb-*` 或父级 `space-y-*` 设置业务区块间距：Antd 未分层的 margin reset 会覆盖 Tailwind 4 utilities layer。已有原生 `Space` 的 `size` 保持使用；需要块间距的换行元数据使用原生 flex gap，避免 `Space wrap` 的负下边距。此约定仅作用于医院业务页面，不更改 Vben 核心、全局 CSS layer、主题或组件内部默认 padding。
