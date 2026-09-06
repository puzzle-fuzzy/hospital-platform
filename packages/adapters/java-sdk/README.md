# 官方医保 Java SDK 桥接层

新服务仍使用现有 Bun API、固定 FSI 路由和医保 relay。这里仅保留官方
`med-request-data-sdk-2.1.4.jar` 及其运行依赖，`OfficialFsiSdkCli.java`
由 `@hospital/adapters` 的 build 脚本编译到 `dist/java-sdk`。

构建环境需要 JDK 8 或更新版本（当前用 `javac -source 8 -target 8` 编译）。运行
API 的机器需要 `java`，不需要 `javac`。`MBS_JAVA_SDK_DIR` 可以覆盖默认的
`packages/adapters/dist/java-sdk` 路径；密钥只通过子进程环境传递，不进入
命令参数和标准输出。

SDK 原件和接入说明来自 `docs/医院对接医保java版SDK包_20240730_v3.3/`。
