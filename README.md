# agent-browser-kit

基于 `adryfish/fingerprint-chromium` 的 `agent-browser` 多账号指纹隔离与内核管理插件。

## Background

使用原版 `agent-browser` 执行多账号自动化任务时，默认共享本地浏览器环境且缺少持久化硬件指纹隔离。`agent-browser-kit` 通过 `agent-browser.plugin.v1` 标准输入输出协议接入，为每个 `--session <account>` 维护独立的账号目录与 32 位持久化 `fingerprint`，并统一托管指纹内核的下载与升级。

## Install

前置条件：本机已安装 [Bun](https://bun.sh/) 与 [agent-browser](https://github.com/vercel-labs/agent-browser)。

1. 在 `~/.agent-browser/config.json` 中注册 `kit` 插件并设为默认提供方（通过 `bunx` 拉起）：

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

2. 下载并初始化指纹内核（安装时会自动记录当前系统对应的 `kernel.platform`）：

   ```sh
   agent-browser plugin run kit kernel.install
   ```

## Usage

查看插件支持的全部命令、参数及仓库地址：

```sh
agent-browser plugin run kit help
```

### 多账号浏览与临时会话

- **临时会话**：未提前创建档案直接传入 `--session <name>` 时，浏览器数据放在系统临时目录并随机生成本次 `--fingerprint`，`close` 后自动删除临时目录。
- **持久账号**：先通过 `profile.create` 创建档案后再用 `--session <account>` 启动，配置集中保存在 `~/.local/share/agent-browser-kit/config.json` 的 `profiles` 下，浏览器数据目录 `~/.local/share/agent-browser-kit/profiles/<account>/` 会长期保留；未指定 `windowSize` 时默认使用 `1920,1080`（无头模式下自动同步 `--screen-info={宽x高}`）。

```sh
agent-browser --session account-01 --input-mode human --headed open "https://example.com"
agent-browser --session account-01 tab new "https://example.com/settings"
agent-browser --session account-01 close
```

### 账号档案与全局配置

在 `~/.local/share/agent-browser-kit/config.json` 中可由用户按需自行添加全局 `defaults`，运行时按 **`CLI > 账号配置 > 全局配置 > Kit 默认 > 上游 1:1`** 顺序合并参数；任意 `--*` 开关传 `null` 即表示删除该参数：

```sh
agent-browser plugin run kit profile.create --payload '{
  "account": "account-02",
  "proxy": "http://127.0.0.1:7890",
  "timezone": "America/New_York",
  "lang": "en-US",
  "acceptLang": "en-US,en",
  "windowSize": "1440,900",
  "--disable-sync": null
}'

agent-browser plugin run kit profile.list
agent-browser plugin run kit profile.delete --payload '{"account":"account-02"}'
```

### 内核管理

- `kernel.install`：仅在本地未安装有效内核时下载并激活，同时记录 `kernel.platform`；已存在时直接跳过。
- `kernel.upgrade`：本地未安装时下载安装；已安装且上游存在新版本时自动拉取并切换激活版本。
- `kernel.status`：查看当前激活的内核版本、平台与路径。

```sh
agent-browser plugin run kit kernel.status
agent-browser plugin run kit kernel.upgrade
```

### 人工接管

遇到强人机校验时，启动 `agent-browser` 监控面板手动完成验证，认证状态会直接持久化至对应账号目录：

```sh
agent-browser dashboard start
```

## Contributing

请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

MIT
