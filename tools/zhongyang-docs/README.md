# 众阳官方接口文档只读查询工具

这个工具是 Provider 文档接收辅助工具，不属于 `apps/api`，不会调用现有业务适配器，也不会修改数据库、Redis、线上服务或业务 gate。浏览器启动使用 Node 24；Bun 用于纯函数测试。

## 首次准备

在仓库根目录执行：

```powershell
pnpm install
pnpm exec playwright install chromium
```

如果机器已经安装 Chrome/Chromium，也可以通过 `ZHONGYANG_DOCS_EXECUTABLE_PATH` 指定可执行文件，跳过 Playwright 浏览器下载。

## 查询

```powershell
pnpm zhongyang:docs
```

默认查询 `2.6.65.2`。也可以指定接口编号：

```powershell
pnpm zhongyang:docs --query 2.6.65.2
```

浏览器会以有界面模式启动。请在浏览器内人工完成登录和验证码并点击确认，然后回到终端按 Enter；如果没有点击确认，脚本也会在回车后代为提交。工具不会尝试绕过验证码，也不会读取或输出密码、Cookie、localStorage 或 Authorization。

本工具已内置当前众阳门户的登录、验证码提示、搜索框和目录项选择器。门户页面结构发生变化时，再通过选择器覆盖配置：

```powershell
$env:ZHONGYANG_DOCS_SEARCH_SELECTOR = 'input[placeholder="输入关键字查询"]'
$env:ZHONGYANG_DOCS_RESULT_SELECTOR = '.api-result-item'
$env:ZHONGYANG_DOCS_AUTHENTICATED_SELECTOR = '.user-menu'
pnpm zhongyang:docs
```

结果保存在 `.local/zhongyang-docs/queries/`，其中包括原始脱敏采集、结构化 JSON 和结构化 Markdown；浏览器登录 profile 在 `.local/zhongyang-docs/profile/`。这些内容默认被 Git 忽略。

状态含义：

- `found`：找到可见文档并生成脱敏 Markdown 草稿；
- `explicit_denied`：门户明确返回无权限；
- `not_found`：门户明确提示无搜索结果；
- `unknown`：门户没有给出足够证据，不能判定未授权；
- `captcha_required`、`session_expired`、`ui_changed`、`upstream_error`：需要人工处理或修正配置。

只有在人工检查草稿后，才使用显式参数写入 Provider intake：

```powershell
pnpm zhongyang:docs --query 2.6.65.2 --write-intake
```

写入的记录仍然是 `normalized`，不代表接口已经授权、已联调或可以进入业务代码。运行 Provider 文档审计：

```powershell
pnpm provider:audit
```

## 验证

```powershell
bun test tools/zhongyang-docs
pnpm exec tsc --noEmit -p tools/zhongyang-docs/tsconfig.json
```
