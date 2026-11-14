# agent-browser-kit

基于 [adryfish/fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium) 的 [agent-browser](https://github.com/vercel-labs/agent-browser) 多账号指纹隔离与内核管理插件。

## Background

直接使用原生 `agent-browser` 运行多账号任务时，不同会话默认共享同一浏览器环境，容易产生状态串号与环境特征关联。`agent-browser-kit` 为每个会话分配独立的用户数据目录与持久化硬件指纹，并统一托管指纹内核的安装与升级。

## Install

前置条件：本机已安装 [Bun](https://bun.sh/) 与 [agent-browser](https://github.com/vercel-labs/agent-browser)。

1. 在 `~/.agent-browser/config.json` 中启用 `kit` 插件并设为默认提供方：

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

2. 下载并初始化指纹内核：

   ```sh
   agent-browser plugin run kit kernel.install
   ```

## Usage

### 临时会话

直接传入未建档的 `--session <name>` 即可启动隔离会话，浏览数据与随机指纹仅在本次会话期间有效，执行 `close` 后自动清理：

```sh
agent-browser --session temp-01 open "https://example.com"
agent-browser --session temp-01 close
```

### 持久账号

通过 `profile.create` 创建账号档案后，同一 `--session <account>` 会在多次启动间保留登录态、缓存与固定指纹：

```sh
agent-browser plugin run kit profile.create --payload '{
  "account": "account-01",
  "proxy": "http://127.0.0.1:7890",
  "timezone": "America/New_York",
  "lang": "en-US",
  "acceptLang": "en-US,en",
  "windowSize": "1440,900"
}'

agent-browser --session account-01 --input-mode human --headed open "https://example.com"
agent-browser --session account-01 tab new "https://example.com/settings"
agent-browser --session account-01 close
```

### 人工接管

遇到强人机校验时，可启动监控面板手动完成验证，登录与验证状态会保留在对应账号目录中：

```sh
agent-browser dashboard start
```

### 检测与验证

常见浏览器指纹、自动化特征与网络泄漏测试网站请参阅 [detection-sites.md](docs/detection-sites.md)。

## API

所有管理命令通过 `agent-browser plugin run kit <command>` 调用，完整参数与示例可通过 `help` 查看：

| 命令 | 说明 |
| :--- | :--- |
| `help` | 查看全部命令清单、参数说明与示例 |
| `kernel.install` | 下载并激活指纹内核（已安装时跳过） |
| `kernel.upgrade` | 检查并升级至最新指纹内核 |
| `kernel.status` | 查看当前激活的内核版本与路径 |
| `profile.create` | 创建或更新账号档案 |
| `profile.list` | 列出已创建的账号档案 |
| `profile.delete` | 删除指定账号档案及数据目录 |

配置说明：

- 账号配置与全局默认配置统一保存在 `~/.local/share/agent-browser-kit/config.json`，如需为所有账号设置公共参数，可在其中添加 `defaults` 字段。
- 任意 Chromium 开关参数传 `null`（例如 `"--disable-sync": null`）即可移除该默认参数。
- 无头模式的屏幕工作区与 `devicePixelRatio` 调优请参阅 [headless-screen.md](docs/headless-screen.md)。

## Contributing

请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[Apache-2.0](LICENSE) © 2026 taitide-labs
