# Zhumora Studio — 开发规范

架构总览见 `ARCHITECTURE.md`。本文件是开发约定，**§2 三平台兼容为强制规范**：任何 PR 违反即打回。

---

## 1. 基础约定

### 1.1 常用命令

```
npm run dev        # electron-vite dev（开发）
npm test           # node --test tests/*.test.ts（纯函数单测）
npx tsc --noEmit   # 类型检查
npm run build      # electron-vite build
npm run build:win  # win 打包（nsis，x64 + arm64）
npm run build:mac  # mac 打包（dmg，x64 + arm64）
npm run build:linux  # linux 打包（AppImage + deb，x64 + arm64）
```

提交前必过：`tsc --noEmit` + `npm test` + `npm run build`。

### 1.2 分层与依赖（强制）

```
shared ← main、renderer 均可 import
main  ← 唯一可碰 Node/Electron 业务逻辑的地方
renderer ← 只通过 window.zhumora（preload 白名单）访问 main
```

- **`shared/` 禁止 import Electron / Node 内建模块**（fs、path、os、child_process…）。它是跨进程契约，保持纯 TS。
- **`ipc/handlers.ts` 不写业务**：只做输入校验（按 schema 收敛）→ 调服务 → 事件适配。业务在 ServerManager / ChatProxy / RuntimeManager 等服务类里。
- **`composition.ts` 是唯一组合根**：新服务在这里构造并挂进 `AppContext`；handlers 只消费 ctx，不自己 new 依赖。
- 纯函数（buildArgs / pickVariant / keygen / gguf 解析 / normalizeSettings 迁移）必须可单测，测试放 `tests/`。
- renderer 状态：sqlite 是权威源，store 只是投影；main 持久化后通过事件让 renderer 重拉校准，不在 renderer 侧猜测。

### 1.3 数据变更

- sqlite 加表/加列 = **新迁移版本号**（`store/migrations.ts`，单调递增），事务内执行，`pragma_table_info` 探测旧库结构，不假设。
- settings 变更走 `normalizeSettings`（边界归一化的唯一入口）：新增字段补默认值，旧数据做迁移。
- 删除/破坏性操作：只允许删 models 目录内的文件、只允许操作自家 runtime 目录。

### 1.4 UI 与文案（强制）

- 新增任何用户可见文案 → **6 个语言包同步**（en 为结构基准：zh/ja/es/fr/de 缺一不可），key 缺失 = 构建评审不过。
- 界面文案必须产品化：写用户看得懂的话，不写需求描述和技术说明。
  - 反例：`"哪个 IP + 哪个 key 在什么时候调用"`、`"CPU / 其他后端不显示实时占用"`
  - 正例：`"调用记录"`、`"仅 NVIDIA 显卡显示实时占用"`
- 错误提示要可操作：给出下一步（如"请在运行时页下载构建，或在设置中手动指定 llama-server 路径"）。
- 样式用 `index.css` 的设计令牌（`--app-color-*`），不引入 CSS 框架。

### 1.5 llama.cpp 参数相关（强制）

- 启动参数**只允许**通过 `shared/launchParams.ts` 的 schema 定义；禁止在别处硬拼 CLI 参数。
- 新增/修改 flag 前必须**查 llama.cpp 源码或官方文档核实**（flag 是否存在、默认值、语义变化，如 b10936 移除 `--mlock`）。凭记忆写 flag 视为缺陷（本项目已因此返工过：`--jinja-template` 不存在，正确是 `--chat-template-file`）。
- 默认值注明出处（源码文件/行号或文档链接），写在 schema 注释里。
- 改 schema 必须同步 `tests/buildArgs.test.ts`（默认值全 key 覆盖 + 序列化用例）。

---

## 2. 三平台兼容规范（强制）

**目标平台：Windows（x64 / arm64）、Linux（x64 / arm64）、macOS（x64 / arm64）。**
main 进程代码**不得假设单平台**。参照实现：`main/server/status.ts`、`main/runtime/detect.ts`（已按本规范实现三平台分支）。

### 2.1 系统信息读取

| 需求 | 规范实现（按 platform 分支） |
|---|---|
| 进程 CPU / 内存 | **win32**：PowerShell `Get-Process` 两次采样（CPU 时间差 ÷ 间隔 × 100），内存取 WorkingSet64。**linux**：`/proc/<pid>/stat` 两次采样（utime+stime 差值，USER_HZ=100），RSS 读 `/proc/<pid>/statm`（页 × 4KB）。**darwin**：`ps -o %cpu,rss -p <pid>` |
| 系统 CPU 负载 | 首选 `os.cpus()` 两次采样（三平台通用）；异常时 linux 兜底 `/proc/stat` |
| 系统内存 | `os.totalmem()` / `os.freemem()`（三平台通用，不读系统命令） |
| 显卡列表 | **win32**：`Get-CimInstance Win32_VideoController`（**wmic 已禁用**，Win11 24H2 已移除）。**linux**：`lspci` 过滤 `VGA|3D|Display controller`。**darwin**：`system_profiler SPDisplaysDataType` 取 `Chipset Model:` 行 |
| GPU 实时状态 | NVIDIA：`nvidia-smi --query-gpu ... --format=csv`（win/linux 通用）。AMD：linux `rocm-smi --showmeminfo vram --showuse --csv`。Apple Silicon：无稳定 CLI，字段留空（UI 标注"不可用"，不报错） |

**规则：**

1. 每个系统探测函数必须有 **win32 / linux / darwin 三个分支**，缺分支 = 不过。
2. 外部命令一律 `promisify(execFile)` + `timeout`（探测类 ≤8s）；**失败必须降级**（null / 空数组），绝不抛穿到 IPC handler。
3. 能用 Node 内建（os/fs/net）解决的不用 shell；命令存在性不确定（lspci、rocm-smi、nvidia-smi 都可能没装）时 catch 后继续。
4. PowerShell 单行 `-Command` 多语句**必须用 `;` 分隔**（空格会被当参数）；优先 `-NoProfile`。
5. 解析 `/proc/<pid>/stat` 注意 comm（字段 2）可能含空格：从最后一个 `)` 后切分再取字段。
6. CSV 解析（nvidia-smi / rocm-smi）按**表头名定位列**，不写死列序；`[N/A]` 要处理。

### 2.2 路径与文件

- 一律 `path.join` / `path.dirname` / `path.basename`，**禁止手拼** `/` 或 `\`。
- 用户数据根目录一律 `app.getPath('userData')`（Win `%APPDATA%`、Linux `~/.config/…`、macOS `~/Library/Application Support/…`），禁止硬编码盘符或家目录。
- 平台相关的文件名/扩展名（`llama-server.exe` vs `llama-server`）收敛到**一个平台策略模块**，不散落判断。
- 文本解析按 `\r?\n` 断行（三平台子进程输出均可能出现 CRLF）。
- 写文件目录先 `mkdirSync(dir, { recursive: true })`。

### 2.3 进程控制

- spawn 用绝对路径 + 参数数组（不拼 shell 字符串）；`windowsHide: true` 全平台可传（非 Windows 忽略）。
- 优雅停止：`SIGTERM` → 宽限 3s → `SIGKILL`（Node `child.kill` 三平台同义）。
- 端口不做预检，靠 `listen` 失败走统一错误路径（占用 → 提示用户改端口）。

### 2.4 llama.cpp 运行时获取（已三平台）

`github.ts` 按平台解析 asset（`assetRe(platform)`，bin 段映射 win→win / linux→ubuntu / macos→macos），`RuntimeManager` 按扩展名分派解压（`.zip`→yauzl，`.tar.gz`→系统 `tar`），二进制名 `llama-server.exe` / `llama-server`。

| 平台 | 发布形态 | 关键点 |
|---|---|---|
| Windows | `llama-bNNNN-bin-win-<variant>-<arch>.zip` | cuda 变体需 cudart 伴生包 `cudart-llama-bin-win-cuda-<v>-<arch>.zip`（文件名不带 build 号；缺了 ggml-cuda.dll 加载失败） |
| Linux | `llama-bNNNN-bin-ubuntu[-<variant>]-<arch>.tar.gz` | 发行版段是 ubuntu（不是 linux）；无变体段 = cpu；变体含 vulkan / rocm-10.0 / openvino / sycl-fp32 / sycl-fp16 / cpu（**官方无 Linux CUDA 构建**，NVIDIA 走自定义二进制或 vulkan 兜底） |
| macOS | `llama-bNNNN-bin-macos-<arch>.tar.gz` | 无 GPU 变体段（Metal 内置）；解析为 variant=cpu |

规范：

1. **asset 正则 / 解压 / 二进制名** 三处差异各自收敛（`github.ts` 的 `BIN_SEG`/`EXT` 映射、`RuntimeManager` 的 `binaryName()` 与 zip/tar.gz 分派），不让平台判断散落。
2. 平台无关的部分（Downloader 续传/校验、detect 探测、pickVariant 决策、manifest 结构）复用不动。
3. `/releases/latest` 指向 stable 无二进制 → 继续遍历 `releases?per_page=N` 取第一个 prerelease 且 tag 匹配 `^b\d+$`。
4. 下载中断保留 `.part` 续传；校验失败删临时文件重下。
5. asset 命名变更（如 bin 段 / 伴生包前缀）必须用真实 release 文件名回归 `assetRe` / `CUDART_RE`（见 `tests/buildArgs.test.ts`）。

### 2.5 打包与发布

- electron-builder 目标：win `nsis`（x64/arm64）+ mac `dmg`（arm64/x64）+ linux `AppImage`/`deb`（x64/arm64）。
- `better-sqlite3` 是原生模块：各平台 CI 各自构建（electron-builder 默认行为），不在一个平台交叉打。
- Linux 无签名；macOS 需 Developer ID + notarization（发布流程处理，不阻塞开发）。

### 2.6 验证要求（Definition of Done）

- [ ] `npx tsc --noEmit`、`npm test`、`npm run build` 全绿
- [ ] 新系统交互函数三平台分支齐全，失败降级不抛穿
- [ ] 新 UI 文案 6 语言包齐全且产品化
- [ ] 新 schema 参数有单测；flag 已对 llama.cpp 源码/文档核实
- [ ] 能在目标平台运行则真机验证；不能则走读全部 `process.platform` 分支并在 PR 说明

---

## 3. 已知 Windows-only 残留（已清除）

三平台化已完成：`github.ts` 按平台解析 asset（bin 段 win/ubuntu/macos）、`RuntimeManager.ts` 按扩展名分派 zip / tar.gz 解压且二进制名按平台、`handlers.ts` 的 `system:pick-binary` filter 已按平台区分（win 才给 `.exe`）。

已合规的参照实现：`main/server/status.ts`、`main/runtime/detect.ts`。
