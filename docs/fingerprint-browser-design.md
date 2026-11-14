# 基于 fingerprint-chromium 与 agent-browser 的多账号隔离设计

## 1. 目标与边界

- **调用极简**：业务侧通过 `agent-browser --session <account>` 指定会话名，经全局配置自动路由至 `kit` 插件完成环境拉起。
- **持久与临时分离**：通过 `profile.create` 预建的账号配置集中保存在 `~/.local/share/agent-browser-kit/config.json` 的 `profiles` 字段（含随机有符号 32 位正整数 `fingerprint`），浏览器持久数据目录位于 `~/.local/share/agent-browser-kit/profiles/<account>`；未建档的 `--session` 使用 `mkdtempSync` 创建系统临时目录并在 `close` 后彻底销毁。
- **拟人化与接管**：通过 `--input-mode human` 启用人类指针轨迹，并在触发强校验时通过 `Dashboard` 接入人工验证。
- **进程边界**：单账号对应单个浏览器进程；同账号并发任务通过同一进程内多标签页执行。

## 2. 系统架构

### 2.1 组件关系

```mermaid
flowchart LR
    CLI["agent-browser"] --> Config["~/.agent-browser/config.json"]
    CLI -->|"provider = kit"| Plugin["agent-browser-kit 插件"]
    CLI --> Dashboard["Dashboard"]
    Plugin -->|"command.run"| Profiles["~/.local/share/agent-browser-kit/profiles"]
    Plugin -->|"未建档 --session"| Ephemeral["系统临时目录 mkdtempSync"]
    Plugin -->|"kernel.install / upgrade"| Kernels["~/.local/share/agent-browser-kit/kernels"]
    Plugin -->|"browser.launch / close"| Kernel["adryfish/fingerprint-chromium"]
    Kernel -->|"CDP"| CLI
    Kernel <-->|"持久状态"| Profiles
    Kernel <-->|"临时状态"| Ephemeral
```

- **`agent-browser`**：读取全局配置，路由会话生命周期，提供多标签调度、`human` 输入轨迹与 `Dashboard`。
- **`agent-browser-kit`**：托管账号档案、临时会话目录、内核下载升级、三层参数组装、僵尸锁清理及进程回收。
- **`adryfish/fingerprint-chromium`**：执行页面渲染、指纹伪装、状态落盘与 `CDP` 协议服务。

### 2.2 生命周期时序

```mermaid
sequenceDiagram
    participant Caller as 调用方
    participant CLI as agent-browser
    participant Plugin as agent-browser-kit
    participant Store as 档案或临时目录
    participant Chrome as 指纹内核

    Caller->>CLI: --session <account> --input-mode human --headed open <url>
    CLI->>Plugin: browser.launch (provider=kit, session=<account>, launchOptions)
    Plugin->>Store: 命中 profiles/<account> 或 mkdtempSync 创建临时目录
    Plugin->>Plugin: 校验活跃进程、清理僵尸锁、按 CLI > Kit > 上游合并参数
    Plugin->>Chrome: 启动内核并注入目录、fingerprint 与覆盖参数
    Chrome-->>Plugin: 写入 DevToolsActivePort 并就绪
    Plugin-->>CLI: 返回 cdpUrl 与 cleanup
    CLI->>Chrome: 建立 CDP 会话并激活 human 输入模式
    Caller->>CLI: --session <account> close
    CLI->>Plugin: browser.close (cleanup)
    Plugin->>Chrome: 终止内核进程（临时会话同时销毁目录）
```

## 3. 核心设计

### 3.1 全局配置与插件协议

在 `~/.agent-browser/config.json` 中注册 `kit` 插件（使用 `bunx` 启动）并设为默认提供方：

```json
{
  "$schema": "https://agent-browser.dev/schema.json",
  "provider": "kit",
  "plugins": [
    {
      "name": "kit",
      "command": "bunx",
      "args": ["@taitide/agent-browser-kit"],
      "capabilities": ["browser.provider", "command.run"]
    }
  ]
}
```

`agent-browser` 通过标准输入输出以 `agent-browser.plugin.v1` 协议与 `agent-browser-kit` 交互：

1. **`plugin.manifest`**：声明插件名称 `kit` 与能力 `["browser.provider", "command.run"]`。
2. **`browser.launch`**：等待 `DevToolsActivePort` 就绪后，落盘运行时状态，并返回 `browser.cdpUrl` 与 `browser.cleanup`。
3. **`browser.close`**：按 `cleanup` 终止对应内核进程；持久档案仅清锁保留数据，临时会话连同 `mkdtempSync` 目录一并移除。
4. **`command.run` 管理接口**：
   - `help`：返回全部命令清单、参数说明与示例（支持传 `command` 查询单条命令）。
   - `kernel.install`：若已安装有效内核则直接跳过；未安装时按内置清单下载并激活。
   - `kernel.upgrade`：未安装时下载安装；已安装且云端存在更高版本时下载升级并替换激活路径。
   - `kernel.status`：查询当前激活内核版本与路径。
   - `profile.create` / `profile.list` / `profile.delete`：管理账号档案与覆盖配置。

### 3.2 单一配置文件与指纹生成

- **目录约定**：数据与配置均位于 `~/.local/share/agent-browser-kit/`，单一配置文件为 `config.json`（项目不主动生成全局默认项，由用户按需填写 `defaults`）：
  - `config.json`：统一存放 `kernel`（含版本、可执行路径与安装时记录的 `platform`）、用户可选全局 `defaults` 以及账号 `profiles`。
  - `kernels/<version>/`：按版本存放已下载的内核文件。
  - `profiles/<account>/`：仅存放该账号的 Chromium 运行态与浏览数据目录（无额外 `fp.json`）。
- **账号元数据**：
  - `fingerprint`：有符号 32 位正整数（`1` 至 `2147483647`，避免上游 `002-user-agent-fingerprint.patch` 使用 `base::StringToInt` 解析时发生 `INT_MAX` 溢出截断）；`profile.create` 未传 `seed` 时由密码学安全随机数生成器（CSPRNG）生成，持久化后跨重启复用。
  - 可选覆盖字段：`proxy`、`timezone`、`lang`、`acceptLang`、`windowSize` 及任意 `--*` Chromium 开关。

### 3.3 内核拉起与五段参数合并

- **内核来源**：`kernel.install` 默认读取项目根目录 `kernel-manifest.json`（构建时内联打包进 `dist/cli.js`）按平台下载并记录 `kernel.platform`（`darwin -> macos`、`linux-x64 -> linux`），`kernel.upgrade` 直接查询 `adryfish/fingerprint-chromium` GitHub Releases 最新版本（仓库定时动作自动同步该清单）。
- **五段覆盖合并（`CLI > 账号配置 > 全局配置 > Kit 默认 > 上游 1:1`）**：
  1. **上游层（`src/browser/upstream-args.ts`）**：1:1 镜像 `agent-browser` 默认 Chromium 启动参数（含调试端口、防弹窗/后台干扰开关、钥匙串静默、无头模式及容器环境 `--no-sandbox`）。
  2. **Kit 层（`src/browser/args.ts`）**：注入 `--user-data-dir`、`--fingerprint`、`--fingerprint-brand=Chrome`、`kernel.platform` 对应的 `--fingerprint-platform` 与默认 `--window-size=1920,1080`；无头模式下若上层未显式接管 `--screen-info`，自动由最终生效的 `--window-size` 派生 `--screen-info={宽x高}`。
  3. **全局配置层（`config.json -> defaults`）**：仅由用户自行填写，覆盖 Kit 默认参数。
  4. **账号配置层（`config.json -> profiles.<account>`）**：账号维度配置与任意 `--*` 开关，覆盖全局配置。
  5. **CLI 层（`launchOptions`）**：应用命令行透传的 `userAgent`、`proxy`、`windowSize`、`--*` 及 `args`。
- **显式 `null` 删除语义**：在上层配置或命令透传中对任意 `--*` 开关传 `null` 时，直接从最终启动参数列表剔除该开关，不再回退下层默认值。

### 3.4 进程防重入与锁恢复

- **活跃复用**：若目标会话记录的进程仍在运行且 `cdpUrl` 端口可达，`browser.launch` 直接返回当前活跃连接。
- **僵尸锁清理**：拉起持久档案前检查 `SingletonLock` 与 `runtime.json`；若记录的进程已退出，清理僵尸锁后再启动内核。
