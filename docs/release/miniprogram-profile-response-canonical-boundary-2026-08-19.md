# 小程序普通资料响应 canonical 边界（2026-08-19）

## 发现的问题

普通资料 API 的成功响应虽然经过了 `success`、字段存在性、年龄和版本类型检查，但客户端仍可能接受首尾空白、控制字符或非法邮箱，
并将代理返回的额外字段原样交给页面。TypeScript 返回类型不能证明微信真实收到的 JSON，资料页面也不应成为旧服务字段扩散到新端的通道。

## 固定规则

- `displayName` 按 Unicode code point 计数，必须非空、无首尾空白和控制字符，最多 64 个字符；
- `gender` 只能是 `male`、`female` 或 `unknown`；
- `age` 只能是 `null` 或 0–150 的安全整数；
- `email` 只能是 `null` 或满足普通资料邮箱格式、无首尾空白和控制字符的字符串，最多 320 个字符；
- `version` 只能是 0–`4294967295` 的安全整数，0 表示尚未持久化；
- 成功返回只重新投影 `displayName/gender/age/email/version`，未知字段直接丢弃；
- 任何一条规则失败都整包 fail-closed，保持 `provider-response-invalid`，不能过滤坏字段后伪装成功。

## 与服务端的关系

服务端 `UserProfileService` 和 domain 已经在持久化前、读模型返回前执行同一类 canonical 校验；小程序这次补的是网络接收边界，
用于阻止代理、旧版本或未来替换服务返回的异常 JSON 进入页面。它不改变 owner、版本冲突、资料写入或会话规则，也不意味着真实资料 PUT 已验收。

## 证据与边界

- 回归覆盖缺失字段、首尾空白、控制字符、非法邮箱、非法枚举、越界年龄、版本类型/上限和未知字段丢弃；
- 没有执行真实 `PUT /me/profile`，没有写入生产资料；
- 本次没有修改旧 Python 服务、线上 release、MySQL、Redis、微信支付或医保流程。
