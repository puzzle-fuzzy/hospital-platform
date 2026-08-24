# 只读业务验收工具 staging 记录（2026-08-25）

## 结论

本次只为患者目录、预约历史和门诊费用的真实只读验收准备安全凭据入口，未切换新 API
服务版本，未重启任何 systemd 单元，也未修改旧 Python 服务。

## 服务器状态证据

| 项目 | 结果 |
| --- | --- |
| 新 API | `hospital-platform-api-v2.service=active` |
| 新 API 当前 release | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001` |
| readiness | `database=ok`、`redis=ok`、`schema=ok` |
| Worker | 未启动，继续保持 inactive |

## 只读工具目录

服务器新增目录：

```text
/home/ps/code/hospital-platform/releases/82c5e9e34775e4078fc891625a4b94110dde4451-readonly
```

目录内容来自当前 API release 的既有只读 bundle，额外加入：

```text
tools/provider-smoke-secure.ts
```

本地与远端 wrapper SHA-256：

```text
21dfd6693bb06100c331cc9c8bfee8197446362e51bd47bd943ad5b6b271ec50
```

该 staging 目录没有被 `current` 引用，systemd 也没有读取它，因此不会影响线上新 API 或旧服务。

## 执行边界

wrapper 要求真实交互式 TTY，逐字符隐藏读取：

- 平台 Bearer token；
- 当前会话目录返回的内部 opaque `patientId`。

凭据只进入 smoke 子进程的内存环境，不写入参数、文件、Git、systemd、shell history 或日志。
默认能力只包含会话、普通资料、患者目录、预约目录/历史和门诊费用只读，不包含
`patient-sync`、支付、医保、退款、预约写入、取消或 HIS 写回。

本轮只完成 staging 和无凭据前置复核；由于没有注入短时凭据，尚未产生患者、预约、费用或 Provider
业务请求，不能宣称这些业务已完成真实验收。真实执行命令见
[`readonly-acceptance-next-2026-08-25.md`](readonly-acceptance-next-2026-08-25.md)。
