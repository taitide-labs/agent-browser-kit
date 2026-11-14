# 采用 `browser.provider` 并维持 `session` 与 `profile` 一对一绑定

实测 `agent-browser 0.43.0` 的插件协议仅透传 `session`（不传 `--profile`），且 `launch.mutate` 会前置临时 `--user-data-dir` 并只监听该临时目录下的 `DevToolsActivePort`，注入自定义目录必然导致启动失败。因此采用 `browser.provider` 接管内核启动与回收，并维持 `session` 名称与 `<Profile根目录>/<account>` 一对一绑定；同账号并发通过 `tab new` 多标签页执行。

## 备选方案

- **`launch.mutate` 注入 `--user-data-dir`**：虽可复用 `agent-browser` 原生进程管理，但与内置临时目录及 `DevToolsActivePort` 探测机制冲突，实测不可行。
- **多 `session` 复用同一 `profile`**：Chromium 的 `SingletonLock` 限制同一目录同时只能挂载单进程，若支持多 `session` 共享需引入别名映射与跨 Session 关闭引用计数，首期暂不引入。

## 影响

- 插件需自行负责 `fingerprint-chromium` 子进程的拉起、僵尸锁清理与 `browser.close` 回收。
- 后续若需以不同 `--session` 名复用同一账号档案，可在插件内增加 `session -> profile` 映射表或共享 `cdpUrl` 引用计数演进，不影响现有配置结构。
