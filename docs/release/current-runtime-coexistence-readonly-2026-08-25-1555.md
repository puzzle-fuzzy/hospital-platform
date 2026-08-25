# 当前新旧服务共存只读复核（2026-08-25 15:55 CST）

> 本记录只保存公网探针和本地 SSH 连接结果，不包含环境变量、微信密钥、数据库连接串、Redis 凭据、Bearer token、患者标识或业务响应正文。
> 本轮没有重启服务、修改配置、访问患者业务数据或写入数据库。

## 1. 公网事实

通过公网 `https://test-hp.meiyi.pro` 只读访问得到：

| 探针 | HTTP | 结果 |
| --- | ---: | --- |
| `/api/v2/health/live` | 200 | `status=ok`，服务名为 `hospital-api` |
| `/api/v2/health/ready` | 200 | `database=ok`、`redis=ok`、`schema=ok` |
| `/api/v2/me/profile`（无 Bearer） | 401 | 稳定错误码 `unauthorized`，鉴权边界生效 |
| `/api/v2/knowledge/health/part/list`（无 Bearer） | 404 | 当前线上 release 尚未挂载健康知识路由；不能把本地 staging 导入工具或源码测试写成线上能力 |

公网响应同时返回了低敏 `x-request-id`，本记录不保存业务请求参数和响应正文之外的敏感内容。

## 2. 内网 SSH 事实

本次使用只读、批处理 SSH 连接 `ps@192.168.112.172`，结果为：

```text
Permission denied (publickey,password).
```

因此本轮没有读取 systemd、监听端口、当前 release 指针或服务器日志；不能据此推断旧服务状态。服务器侧事实继续以已有受控发布记录为准，待运维重新配置当前会话可用的公钥后再做下一次只读复核。

## 3. 迁移判断

1. 新旧服务共存的公网基础探针仍正常，不能证明患者、预约、报告、费用或普通资料业务已完成真机验收。
2. 健康百科 staging 导入命令只存在于本地候选，当前没有执行真实导入，也没有打开生产 route gate。
3. SSH 失败只代表本次取证通道不可用，不修改旧服务、不重启旧服务，也不通过公网探针猜测服务器内部日志。
