# 无头模式屏幕与工作区配置

默认无头启动时，若上层未显式配置 `--screen-info`，`agent-browser-kit` 会根据最终 `--window-size`（默认 `1920,1080`）自动派生 `--screen-info={1920x1080}`。此时 `screen.availHeight` 等于 `screen.height`、`devicePixelRatio` 为 `1` 且窗口宽度与屏幕等宽，容易在 CreepJS 等检测页触发 `noTaskbar` 与 `hasVvpScreenRes` 异常特征。

通过显式传入 `--screen-info` 与非全屏 `windowSize`，可让无头模式的屏幕尺寸、系统栏扣除与像素比表现和桌面有头模式一致。

## 换算规则

Chromium 的 `--screen-info` 参数以**物理像素**为单位，网页 JavaScript 读取到的 CSS 逻辑像素按以下关系换算：

- `screen.width` / `screen.height` = `物理宽高 / devicePixelRatio`
- `screen.availWidth` = `(物理宽度 - workAreaLeft - workAreaRight) / devicePixelRatio`
- `screen.availHeight` = `(物理高度 - workAreaTop - workAreaBottom) / devicePixelRatio`

除 `--screen-info` 外，建议将 `windowSize` 设为小于目标屏幕 CSS 逻辑尺寸的常见桌面窗口大小（例如 `1440,860`），避免视口宽度或窗口高度恰好等于整块屏幕。

## 三平台推荐配置

`agent-browser-kit` 当前内置内核支持 macOS 与 Linux 宿主机；若配合 `--fingerprint-platform` 模拟不同桌面系统，或按不同目标显示器形态配置通用 Chromium，可对照下表选取参数：

| 平台形态 | 显示特征 | 物理分辨率与 DPR | 工作区扣除（物理像素） | CSS 逻辑结果（`screen` / `avail`） | 推荐 `--screen-info` 与 `windowSize` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **macOS** | Retina 屏 + 顶部菜单栏 + 底部 Dock | `3840x2160`，`dpr=2` | `workAreaTop=50`，`workAreaBottom=222` | `1920×1080` / `1920×944` | `windowSize: "1440,860"`<br>`{3840x2160 devicePixelRatio=2 workAreaTop=50 workAreaBottom=222}` |
| **Windows** | 标准 1080p + 底部任务栏（无顶栏） | `1920x1080`，`dpr=1` | `workAreaBottom=48` | `1920×1080` / `1920×1032` | `windowSize: "1440,860"`<br>`{1920x1080 devicePixelRatio=1 workAreaBottom=48}` |
| **Linux** | 常见 1080p 桌面 + 顶部/底部面板 | `1920x1080`，`dpr=1` | `workAreaTop=27`（或 `workAreaBottom=48`） | `1920×1080` / `1920×1053` | `windowSize: "1440,860"`<br>`{1920x1080 devicePixelRatio=1 workAreaTop=27}` |

> [!NOTE]
> `devicePixelRatio` 取小数（如 Windows 常见 `1.25` 或 `1.5` 缩放）时，同样按 `物理像素 / devicePixelRatio` 换算 CSS 逻辑宽高与工作区扣除值。

## 写入位置与测试影响

参数合并优先级为 `CLI > 账号配置 > 全局 defaults > Kit 默认`，可按使用场景二选一：

1. **写入全局 `defaults`**（作用于所有临时会话与未单独覆盖的账号）：

   在 `~/.local/share/agent-browser-kit/config.json` 中添加 `defaults`：

   ```json
   {
     "defaults": {
       "windowSize": "1440,860",
       "--screen-info": "{3840x2160 devicePixelRatio=2 workAreaTop=50 workAreaBottom=222}"
     }
   }
   ```

2. **写入指定账号档案**（仅作用于风控敏感账号，不影响通用会话默认尺寸）：

   ```sh
   agent-browser plugin run kit profile.create --payload '{
     "account": "account-01",
     "windowSize": "1440,860",
     "--screen-info": "{3840x2160 devicePixelRatio=2 workAreaTop=50 workAreaBottom=222}"
   }'
   ```

**对 UI 自动化测试的影响说明**：

- 写入全局 `defaults` 后，未单独传参的会话初始视口宽度会从 `1920` 变为 `1440`（常见 `1280px` 桌面响应式断点仍正常生效，但依赖 `1920` 超宽布局的用例会受影响）；
- 设置 `devicePixelRatio=2` 后，页面截图文件的物理像素尺寸会放大为 CSS 视口尺寸的 2 倍；
- 若单次自动化测试需要固定 `1920` 宽度或 `1x` 视口，可在会话中执行 `agent-browser set viewport 1920 1080`，或对不需要该开关的账号在配置中传 `"--screen-info": null` 移除。

## 验证方法

配置完成后，可在无头会话中读取运行期屏幕与视口属性，或前往 [detection-sites.md](detection-sites.md) 中的 CreepJS 核对 `noTaskbar` 与 `hasVvpScreenRes` 状态：

```sh
agent-browser --session screen-check open "https://example.com"
agent-browser --session screen-check eval "JSON.stringify({sw:screen.width,sh:screen.height,aw:screen.availWidth,ah:screen.availHeight,iw:innerWidth,ih:innerHeight,dpr:devicePixelRatio})"
agent-browser --session screen-check close
```
