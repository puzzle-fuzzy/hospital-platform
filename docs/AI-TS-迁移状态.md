# AI 从 Python 迁移到 TypeScript：状态与实施边界

更新时间：2026-09-16

## 目标

将旧 `hospital/local_ai` 的能力迁入 `hospital-platform`，由平台 API 统一承载鉴权、会话、HIS 数据边界和错误语义；模型、语音、知识检索作为可替换的 TypeScript Runtime 端口注入。旧 Python AI 不作为运行时回退路径。

旧模块的确认范围是：

- 统一聊天任务：导诊、客服、报告解读；
- 文档导入、原文保留、分块和知识检索；
- 本地 GGUF 文本生成；
- 本地 Whisper/CTranslate2 语音转写；
- 报告取数、权限校验、结构化后再交给模型解读。

## 已完成：第一条 MVP 垂直链路

当前已在平台仓库实现原生 TS 文字导诊：

1. 小程序请求只依赖平台会话，不再发送旧 `legacyLoginCode`。
2. API 组合根在 Redis 会话状态和 HIS 预约目录端口同时就绪时优先选择原生 TS 导诊服务。
3. 导诊服务使用 owner-scoped Redis 会话状态和 TTL，不保存微信 code、JWT、患者资料或 Provider 原文。
4. `packages/ai-runtime` 提供可替换的 `IntelligentGuideModelGateway`；当前 MVP 使用受控规则模型跑通首轮追问、第二轮推荐和未命中追问。配置 `AI_RUNTIME_READY=true`、回环地址和长度足够的令牌后，API 会注入 `PythonLocalAiModelGateway`，把实际文本推理交给受控 Python `/chat` Runtime。
5. 模型返回的候选科室必须重新匹配实时 HIS 目录，客户端不能提交或伪造科室 ID。
6. 语音入口已接入独立的 `IntelligentGuideSpeechGateway`；配置 Python Runtime 后只调用其 `/speech/transcribe`，转写文本仍回到 TS 导诊主链路，未配置时保持 fail-closed。

## 目标架构

```text
小程序
  -> apps/api 认证与导诊编排
       -> packages/domain 领域端口
       -> packages/ai-runtime 模型 / ASR / RAG Runtime
       -> packages/persistence Redis 会话、文档索引和状态
       -> packages/adapters HIS 目录、报告和患者数据
```

业务模块不能直接访问 GGUF、文件系统、Redis 或 Provider。所有外部能力都通过 domain port 注入，Runtime 只返回经过边界校验的结构化结果。Python 只承担模型/ASR 执行，不拥有平台用户鉴权、HIS 科室目录、患者数据、Redis 会话或公开 HTTP 路由；Runtime 必须是回环地址，异常或超时统一 fail-closed。

## MVP 启动方式

平台 API 默认使用 TS 规则模型，不会自动启动 Python。需要启用本地 GGUF/Whisper 时，由部署人员在旧仓库的独立 Python 环境启动 `local_ai` sidecar，再给平台 API 配置以下变量；令牌只放在服务端环境，不提交到仓库：

```dotenv
AI_RUNTIME_READY=true
AI_RUNTIME_URL=http://127.0.0.1:8101
AI_RUNTIME_TOKEN=<与 LOCAL_AI_TOKEN 相同的随机令牌>
AI_RUNTIME_TIMEOUT_MS=120000
```

旧仓库的启动命令保持单 worker，例如：

```bash
cd /path/to/hospital
python -m local_ai --env-file env/.env.ai --port 8101
```

平台 API 还必须同时具备原生导诊所需的 Redis 会话状态和已验收的实时 HIS 预约目录配置。启动日志中的 `aiRuntimeConfiguration=配置完整` 只表示本地端口和令牌齐全；需要另外用 `/health`、真实模型推理和 ASR 音频验收确认 Runtime 可用。

## 后续实施顺序

### 阶段 1：真实文本模型

- 把旧 GGUF 加载、上下文长度、最大输出、单模型串行调度迁入受控 Python Runtime，并继续通过 `packages/ai-runtime` 的 TypeScript gateway 接入；
- 固定模型文件版本、聊天模板、GPU/CPU 配置和启动自检；
- 将导诊规则替换为结构化 JSON 输出，继续经过模型输出校验和 HIS 科室解析；
- 验收：首轮必须追问、科室只能来自实时目录、超时/并发/模型异常均 fail-closed。

### 阶段 2：ASR 与导诊语音

- 已完成 TS 音频边界、Python Whisper gateway 和文字链路复用；
- 将旧 Runtime 的音频解码、时长限制和 CTranslate2 Whisper 自检纳入 sidecar 部署验收；
- 转写结果复用文字导诊链路，不复制一套科室推荐逻辑；
- 验收：空音频、损坏音频、超长音频、无语音和 ASR 超时均有稳定错误码。

### 阶段 3：知识库与智能客服

- 已完成受控 `KnowledgeSearchGateway` 和 Python `/search` 适配器；仅返回审核文档分块，客服路由仍由独立部署闸门控制；
- 已完成客服专用 `IntelligentCustomerModelGateway` 和 Python `task=customer` 适配器；客服回复只允许空跳转或 `ai_guide`，与导诊的科室推荐 schema 分离；
- 迁移文档抽取、原文留存、SHA-256、可见性、重试和原子重建；
- MVP 先使用关键词检索，随后再加入固定版本的 embedding 与混合召回；
- 客服生成必须携带受控知识来源，缺少依据时明确回答无法确认；
- 管理操作与患者查询分离，文档写入、停用、删除和重建需要独立权限。

### 阶段 4：报告解读

- 复用现有 TS 报告目录/详情适配器，先做患者所有权和报告类型校验；
- 迁移 LIS、PACS、体检三类报告的结构整理规则；
- 把结构化报告送入同一模型端口，限制输出为解释性内容，不能生成诊断或改变原始报告；
- 先提供同步 MVP，再按任务状态补充流式/异步能力。

### 阶段 5：收口与切换

- 为模型、ASR、知识库和报告分别增加配置闸门、readiness、运行状态和资源上限；
- 完成小程序 DevTools `dist` 来源核对、API 合同测试、模型替身测试和真实 HIS/模型环境验收；
- 迁移完成前不删除旧仓库资产；平台代码不再对旧 Python 做隐式回退；
- 只有全部业务验收完成后，才移除旧 AI 依赖和旧入口配置。

## 当前未完成项

当前“已完成”只表示原生 TS 文字导诊 MVP 和其边界测试通过，不表示真实 GGUF、ASR、知识库、客服或报告解读已经完成，也不表示真实患者/HIS 生产验收已经完成。

## 2026-09-16 执行检查点

本轮已完成：

- 新增 `KnowledgeSearchGateway` 领域端口和 Python `POST /search` 兼容适配器；适配器只接受旧 Runtime 返回的审核文档分块，并将 snake_case 映射为平台 camelCase，限制结果数量、文档标识、正文长度、分块序号和分数范围；异常响应统一 fail-closed。
- 检索端口已接入客服的可选路由；默认部署闸门关闭时仍只作为内部迁移能力，不改变当前固定 H5 客服入口。知识只在本轮请求中注入模型，不写入客服会话。
- 客服模型适配器已完成 `task=customer`、审核资料 `<knowledge>` 临时注入和 `redirect` 白名单校验；公网路由只有在独立闸门和组合根依赖同时满足时才注册。
- 客服文本应用服务已完成：会话使用独立的 owner-scoped Redis key，业务层先查资料再调用模型，最多向模型提供 4 个分块；生产组合根只有在客服 service、Redis/知识检索/模型依赖都具备时才会构造它。
- 客服音频已复用导诊 ASR gateway：音频仍先经过 2 MiB/格式/最小字节数边界和转写结果校验，再进入客服的同一套检索、模型和 owner 会话流程；文本/音频 HTTP 路由已挂入组合根，但 `INTELLIGENT_CUSTOMER_ENABLED` 默认 false，因此默认不会暴露。
- 客服已补齐稳定错误码 `60420/60430/60440`、小程序文案镜像、按认证用户的固定窗口限流（默认 10 次/60 秒）和审计元数据 contract；审计事件只保留 trace、owner-scoped 会话引用、渠道、轮次、资料命中数和输入长度，不记录问答原文、音频或知识正文。
- 相关验证通过：API 客服模块/错误处理/组合根定向回归 65 pass；`@hospital/ai-runtime` 11 pass；客服 Redis 状态 2 pass；配置 13 pass；小程序既有验收集合 435 pass；API、Worker、Domain、Persistence、Contracts 类型检查通过。

真实 Runtime 仍有明确环境阻塞，不能标记为已验收：

- `/Users/yxswy/Documents/GitHub/hospital/venv/bin/python` 为 Python 3.9，而旧 `local_ai` 当前代码使用 Python 3.10+ 的 `|` 类型语法；执行 `python -m local_ai --env-file env/.env.ai.example --check` 在启动自检前即因 `TypeError` 退出。
- 本机未发现可供旧 Runtime 使用的 GGUF 或 Whisper 模型文件；旧虚拟环境也缺少 `llama_cpp`、`faster_whisper` 和 `av`。因此目前只验证了 TS gateway 的请求/响应边界和规则模型，未验证真实模型推理、真实 ASR 或真实知识索引召回。

下一步按阶段 3 继续：准备 Python 3.10+ 环境、原生依赖和已核验的 GGUF/Whisper/知识索引资产，完成真实 Runtime 的模型、ASR 和检索验收；随后再做外部 H5/原生入口选择和患者端灰度。打开 `INTELLIGENT_CUSTOMER_ENABLED` 前必须完成这些依赖的真实验收。
