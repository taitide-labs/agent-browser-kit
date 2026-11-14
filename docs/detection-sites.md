# 常见浏览器检测网站参考

列出用于验证浏览器指纹隔离、自动化特征、网络泄漏及区域一致性的常用测试站点。

## 自动化与风控检测

用于核验 `navigator.webdriver` 隐藏状态、无头特征及人机风控通过情况。

| 网站 | 检测重点 | 参考用途 |
| :--- | :--- | :--- |
| [Sannysoft Bot Test](https://bot.sannysoft.com/) | `webdriver`、Chrome 运行时属性与自动化特征 | 快速回归，核对各项自动化指标是否正常 |
| [CreepJS](https://abrahamjuliot.github.io/creepjs/) | 无头特征、Worker 与浏览器异常熵值 | 查看异常告警与信任评分 |
| [Fingerprint Demo](https://fingerprint.com/demo/) | 商业指纹 ID 稳定性与自动化识别 | 对照不同 `--session` 是否生成独立 ID |
| [NowSecure](https://nowsecure.nl/) | Cloudflare 人机挑战实机测试 | 配合 `--headed` 验证真实风控挑战 |

## 硬件与渲染指纹

用于核验持久账号 `--fingerprint` 种子的跨重启稳定性，以及不同账号间的硬件渲染差异。

| 网站 | 检测重点 | 参考用途 |
| :--- | :--- | :--- |
| [BrowserLeaks Canvas](https://browserleaks.com/canvas) | Canvas 图像渲染哈希 | 验证同账号 Signature 恒定、多账号彼此不同 |
| [BrowserLeaks WebGL](https://browserleaks.com/webgl) | WebGL 渲染器、显卡厂商与扩展列表 | 核对 GPU 参数与渲染结果 |
| [BrowserLeaks](https://browserleaks.com/) | 字体、AudioContext、Screen 与硬件并发数 | 进入各专项子页核查硬件指纹 |
| [Pixelscan](https://pixelscan.net/) | 硬件指纹与操作系统声明一致性 | 检查系统与硬件参数自洽性 |

## 网络与协议泄漏

用于核验代理出口、WebRTC 防泄漏策略与 HTTP 请求头形态。

| 网站 | 检测重点 | 参考用途 |
| :--- | :--- | :--- |
| [BrowserLeaks WebRTC](https://browserleaks.com/webrtc) | WebRTC 内网与公网地址泄漏 | 确认未暴露本机真实出口与局域网地址 |
| [IPLeak](https://ipleak.net/) | IP、DNS 与 WebRTC 综合泄漏检测 | 使用代理时核对 DNS 请求归属地 |
| [Peet.ws TLS](https://tls.peet.ws/api/all) | TLS、JA3/JA4、HTTP/2 指纹与原始请求头 | 核对实际发出的 `Accept-Language` 与 `User-Agent` |

## 区域、语言与时区

用于核验出口 IP 归属地与 `timezone`、`lang`、`acceptLang` 是否一致。

| 网站 | 检测重点 | 参考用途 |
| :--- | :--- | :--- |
| [Iphey](https://iphey.com/) | 出口 IP 地区、时区、语言头与系统特征 | 核对 Timezone 与 Language 一致性状态 |
| [BrowserLeaks JS](https://browserleaks.com/javascript) | `navigator.language`、`Intl` 与 `Date` 时区偏移 | 快速核对运行时接口返回值 |

> [!NOTE]
> 在 macOS 下，`--lang` 与 `--accept-lang` 会修改 `navigator.language`、`navigator.languages` 与 HTTP `Accept-Language` 请求头，但 Chromium 在 macOS 上会依据系统 `AppleLanguages` / `AppleLocale` 偏好初始化 `Intl.DateTimeFormat().resolvedOptions().locale`。若在 macOS 上测试英文档案时看到该字段仍显示宿主机区域，属于平台机制而非参数未生效。

## 验证命令参考

日常校验可使用无头模式直接读取运行时返回值；需要人工目视页面或处理人机校验时再启用 `--headed`。若无头模式在 CreepJS 触发 `noTaskbar` 或 `hasVvpScreenRes`，请参阅 [headless-screen.md](headless-screen.md) 调整屏幕与工作区参数：

```sh
# 1. 无头模式核对语言与时区返回值
agent-browser --session account-01 open "https://browserleaks.com/javascript"
agent-browser --session account-01 eval "JSON.stringify({lang:navigator.language,langs:navigator.languages,tz:Intl.DateTimeFormat().resolvedOptions().timeZone})"
agent-browser --session account-01 close

# 2. 有头模式集中打开常用检测页
agent-browser --session fp-check --input-mode human --headed open "https://iphey.com/"
agent-browser --session fp-check tab new "https://bot.sannysoft.com/"
agent-browser --session fp-check tab new "https://browserleaks.com/webrtc"
agent-browser --session fp-check tab new "https://abrahamjuliot.github.io/creepjs/"
```
