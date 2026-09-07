# Zhumora Studio — 架构设计

本地 LLM 工作室（类 Ollama / LM Studio）：Electron + React 桌面应用，对 llama.cpp `llama-server` 的可视化封装。
用户选择要加载的 GGUF 模型，通过表单可视化设置 llama-server 启动参数，应用负责进程生命周期、健康检查、日志与 OpenAI 兼容 API 代理。

参考工程：`D:\mini-agent`（同技术栈、同分层规范、同设计系统）。

---

## 1. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 框架 | electron-vite + Electron ≥43 | 与 mini-agent 一致，main/preload/renderer 三端一体 |
| UI | React 19 + TS 5.9，**无 CSS 框架** | 移植 mini-agent 的 CSS 变量设计令牌（`--app-color-*`、light/dark） |
| 状态 | zustand（slice 化） | 与 mini-agent 一致 |
| 持久化 | better-sqlite3（models / chats / sessions）+ 单行 JSON settings（`schemaVersion` 迁移） | 沿用 mini-agent 模式 |
| LLM 后端 | llama.cpp **首启自动下载**：GitHub API 拉最新 release → GPU/CPU 探测选 `bin-win` 构建 → 流式下载 + 校验 + 解压；设置里可覆盖为自定义可执行路径（离线逃生舱） | 不捆绑、包体小；GPU 用户自动拿到正确构建 |
| 模型源 | 本地目录导入（v1）+ HuggingFace 流式下载（M3） | 下载带断点续传与进度事件 |
| 打包 | electron-builder nsis，`signExecutable: false` | 同 mini-agent |

Node ≥22（原生 fetch，直接打本地 HTTP，无需 axios）。

## 2. 目录结构

```
zhumora-studio/
├── ARCHITECTURE.md
├── package.json / electron.vite.config.ts / tsconfig*.json
└── src/
    ├── shared/                     # 跨进程契约 + 纯函数（不依赖 Electron/DB）
    │   ├── types.ts                # ModelInfo / ServerConfig / ServerState / ChatMsg / 事件载荷
    │   ├── launchParams.ts         # ★ 启动参数 schema 注册表（驱动 UI 表单 + 参数构建）
    │   ├── buildArgs.ts            # 纯函数: LaunchParams → CLI args[]（可单测）
    │   └── ipc.ts                  # 通道名常量 + 请求/响应载荷类型
    ├── main/
    │   ├── index.ts                # 入口：窗口创建、生命周期
    │   ├── composition.ts          # ★ 唯一组合根：构造并接线下列服务
    │   ├── settings/               # JSON settings 读写 + normalizeSettings + 迁移
    │   ├── store/                  # sqlite：migrations.ts（单调版本）+ repositories
    │   │   ├── db.ts
    │   │   ├── migrations.ts
    │   │   ├── modelsRepo.ts       # 模型元数据（路径/大小/arch/quant/来源/备注）
    │   │   └── chatRepo.ts         # 会话与消息
    │   ├── server/                 # llama-server 生命周期适配器
    │   │   ├── ServerManager.ts    # 状态机 + 编排（start/stop/restart）
    │   │   ├── process.ts          # spawn / 优雅退出（SIGTERM→超时→taskkill）
    │   │   ├── health.ts           # GET /health 轮询（ready 判定）
    │   │   └── logs.ts             # stdout/stderr 环形缓冲（最近 N 行）+ 事件广播
    │   ├── models/
    │   │   ├── scanner.ts          # 扫描 models 目录 *.gguf，解析文件元数据
    │   │   └── gguf.ts             # GGUF 文件头解析（arch/quant/block_size，纯函数）
    │   ├── runtime/                # llama.cpp 运行时获取
    │   │   ├── RuntimeManager.ts   # 状态机: check → detect → download → extract → ready
    │   │   ├── github.ts           # GitHub releases/latest API：asset 列表、sha256
    │   │   └── detect.ts           # GPU 探测（Win32_VideoController + nvidia-smi）→ 变体决策
    │   ├── download/
    │   │   └── Downloader.ts       # 通用流式下载：断点续传、取消、进度（runtime 与模型共用）
    │   ├── chat/
    │   │   └── ChatProxy.ts        # 调 localhost /v1/chat/completions SSE，逐 token 事件转发
    │   └── ipc/
    │       └── handlers.ts         # 只做：输入校验 → 调用例 → 持久化/事件适配
    ├── preload/
    │   └── index.ts                # 最小强类型 API：window.zhumora.{models,server,chat,settings,events}
    └── renderer/
        ├── index.html
        └── src/
            ├── main.tsx / App.tsx  # 框架：TitleBar + Sidebar + 视图路由
            ├── index.css           # 从 mini-agent 移植设计令牌 + 组件样式
            ├── store/              # zustand slices: server / models / chat / settings-draft / ui
            ├── ipcBridge.ts        # IPC 事件 → reducer（可测试，不堆进 App.tsx）
            ├── views/
            │   ├── ModelsView.tsx      # 模型库：列表、导入、下载、删除
            │   ├── PlayGroundView.tsx  # 聊天：模型选择、流式渲染、usage/tokens/s
            │   ├── ServerView.tsx      # ★ 服务面板：状态卡 + 启动参数表单 + 日志
            │   └── SettingsView.tsx    # 模型目录、自定义二进制、主题、字体
            └── components/
                ├── TitleBar.tsx / Sidebar.tsx
                ├── ParamForm.tsx       # ★ 由 launchParams.ts schema 动态生成表单
                ├── ModelCard.tsx
                ├── ServerStatusCard.tsx
                ├── LogView.tsx
                └── ChatPanel.tsx
```

依赖方向（同 mini-agent 规范）：`shared ← main/renderer 均可用；ipc 不实现业务；composition.ts 是唯一组合根`。

## 3. 核心设计

### 3.1 llama-server 生命周期状态机

```
stopped ──start(config)──▶ starting ──/health OK──▶ ready
   ▲                        │ 超时/进程退出              │ stop()
   └────────────────────────┴── error ◀────────────────┴──▶ stopping
   （ready 下修改参数 = restart：stop 后按新参数 start，保留会话）
```

- `ServerManager` 是唯一可变状态 owner；状态变化经 `server:state` 事件广播。
- 启动流程：spawn（`windowsHide: true`，cwd=模型目录）→ 轮询 `/health`（2s 间隔，60s 超时）→ 拉 `/v1/models` 确认模型名 → `ready`。
- 不做端口预检：端口就是 `--port` 参数（默认 1234，不自增）。占用时 llama-server 自己绑定失败退出，走统一的"进程退出 → error + 日志尾部"路径，UI 展示失败原因即可。
- 退出：`app.on('before-quit')` 触发优雅停止（SIGTERM，3s 超时后强杀）；进程意外退出 → `error` 并附最后 20 行日志。
- **v1 约束：同一时刻只运行一个 server 实例**（llama-server 一进程一模型）。切模型 = 用新参数 restart。多实例留作 M4 扩展（`profiles`）。

### 3.2 启动参数可视化（核心卖点）

参数定义只写一次，**表单渲染和 CLI 构建都由它驱动**，杜绝两处维护：

```ts
// shared/launchParams.ts（节选）
type ParamSpec = {
  key: string                 // 'nGpuLayers'
  flag: string                // '-ngl'
  label: string               // 'GPU 层数'
  category: 'service' | 'model' | 'performance' | 'sampling'
  type: 'number' | 'select' | 'boolean' | 'string' | 'textarea'
  secret?: boolean            // 表单打码、日志脱敏
  default: number | string | boolean
  options?: { value: string; label: string }[]   // select 用
  min?: number; max?: number; step?: number
  advanced?: boolean          // 折叠进“高级”
  hint?: string
  requiresRestart: true       // v1 全部需要重启
}

export const LAUNCH_PARAMS: ParamSpec[] = [
  // service
  { key: 'host',   flag: '--host',  label: '监听地址', category: 'service', type: 'string', default: '127.0.0.1' },
  { key: 'port',   flag: '--port',  label: '端口',     category: 'service', type: 'number', default: 1234, min: 1, max: 65535 },  // 固定策略：占用则报错让用户改，不自增
  { key: 'apiKey', flag: '--api-key', label: 'API Keys', category: 'service', type: 'string', default: '', secret: true,
    hint: '逗号分隔多个 key；留空 = 无鉴权（本机直连）' },
  // parallel(-np) 与 ctx(-c) 联动逻辑复杂（auto = 4 slots + kv_unified），不进表单，extraArgs 透传
  { key: 'contBatching', flag: '--cont-batching', label: '连续批处理', category: 'service', type: 'boolean', default: true, advanced: true },
  // model
  { key: 'modelPath', flag: '-m', label: '模型文件', category: 'model', type: 'string' },        // 特判：从模型库选择
  { key: 'jinja', flag: '--jinja', label: 'Jinja 模板', category: 'model', type: 'boolean', default: true },
  // 注意（b10835 源码核实）：
  // - 没有 --system 启动参数（-sys 只注册给 CLI/completion；server 的 system 走 /v1/chat/completions
  //   请求里的 messages 或 Anthropic 的 "system" 字段）。system prompt 由聊天页的会话设置注入，
  //   ChatProxy 发送时在消息序列最前面补 role=system，不经过 LaunchParams。
  // - 没有 --ctx-size 之外的 -c 冲突问题：新版 server 的 -c 语义变化（与 -np 联动，见 server.cpp:167），
  //   默认 -c 0 = 用模型训练上下文；-np 默认 -1 = auto(4 slots + kv_unified)。这两项不进表单，
  //   需要时用 extraArgs 透传。
  { key: 'ctxSize', flag: '-c', label: '上下文长度', category: 'model', type: 'number', default: 0, min: 0, step: 512, advanced: true,
    hint: '0 = 使用模型训练的上下文长度' },
  { key: 'chatTemplate', flag: '--chat-template', label: 'Chat Template', category: 'model', type: 'string', advanced: true },
  // performance
  { key: 'nGpuLayers', flag: '-ngl', label: 'GPU 层数', category: 'performance', type: 'number', default: 0, min: 0, max: 999 },
  { key: 'threads', flag: '-t', label: '线程数', category: 'performance', type: 'number', default: 8, min: 1 },
  { key: 'splitMode', flag: '-sm', label: 'GPU 分配', category: 'performance', type: 'select', default: 'layer',
    options: [{value:'none',label:'不拆分'},{value:'layer',label:'按层'},{value:'row',label:'按行'}], advanced: true },
  { key: 'flashAttention', flag: '-fa', label: 'Flash Attention', category: 'performance', type: 'boolean', default: false, advanced: true },
  { key: 'cacheK', flag: '-ctk', label: 'K Cache 类型', category: 'performance', type: 'select', default: 'f16',
    options: [{value:'f16',label:'f16'},{value:'q8_0',label:'q8_0'},{value:'q4_0',label:'q4_0'}], advanced: true },
  { key: 'mlock', flag: '--mlock', label: '锁定内存', category: 'performance', type: 'boolean', default: false, advanced: true },
  { key: 'noMmap', flag: '--no-mmap', label: '禁用 mmap', category: 'performance', type: 'boolean', default: false, advanced: true },
  // sampling（作为 server 级默认值；请求级可在聊天高级选项中覆盖）
  // 默认值 = b10835 common_params 真实默认（common.h 核实）
  { key: 'temp', flag: '--temp', label: 'Temperature', category: 'sampling', type: 'number', default: 0.8, min: 0, max: 2, step: 0.1 },
  { key: 'topK', flag: '--top-k', label: 'Top-k', category: 'sampling', type: 'number', default: 40, min: -1, advanced: true },
  { key: 'topP', flag: '--top-p', label: 'Top-p', category: 'sampling', type: 'number', default: 0.95, min: 0, max: 1, step: 0.05, advanced: true },
  { key: 'minP', flag: '--min-p', label: 'Min-p', category: 'sampling', type: 'number', default: 0.05, min: 0, max: 1, step: 0.05, advanced: true },
  { key: 'repeatPenalty', flag: '--repeat-penalty', label: '重复惩罚', category: 'sampling', type: 'number', default: 1.0, min: 0, max: 2, step: 0.05, advanced: true, hint: '1.0 = 禁用' },
  { key: 'seed', flag: '--seed', label: '随机种子', category: 'sampling', type: 'number', default: -1, advanced: true, hint: '-1 = 随机' },
]
```

- `buildArgs(LaunchParams) → string[]` 纯函数：按 type 序列化（boolean 默认 true 输出 flag，false 省略；string 空值省略），可单测覆盖。
- 敏感参数：`secret: true` 的参数在日志、事件、UI 展示处统一脱敏（`***`），settings 里明文存储（本机应用，与 mini-agent 一致）。
- 表单 `ParamForm` 按 category 分组渲染：service / model 常显，performance / sampling 折叠为“高级”。
- “原始参数”逃生舱：`extraArgs` 文本框，原样追加到 args 末尾（供 schema 未覆盖的 flag）。
- 参数变更语义比较：与 mini-agent 一致，key 顺序不触发 restart；仅有效 args 变化才提示“需重启生效”。

### 3.3 运行时获取（llama.cpp 自动下载）

应用不捆绑二进制。`RuntimeManager` 首启时为本机拉取正确的构建。

**流程**：

```
check（本地 runtime 目录有无 manifest？）
  ├─ 有且版本 = settings.runtime 固定版本 → 验证二进制 --version → ready
  └─ 无 → GET https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=8
          ★ 注意：/releases/latest 返回的是 stable（v0.4.0，只有 nightly-tag.txt 占位 asset，无二进制）；
            bin-win 构建全在 nightly prerelease 里。取列表中第一个 prerelease 且 tag 匹配 /^b\d+$/ 的 release。
          → 过滤 assets：/^llama-b(\d+)-bin-win-((?:cpu|cuda|vulkan|sycl|rocm|openvino|opencl)-[\w.]+)-(\w+)\.zip$/
          → GPU 探测 → pickVariant 推荐
          → UI 展示“检测到 NVIDIA RTX 4060（驱动 551.86），推荐 cuda-12.4”，下拉可改
          → Downloader 流式下载（Range 续传 + sha256 校验）
          → yauzl 解压到 runtime 目录 → 写 manifest → ready
```

**存放**：`%APPDATA%/zhumora-studio/llama/<tag>-<variant>/`（如 `b10835-cuda-12.4`），目录内 `manifest.json` 记 `{ version, variant, sha256, binary: 'build/bin/llama-server.exe', installedAt }`。多版本共存，切换 = settings 换目录，无需重下。

**GPU 探测**（`detect.ts`；wmic 已在 Win11 24H2 移除，用 PowerShell）：

1. 架构：`PROCESSOR_ARCHITECTURE`（x64 / arm64）
2. 适配器：`powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"`
3. NVIDIA 时追加：`nvidia-smi --query-gpu=name,driver_version --format=csv,noheader` 取驱动版本

**决策表**（纯函数 `pickVariant(probe, assets)`，可单测；assets 里选同族最高版本）：

| 探测结果 | 推荐变体 |
|---|---|
| NVIDIA，驱动 ≥ 580 | `cuda-13.x`（取最高） |
| NVIDIA，驱动 ≥ 528 | `cuda-12.4` |
| NVIDIA 但 nvidia-smi 不可用 | `cuda-12.4`（保守），UI 提示可手动选 vulkan |
| AMD | `vulkan` |
| Intel | `vulkan` |
| 无独显 / Basic display / 探测失败 | `cpu` |

驱动版本阈值是 `detect.ts` 里的常量表，后续版本要求变化只改一处。**自动探测只是推荐**：UI 下拉列出 API 返回的全部 bin-win assets，手动选择写回 settings 作为本机默认。

**下载细节**：

- GitHub release asset（objects.githubusercontent.com）支持 `Range`，与模型下载共用一套续传/取消/进度逻辑
- API `assets[].digest`（sha256）存在则校验，失败删 `.part` 重下
- cuda 包 ~250MB：进度事件带 `phase: 'downloading' | 'extracting'`
- 下载中退出应用：保留 `.part`，下次启动自动续传
- 完全离线：报错说明 + “手动指定路径”逃生舱（settings.llamaBinary）

### 3.4 模型管理

- **目录**：默认 `%APPDATA%/zhumora-studio/models`，可在设置中更换（更换后重新扫描）。
- **扫描**：遍历 `*.gguf`，读文件头解析 `general.architecture`、`general.name`、量化（`*.weight_data` 后缀）与文件大小；结果写入 sqlite `models` 表（path 为主键）。
- **导入**：文件对话框选择后**复制**进 models 目录（避免外部移动导致失联）。
- **下载（M3）**：HF repo 直链流式下载 → `.part` 临时文件 → 完成后改名入库；支持断点续传（`Range`）、取消、进度事件 `download:progress`。
- **删除**：只删 models 目录内的文件；若正被加载，先停 server 或拒绝。

### 3.5 聊天（PlayGround）

- 直接调 `http://host:port/v1/chat/completions`（`stream: true`），main 进程 `ChatProxy` 解析 SSE 转发 `chat:token / chat:usage / chat:end / chat:error`。
- 消息持久化 sqlite `chats`（会话、消息、所属模型），renderer 缓存只是投影（同 mini-agent 权威源原则）。
- 每条 assistant 消息展示 `usage`（prompt/completion tokens）与 tokens/s（end 事件计算）。
- 请求级覆盖项（max_tokens、temperature 等）在聊天输入框的“高级”里设置，优先于 server 默认值。

### 3.5 IPC 契约（节选，载荷全部来自 shared/types）

```
invoke:
  models:list()                        → ModelInfo[]
  models:import(paths: string[])       → ModelInfo[]
  models:remove(id: string)            → void
  server:getState()                    → ServerState
  server:start(params: LaunchParams)   → void      // 校验在 handlers 内用 schema 完成
  server:stop()                        → void
  server:getLogs()                     → string[]  // 最近 N 行
  server:defaultParams()               → LaunchParams  // schema defaults
  chat:sessions() / chat:send(sessionId, msgs, overrides) / chat:abort()
  settings:get() / settings:save(patch)
  system:pickModelFile() / system:pickDirectory()

  runtime:getStatus()                     → RuntimeStatus   // { state, version?, variant?, detected?, recommendedVariant? }
  runtime:fetchAssets()                   → ReleaseAsset[]  // 最新 release 的 bin-win assets（供下拉）
  runtime:download(variant: string)       → void
  runtime:cancelDownload()                → void

events (main → renderer, 均带自增 seq):
  server:state      { state, port?, error?, logTail? }
  server:log        { line, stream }
  download:progress { id, done, total, speed }
  download:done / download:error

  runtime:state       { state, version?, variant?, error? }
  runtime:progress    { done, total, speed, phase }
  chat:token        { sessionId, messageId, delta }
  chat:usage        { sessionId, messageId, usage, tokensPerSec }
  chat:end          { sessionId, messageId, finishReason }
  chat:error        { sessionId, code, message }
```

preload 只暴露上表的类型化方法 + `on(channel, cb) → unsubscribe`；**不暴露通用 ipcRenderer**。

## 4. Settings 结构（单行 JSON + schemaVersion）

```jsonc
{
  "schemaVersion": 1,
  "modelsDir": "%APPDATA%/zhumora-studio/models",
  "llamaBinary": "",              // 空 = 用已下载的 runtime；填路径则优先（离线逃生舱）
  "runtime": {
    "version": "b10835",          // 固定版本；空 = 用探测到的最新
    "variant": "cuda-12.4",       // 空 = 每次启动按 GPU 探测推荐
    "autoUpdate": false           // 启动时检查新版 release（M4）
  },
  "lastParams": { /* 上次启动参数，重启恢复 */ },
  "autoStartLast": false,
  "theme": "system",              // light | dark | system
  "fontSize": 15
}
```

## 5. 打包与分发（Windows v1）

- 应用包**不捆绑** llama.cpp（运行时下载，见 3.3），包体小；新增依赖 `yauzl`（流式解压 250MB 级 zip）。
- 首次启动自检：runtime manifest 缺失 → 进入下载流程；二进制在但 `--version` 失败 → 报错并给“手动指定路径”。
- 应用退出前必须停掉 server 进程，避免孤儿进程占端口；runtime 下载中断保留 `.part`，下次续传。

## 6. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M0 脚手架 | electron-vite 工程、设计令牌移植、TitleBar/Sidebar/四视图骨架、settings 持久化 | 空壳可运行、明暗主题 |
| M1 核心 | 运行时获取（GitHub API + GPU 探测 + 下载/校验/解压）、模型扫描/导入、参数 schema + ParamForm、ServerManager 状态机、日志面板、优雅退出 | 首启自动下载正确构建 → 选模型 → 可视化配置 → 启动/停止/重启闭环 |
| M2 聊天 | ChatProxy SSE、PlayGround、usage/tokens-s、会话持久化 | 流式对话可用，断连有错误提示 |
| M3 下载 | HF 流式下载 + 断点续传 + 进度 UI | 断网续传、取消 |
| M4 增强 | 多 server profile、runtime 更新检查（autoUpdate）、API 端点复制/文档页、macOS/Linux（asset 命名不同平台，流程复用） | — |

## 7. 待确认（开工前）

1. 是否需要“外部应用接入”说明页（展示 OpenAI 兼容 endpoint + API key，方便别的工具连本机）？
