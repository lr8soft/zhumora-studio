# Zhumora Studio — 架构设计

本地 LLM 工作室（类 Ollama / LM Studio）：Electron + React 桌面应用，对 llama.cpp `llama-server` 的可视化封装。
用户选择 GGUF 模型，通过表单可视化设置启动参数，应用负责进程生命周期、健康检查、日志、OpenAI 兼容 API 反向代理、密钥管理与用量统计。

参考工程：`D:\mini-agent`（同技术栈、同分层规范、同设计系统）。

---

## 1. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 框架 | electron-vite + Electron ≥43 | 与 mini-agent 一致，main/preload/renderer 三端一体 |
| UI | React 19 + TS 5.9，**无 CSS 框架** | 移植 mini-agent 的 CSS 变量设计令牌（`--app-color-*`、light/dark） |
| 状态 | zustand（单 store + slice 接口） | 与 mini-agent 一致 |
| 国际化 | i18next + react-i18next，6 语言（en/zh/ja/es/fr/de）+ auto | auto = 按系统语言检测，fallback en |
| 持久化 | better-sqlite3（models / sessions / messages / api_keys / usage_requests）+ 单行 JSON settings（`schemaVersion` 归一化） | sqlite 迁移单调版本；settings 边界统一 `normalizeSettings` |
| LLM 后端 | llama.cpp **运行时页手动下载**：GitHub API 拉最新 nightly → GPU 探测推荐变体 → 流式下载 + sha256 + 解压；设置里可覆盖为自定义二进制（离线逃生舱） | 不捆绑、包体小；GPU 用户自动拿到正确构建 |
| 模型源 | 本地目录导入 + HuggingFace 搜索/流式下载（断点续传、多任务并发） | 下载带 `.part` 续传与进度事件 |
| HTTP | Node ≥22 原生 fetch | 直接打本地/远端 HTTP，无 axios |
| 打包 | electron-builder：win nsis（x64/arm64）、mac dmg（x64/arm64）、linux AppImage+deb（x64/arm64）；win `signExecutable: false` | 三平台目标见 §7.2-E |

## 2. 目录结构

```
zhumora-studio/
├── README.md（中文默认） / README.en.md
├── ARCHITECTURE.md / DEVELOPMENT.md
├── imgs/                         # 宣传截图（README 展示用）
├── package.json / electron.vite.config.ts / tsconfig*.json
├── tests/                        # node --test，纯函数单测（buildArgs / pickVariant）
└── src/
    ├── shared/                     # 跨进程契约 + 纯函数（禁止依赖 Electron / Node API）
    │   ├── types.ts                # 全部共享类型（ParamSpec / ServerState / 事件载荷 / Settings）
    │   ├── launchParams.ts         # ★ 启动参数 schema 注册表（驱动 UI 表单 + 参数构建）
    │   ├── buildArgs.ts            # 纯函数: defaultParams / buildArgs / paramsEqual / sanitizeParams
    │   ├── ipc.ts                  # 通道名常量（Ipc / IpcEvent）+ 请求/响应载荷类型（ZhumoraApi）
    │   ├── keygen.ts               # 随机 API key（纯函数，main/renderer 共用）
    │   └── hfutil.ts               # HuggingFace 工具（mmproj 判定等，纯函数）
    ├── main/
    │   ├── index.ts                # 入口：单实例锁、窗口创建、before-quit 优雅停止
    │   ├── composition.ts          # ★ 唯一组合根：构造并接线全部服务
    │   ├── settings/store.ts       # JSON settings 读写 + normalizeSettings（schemaVersion 迁移）
    │   ├── store/                  # sqlite：migrations.ts（单调版本 v1→v4）+ repositories
    │   │   ├── db.ts / migrations.ts
    │   │   ├── modelsRepo.ts       # 模型元数据（path 唯一、kind: model|mmproj）
    │   │   ├── chatRepo.ts         # 会话与消息（usage 列已停用，见 v4 迁移）
    │   │   ├── keysRepo.ts         # API 密钥表
    │   │   ├── usageRepo.ts        # 用量聚合（以 usage_requests 为源）
    │   │   └── requestLogRepo.ts   # 调用记录写入/查询
    │   ├── server/
    │   │   ├── ServerManager.ts    # ★ 状态机 + spawn + 健康检查 + 日志环形缓冲
    │   │   ├── proxy.ts            # ★ 反向代理：对外端口监听 + 请求捕获（用量统计源）
    │   │   └── status.ts           # 运行状态快照：进程 CPU/内存 + 系统 CPU/内存 + GPU（跨平台，见 §7.2）
    │   ├── runtime/
    │   │   ├── RuntimeManager.ts   # 状态机: check → detect → download → extract → ready
    │   │   ├── github.ts           # GitHub releases API：nightly 选取 + bin-win asset 解析 + cudart 伴生包
    │   │   └── detect.ts           # ★ GPU 探测（跨平台）→ pickVariant 纯函数决策
    │   ├── models/
    │   │   ├── scanner.ts          # 扫描 models 目录 *.gguf 入库
    │   │   ├── gguf.ts             # GGUF 文件头解析（只读前 512KB，纯 Node fs）
    │   │   ├── huggingface.ts      # HF API：搜索 / 仓库详情 / 头像 / 直链
    │   │   └── downloader.ts       # 模型下载任务管理（多任务并发，按 repoId::file 去重）
    │   ├── download/Downloader.ts  # 通用流式下载：Range 断点续传、sha256、取消（runtime 与模型共用）
    │   ├── chat/ChatProxy.ts       # 调 /v1/chat/completions SSE，逐 token 事件，结束持久化
    │   └── ipc/handlers.ts         # 只做：输入校验 → 调服务 → 事件适配（含 bootSequence）
    ├── preload/
    │   └── index.ts                # contextBridge 暴露 window.zhumora（ZhumoraApi，不暴露通用 ipcRenderer）
    └── renderer/
        └── src/
            ├── main.tsx / App.tsx  # 框架：TitleBar + Sidebar + 8 视图路由；主题/字号应用
            ├── index.css           # 设计令牌 + 组件样式
            ├── store/index.ts      # zustand 单 store（server/models/chat/keys/settings slice）+ subscribeMainEvents
            ├── i18n/               # i18next 初始化 + 6 语言包（en/zh/ja/es/fr/de）
            ├── views/
            │   ├── RuntimeView.tsx   # 运行时：探测结果、变体选择、下载进度
            │   ├── ModelsView.tsx    # 模型库：本地列表 + HF 搜索/下载
            │   ├── ServerView.tsx    # ★ 服务面板：状态卡 + 启动参数表单 + 日志
            │   ├── StatusView.tsx    # 运行状态：进程/系统 CPU、内存、GPU（2s 轮询）
            │   ├── ChatView.tsx      # 聊天：会话、流式渲染、usage/tokens-s
            │   ├── KeysView.tsx      # 密钥管理：增删 + 随机生成
            │   ├── UsageView.tsx     # 用量统计：总览/按天/按模型/按 key/调用记录
            │   └── SettingsView.tsx  # 模型目录、自定义二进制、主题、语言
            └── components/
                ├── TitleBar.tsx / Sidebar.tsx
                └── ParamForm.tsx     # ★ 由 launchParams.ts schema 动态生成表单
```

依赖方向：`shared ← main/renderer 均可用；ipc handlers 不实现业务；composition.ts 是唯一组合根`。

## 3. 核心设计

### 3.1 llama-server 生命周期状态机 + 反向代理

```
stopped ──start(params)──▶ starting ──/health OK──▶ ready
    ▲                        │ 超时(120s)/进程退出     │ stop()
    └────────────────────────┴── error ◀──────────────┴──▶ stopping
    （ready 下修改参数 = restart：stop 后按新参数 start）
```

**进程拓扑（关键设计）**：llama-server 不直接监听用户配置的端口。

```
外部应用 / 本应用 ──▶ proxy（host:port，用户参数）──▶ llama-server（127.0.0.1:<随机内部端口>）
```

- `ServerManager.start()` 把 buildArgs 生成的 `--host/--port` **覆盖**为 `127.0.0.1:<findFreePort()>`；对外端口由 `proxy.ts`（纯 Node `http` 反向代理）监听。
- 代理捕获每个请求：`ip + bearer key + 端点 + status + 模型 + prompt/completion tokens + 耗时` → `usage_requests` 表（用量统计的唯一数据源，因此**外部应用直连也算进统计**）。
- 健康检查（`GET /health`，1s 间隔、120s 超时）带内部标记头 `x-zhumora-internal`，代理见标记不记入调用记录。
- SSE 响应按 chunk 直通转发（不阻塞客户端），同时旁路解析 `data:` 行取 model/usage；非流式响应边转发边累积（封顶 8MB）解析 JSON。客户端中断 → 销毁上游连接并记一条。
- 端口被占用 = proxy `listen` 失败 → 清理已 spawn 进程，报错"无法监听端口 N（被占用？）"。不自增端口（与产品决策一致：让用户改参数）。
- 退出：`proc.kill('SIGTERM')` → 3s 宽限 → `SIGKILL`；`before-quit` 时若 server 在 running 状态先 `stop()` 再 dispose，避免孤儿进程占端口。
- **v1 约束：同一时刻只运行一个 server 实例**。切模型 = 用新参数 restart。多实例留作扩展（profiles）。

### 3.2 启动参数可视化（核心卖点）

参数定义只写一次（`shared/launchParams.ts`），**表单渲染和 CLI 构建都由它驱动**：

```ts
type ParamSpec = {
  key: string; flag: string; label: string
  category: 'service' | 'model' | 'performance' | 'sampling'
  type: 'number' | 'select' | 'boolean' | 'string' | 'textarea'
  default: number | string | boolean
  options?: { value: string; label: string }[]
  min?; max?; step?
  advanced?     // 折叠进"高级"
  secret?       // 表单打码、展示脱敏（***）
  hidden?       // 不进表单（仍参与 buildArgs），如 apiKey 由"密钥"页注入
  fullWidth?    // 独占整行（长路径）
  mono?         // 等宽字体
  hint?
}
```

- `buildArgs(LaunchParams) → string[]` 纯函数：boolean true 输出 flag、false 省略；number 非有限省略；string 空白省略；`extraArgs` 按空白分词追加末尾（不支持引号转义）。
- **flag 为空的 spec 不参与启动命令**（纯 UI 参数）；schema 未覆盖的 flag 用 `extraArgs` 透传。
- `paramsEqual` = 比较 buildArgs 结果 → key 顺序变化不触发"需重启生效"。
- 输入收敛：`handlers.validateParams` 按 schema 逐 key 校验类型/选项，未知 key 丢弃（select 值必须在 options 内）。
- 默认值均按 llama.cpp 源码核实（common/common.h、common/arg.cpp），如 temp 0.8 / top_k 40 / top_p 0.95 / n_ctx 0(模型训练值)。
- **模板相关（源码核实）**：server 无 `--system` 启动参数（system prompt 走请求 messages）；外部模板用 `--chat-template-file <.jinja>`（文件）或 `--chat-template <string>`（内联）；`--jinja` 是引擎开关。注意**没有** `--jinja-template` 这个 flag。
- b10936 起 `--mlock/--no-mmap` 移除 → 统一 `--load-mode`（settings 有 v1→v2 参数迁移）。

### 3.3 运行状态监控（status.ts，跨平台实现见 §7.2-A）

`collectServerStatus(state)` 一次性返回：

- **server 进程**：CPU %（两次采样 CPU 时间差值）+ 工作集/RSS（MB）+ uptime
- **系统**：总 CPU %（`os.cpus()` 两次采样，异常兜底 `/proc/stat`）+ 物理内存总量/已用（`os.totalmem/freemem`）
- **GPU**：NVIDIA 走 `nvidia-smi --query-gpu ... --format=csv`；非 NVIDIA 且 Linux 时兜底 `rocm-smi --showmeminfo vram --showuse --csv`；Apple Silicon 暂无稳定 CLI，留空
- 全部探测失败不抛，字段留空；StatusView 每 2s 轮询 `server:status`

### 3.4 运行时获取（llama.cpp 下载）

```
check（runtime 目录有无 manifest？有且二进制在 → ready）
  └─ 无 → probeGpu() 探测 → GitHub releases?per_page=10
         ★ /releases/latest 指向 stable（无二进制），必须遍历取第一个 prerelease 且 tag 匹配 /^b\d+$/
         → 解析 bin-win assets（正则允许变体段连字符：cuda-12.4 / opencl-adreno）
         → pickVariant(probe, assets) 推荐 → UI 展示探测结果 + 下拉可改
         → Downloader 流式下载（Range 续传 + sha256）
         → yauzl 流式解压（zip slip 防护、跳过 __MACOSX/.DS_Store）
         → cuda 变体追加 cudart 伴生包（缺了 ggml-cuda.dll 加载失败）
         → 二进制 --version 验证（失败 = DLL 缺失/架构不符/损坏）
         → 写 manifest.json → ready
```

- **存放**：`<userData>/llama/<version>-<variant>/`，`manifest.json` 记 `{ version, variant, sha256, binary, installedAt }`。多版本共存；`check()` 取 installedAt 最新的。
- **二进制解析**：settings.llamaBinary（手动指定）优先，否则 runtime manifest。
- **pickVariant 决策表**（纯函数，可单测；assets 里选同族最高版本）：

| 探测结果 | 推荐变体 |
|---|---|
| NVIDIA，驱动 ≥ 580 | `cuda-13.x`（取最高） |
| NVIDIA，驱动 ≥ 528 | `cuda-12.4` |
| NVIDIA 但驱动未知 | `cuda`（保守），UI 可手改 |
| AMD / Intel | `vulkan` |
| 无独显 / 探测失败 | `cpu` |

- 下载中断保留 `.part`，下次续传；`RESUME_WITH_HASH`（续传分块无法校验 hash）删 `.part` 重下。
- 完全离线：报错说明 + settings.llamaBinary 手动指定逃生舱。

### 3.5 模型管理

- **目录**：默认 `<userData>/models`，设置可更换（更换后重新扫描）。
- **扫描**：遍历 `*.gguf`，`parseGgufHeader` 只读前 512KB 解析 `general.architecture` / `general.name`，量化从文件名推断（`Q4_K_M` 等后缀）；`kind` 区分 model / mmproj（视觉投影文件）；path 唯一键 upsert。
- **导入**：文件对话框选择后**复制**进 models 目录（避免外部移动导致失联）。
- **HF 下载**：搜索（best/likes/updated）→ 仓库详情（gguf 文件列表 + 元数据 + README 预览）→ resolve 直链接流式下载；多任务并发，按 `repoId::file` 去重；完成后触发重新扫描入库。

### 3.6 聊天（Chat）

- `ChatProxy` 调 `http://host:port/v1/chat/completions`（`stream: true` + `stream_options.include_usage` —— llama.cpp server 默认不随流返回 usage，必须显式开）。
- 逐 token 事件 `chat:token` → renderer `streaming` 切片渲染；结束 → assistant 消息持久化 sqlite（含 usage、tokens/s、modelId）→ `chat:end` → renderer 重拉该会话消息与 DB 校准（权威源原则：sqlite 为准，renderer 只是投影）。
- 中止/出错时已生成的部分内容落盘保留。
- 请求级覆盖（temperature/top_p/top_k/max_tokens）在聊天高级项设置，优先于 server 默认值。
- ChatProxy 调用本地 server 时携带密钥页的 key（`syncProxyKey`：启动/增删密钥后注入）。

### 3.7 密钥与用量统计

- **密钥**：`api_keys` 表（key 唯一），随机生成 `sk-zs-…`（128bit 熵，去易混淆字符）。server 启动时把全部活跃 key 逗号分隔注入 `--api-key`（llama.cpp 任一可用）。
- **调用记录**：§3.1 的反向代理捕获全部请求 → `usage_requests`（ip/key/端点/status/模型/tokens/耗时）。这是用量统计唯一数据源，因此本应用聊天与外部应用直连统一口径。
- **聚合**：总览 / 按天（默认 14 天）/ 按模型 / 按 key（key 空 = 本地/未鉴权）；v4 迁移把旧 messages 的 token 列回填为 `ip='local'` 记录。

### 3.8 IPC 契约

invoke 通道（`shared/ipc.ts` 的 `Ipc`，载荷类型 `ZhumoraApi`）：

```
models:  list / import / remove / search / detail / avatar / download / cancel-download
server:  state / start / stop / logs / status
runtime: status / assets / download / cancel
chat:    send / abort / sessions / create-session / delete-session / messages / save-message
keys:    list / add / remove / generate
usage:   summary / daily / by-model / by-key / requests / reset
settings:get / save
system:  pick-model / pick-directory / pick-binary / open-path
window:  minimize / maximize / close
```

事件（main → renderer，`IpcEvent`，载荷映射 `IpcEventPayloads`）：

```
ev:server-state / ev:server-log / ev:runtime
ev:chat-token / ev:chat-end / ev:chat-error
ev:model-progress / ev:model-done / ev:model-error
```

preload 只暴露上表的类型化方法 + `on(channel, cb) → unsubscribe`；**不暴露通用 ipcRenderer**。renderer 侧 `subscribeMainEvents()` 统一把事件归并进 store。

## 4. Settings（单行 JSON + 归一化）

```jsonc
{
  "schemaVersion": 1,
  "modelsDir": "<userData>/models",
  "llamaBinary": "",              // 空 = 用已下载的 runtime；填路径则优先（离线逃生舱）
  "runtime": { "version": "", "variant": "", "autoUpdate": false },
  "lastParams": { /* 上次启动参数，重启恢复（含参数级迁移，如 mlock/noMmap → loadMode） */ },
  "theme": "system",              // light | dark | system
  "fontSize": 15,                 // 13–18
  "lang": "auto"                  // auto | en | zh | ja | es | fr | de
}
```

- 唯一入口 `normalizeSettings(raw)`：缺省补全 + 类型收敛 + 参数迁移，读/写都过它（边界归一化）。
- sqlite 独立迁移链（v1 models/sessions/messages → v2 kind → v3 api_keys+model_id → v4 usage_requests+回填），单调版本，事务执行。

## 5. 打包与分发

- 应用包**不捆绑** llama.cpp（运行时下载，见 §3.4），包体小；`yauzl` 入包（流式解压），`better-sqlite3` asarUnpack。
- 三平台打包：`build:win`（nsis，x64 + arm64 全量；可拆 `build:win:x64` / `build:win:arm64`）、`build:mac`（dmg，x64/arm64）、`build:linux`（AppImage + deb，x64/arm64），产物输出 `release/`。
- 首次启动自检：runtime manifest 缺失 → 进入下载流程；二进制在但 `--version` 失败 → 报错并给"手动指定路径"。

## 6. 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 脚手架 | electron-vite 工程、设计令牌移植、TitleBar/Sidebar、settings 持久化 | ✅ |
| M1 核心 | 运行时获取（GitHub + GPU 探测 + 下载/校验/解压）、模型扫描/导入、参数 schema + ParamForm、ServerManager 状态机、反向代理、日志面板、优雅退出 | ✅ |
| M2 聊天 | ChatProxy SSE、ChatView、usage/tokens-s、会话持久化、密钥管理、用量统计 | ✅ |
| M3 下载 | HF 搜索 + 流式下载 + 断点续传 + 进度 UI + 多任务并发 | ✅ |
| M4 增强 | 三平台运行时获取（Linux/macOS asset 流程）、多 server profile、runtime autoUpdate | ⬜ 见 §7.2-D（三平台打包目标已配置） |

## 7. 开发规范

### 7.1 分层与依赖

- `shared/` 禁止 import Electron / Node 内建模块（fs、path、os、child_process）；它是 main 与 renderer 的公共契约，必须保持纯。
- `ipc/handlers.ts` 只做输入校验 + 调用服务 + 事件适配，不写业务逻辑；业务在对应服务类里。
- 新增服务：在 `composition.ts` 构造并挂进 `AppContext`，handlers 只消费 ctx。
- 纯函数（buildArgs / pickVariant / keygen / gguf 解析 / 参数迁移）必须可单测，放 `tests/`（`node --test`）。
- sqlite 加表/加列 = 新迁移版本号，事务内执行 + `pragma_table_info` 探测，不假设旧库结构。
- 新增 UI 文案必须进全部 6 个语言包（en 为结构基准，zh/ja/es/fr/de 缺一不可），禁止把技术说明原文写进界面。

### 7.2 三平台兼容（强制）

**目标平台：Windows（x64/arm64）、Linux（x64/arm64）、macOS（x64/arm64）。任何 main 进程代码不得假设单平台。**

**A. 系统信息读取——必须平台分支，禁止裸调单平台工具**

| 需求 | 规范实现 |
|---|---|
| 进程 CPU/内存 | Windows：PowerShell `Get-Process` 两次采样 CPU 时间差；Linux：`/proc/<pid>/stat`（utime+stime 差值，USER_HZ=100）+ `/proc/<pid>/statm` RSS；macOS：`ps -o %cpu,rss` |
| 系统 CPU 负载 | 首选 `os.cpus()` 两次采样（三平台通用）；异常时 Linux 兜底 `/proc/stat` |
| 系统内存 | `os.totalmem()` / `os.freemem()`（三平台通用） |
| 显卡列表 | Windows：`Get-CimInstance Win32_VideoController`（wmic 已在 Win11 24H2 移除，禁用）；Linux：`lspci` 过滤 VGA/3D/Display；macOS：`system_profiler SPDisplaysDataType` |
| GPU 实时状态 | NVIDIA：`nvidia-smi --query-gpu ... --format=csv`（Win/Linux 通用）；AMD：Linux `rocm-smi --csv`；Apple Silicon：无稳定 CLI，字段留空 |

规则：
1. 每个探测函数按 `process.platform` 分支，**所有分支都必须存在**（win32/linux/darwin），缺分支 = 代码审查不过。
2. 外部命令一律 `promisify(execFile)` + `timeout`，**失败必须降级**（返回 null / 空数组），绝不抛穿到 IPC 层。
3. PowerShell 单行 `-Command` 多语句必须用 `;` 分隔（空格分隔会被当参数）；能用 Node API 解决的不用 shell。
4. 优先纯 Node（`os`、`fs`、`net`）；必须调系统命令时，命令存在性不确定（lspci/rocm-smi 可能没装）要 catch 后继续。
5. 解析 `/proc/<pid>/stat` 注意 comm（字段 2）含空格：从最后一个 `)` 后切分。

**B. 路径与文件**

- 一律 `path.join` / `path.dirname`，禁止手拼 `/` 或 `\`。
- 用户数据根用 `app.getPath('userData')`（Win `%APPDATA%`、Linux `~/.config`、macOS `~/Library/Application Support`），禁止硬编码。
- 二进制名/扩展名平台相关（`llama-server.exe` vs `llama-server`），不得写死 `.exe`；spawn 选项 `windowsHide: true` 全平台可传（非 Windows 忽略）。
- 换行按 `\r?\n` 解析（三平台输出均可能出现 CRLF）。

**C. 进程控制**

- 优雅停止：`SIGTERM` → 宽限 3s → `SIGKILL`（Node `child.kill` 三平台同义，Windows 上 SIGTERM 即终止）。
- 不做端口预检，靠 listen 失败走统一错误路径。

**D. llama.cpp 运行时获取（已三平台）**

`github.ts` 按平台解析 asset：bin 段映射 win→`win` / linux→`ubuntu` / macos→`macos`（`assetRe(platform)`）；`RuntimeManager` 按扩展名分派解压（`.zip`→yauzl，`.tar.gz`→系统 `tar`），二进制名 `llama-server.exe` / `llama-server`。

| 平台 | llama.cpp 发布形态 | 差异 |
|---|---|---|
| Windows | `llama-bNNNN-bin-win-<variant>-<arch>.zip` | cuda 需 cudart 伴生包（文件名不带 build 号） |
| Linux | `llama-bNNNN-bin-ubuntu[-<variant>]-<arch>.tar.gz`（发行版段是 ubuntu；无变体段=cpu；变体含 vulkan/rocm/openvino/sycl，**无官方 CUDA 构建**） | 系统 `tar` 解压；NVIDIA 走自定义二进制或 vulkan 兜底 |
| macOS | `llama-bNNNN-bin-macos-<arch>.tar.gz`（无 GPU 变体段，Metal 内置） | 解析为 variant=cpu；Apple Silicon 走 Metal |

规范：
1. asset 正则、解压、二进制名三处按平台分发（`github.ts` 的 `BIN_SEG`/`EXT` 映射 + `RuntimeManager` 的 `binaryName()` 与扩展名分派），不让平台判断散落。
2. 探测（detect.ts）与变体决策（pickVariant）跨平台。
3. 下载/续传/校验（Downloader.ts）平台无关。

**E. 打包与发布**

- electron-builder 三平台目标已配置（`package.json` build 段 + `build:win` / `build:win:x64` / `build:win:arm64` / `build:mac` / `build:linux` 脚本）：win nsis、mac dmg（x64+arm64）、linux AppImage + deb（x64+arm64）。`better-sqlite3` 是原生模块，三平台各自重建（electron-builder 默认行为，CI 按平台跑）。
- Linux 无代码签名；macOS 需 notarization（发布阶段处理）。

**F. 验证要求**

- 改动 main 进程系统交互后，`npx tsc --noEmit` + `npm test` + `npx electron-vite build` 必须全绿。
- 平台相关改动：能在目标平台跑就真机验证；不能跑时至少走读所有 `process.platform` 分支。

### 7.3 已知 Windows-only 残留（已清除）

三平台化已完成：`runtime/github.ts` 按平台解析 asset（bin 段 win/ubuntu/macos）、`runtime/RuntimeManager.ts` 二进制名按平台 + zip / tar.gz 分派解压、`ipc/handlers.ts` 的 `system:pick-binary` filter 已按平台区分（win 才给 `.exe`）。

`status.ts`、`detect.ts` 按 §7.2-A 实现三平台分支，作为其余模块的参照实现。

## 8. 待确认

1. 多 server profile（M4）：profiles 存 settings 还是 sqlite？
2. runtime autoUpdate 检查频率与 UI 提示形态。
3. 外部应用接入说明页（展示 endpoint + key 复制，方便别的工具连本机）。
