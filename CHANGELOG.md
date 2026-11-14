# Changelog

## [0.8.4](https://github.com/taitide-labs/agent-browser-kit/compare/v0.8.3...v0.8.4) (2026-11-14)


### Bug Fixes

* **profile:** 限制指纹 seed 为有符号 32 位正整数 ([#50](https://github.com/taitide-labs/agent-browser-kit/issues/50)) ([d9efc29](https://github.com/taitide-labs/agent-browser-kit/commit/d9efc29527aea3b286eaa469f3a9e5d2692ed999))

## [0.8.3](https://github.com/taitide-labs/agent-browser-kit/compare/v0.8.2...v0.8.3) (2026-11-14)


### Bug Fixes

* **browser:** 消除有头模式启动时的多余新标签页 ([#41](https://github.com/taitide-labs/agent-browser-kit/issues/41)) ([e90a995](https://github.com/taitide-labs/agent-browser-kit/commit/e90a9952625a90ef4e8e90d62b9df4e304e740b5))

## [0.8.2](https://github.com/taitide-labs/agent-browser-kit/compare/v0.8.1...v0.8.2) (2026-11-14)


### Bug Fixes

* **kernel:** 支持从环境变量读取 GitHub Token 并为同步工作流补充依赖缓存 ([#36](https://github.com/taitide-labs/agent-browser-kit/issues/36)) ([40fb69e](https://github.com/taitide-labs/agent-browser-kit/commit/40fb69eaa54fa8033499bded7c4bc20604e67e73))

## [0.8.1](https://github.com/taitide-labs/agent-browser-kit/compare/v0.8.0...v0.8.1) (2026-11-14)


### Bug Fixes

* **cli:** 精简 help 输出并切换 bunx 配置说明 ([#34](https://github.com/taitide-labs/agent-browser-kit/issues/34)) ([1280e03](https://github.com/taitide-labs/agent-browser-kit/commit/1280e0331d71cde9bfd10cebde1aa16e75043486))

## [0.8.0](https://github.com/taitide-labs/agent-browser-kit/compare/v0.7.0...v0.8.0) (2026-11-14)


### Features

* **config:** 统一 config.json 配置管理并按内核平台与视口派生参数 ([#32](https://github.com/taitide-labs/agent-browser-kit/issues/32)) ([3505634](https://github.com/taitide-labs/agent-browser-kit/commit/35056343dd10e630e4605459af974f3d86c7c507))

## [0.7.0](https://github.com/taitide-labs/agent-browser-kit/compare/v0.6.0...v0.7.0) (2026-11-14)


### Features

* **browser:** 支持参数 null 显式删除、mkdtempSync 临时会话及分层架构 ([#30](https://github.com/taitide-labs/agent-browser-kit/issues/30)) ([8e3cdff](https://github.com/taitide-labs/agent-browser-kit/commit/8e3cdff72d578e46521062aabf09b940b61c6a03))

## [0.6.0](https://github.com/taitide-labs/agent-browser-kit/compare/v0.5.1...v0.6.0) (2026-11-14)


### Features

* **browser:** mirror upstream chrome args with layered overrides and ephemeral sessions ([#29](https://github.com/taitide-labs/agent-browser-kit/issues/29)) ([19ec408](https://github.com/taitide-labs/agent-browser-kit/commit/19ec408915a3bcf0e9ea0c4c84987d16a60d8289))
* **plugin:** add structured help command ([#27](https://github.com/taitide-labs/agent-browser-kit/issues/27)) ([cd48436](https://github.com/taitide-labs/agent-browser-kit/commit/cd484364a7fa0afc21e72c609dad171a3235e6be))

## [0.5.1](https://github.com/taitide-labs/agent-browser-kit/compare/v0.5.0...v0.5.1) (2026-11-14)


### Bug Fixes

* **plugin:** 按 agent-browser 协议将 plugin.manifest 响应包裹在 manifest 字段中 ([#25](https://github.com/taitide-labs/agent-browser-kit/issues/25)) ([155ccdd](https://github.com/taitide-labs/agent-browser-kit/commit/155ccddeb778bd109aa1e35a0ace437d0fc07fc7))

## [0.5.0](https://github.com/taitide-labs/agent-browser-kit/compare/v0.4.0...v0.5.0) (2026-11-14)


### Features

* **plugin:** 实现 fingerprint-chromium 多账号隔离插件与内核管理 ([#24](https://github.com/taitide-labs/agent-browser-kit/issues/24)) ([2d9798c](https://github.com/taitide-labs/agent-browser-kit/commit/2d9798c907c47e0937363c2f6b1d565bfd583ca2))


### Bug Fixes

* **ci:** 从 package.json 动态读取包名避免硬编码 ([#22](https://github.com/taitide-labs/agent-browser-kit/issues/22)) ([48a145c](https://github.com/taitide-labs/agent-browser-kit/commit/48a145cb283166c7659f530f5759d5eb010ccfb3))
* **release:** 启用 force-tag-creation 并显式设置 GH_REPO ([#23](https://github.com/taitide-labs/agent-browser-kit/issues/23)) ([8c769e4](https://github.com/taitide-labs/agent-browser-kit/commit/8c769e480e0499545febf4f17cf0ce190eaf26cc))

## [0.4.0](https://github.com/taitide-labs/agent-browser-kit/compare/v0.3.0...v0.4.0) (2026-11-12)


### Bug Fixes

* **ci:** 移除 draft 模式下 checkout 的 tag ref 限制 ([6cbbfe2](https://github.com/taitide-labs/agent-browser-kit/commit/6cbbfe28d97024f3770ecae668be64bad888304b)) (@superxxl)

## [0.3.0](https://github.com/taitide-labs/agent-browser-kit/compare/v0.2.0...v0.3.0) (2026-11-12)


### Bug Fixes

* **ci:** 修正 actions/attest v4.2.2 Commit SHA ([be9d1bb](https://github.com/taitide-labs/agent-browser-kit/commit/be9d1bb804c076755487b6180d03f39f4f4b16f0)) (@superxxl)

## [0.2.0](https://github.com/taitide-labs/agent-browser-kit/compare/v0.1.0...v0.2.0) (2026-11-12)


### Features

* **cli:** 补充初始 CLI 用法说明并触发首次 OIDC 发布 ([9cfa981](https://github.com/taitide-labs/agent-browser-kit/commit/9cfa98129c6b570049dc09f11287271ae484a3a0)) (@superxxl)
