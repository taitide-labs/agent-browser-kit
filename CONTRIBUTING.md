# 贡献指南

> 本项目目前仅接受内部维护者的 Pull Request，暂不接受外部 PR。欢迎通过 Issue 反馈 Bug 或功能建议。

本仓库使用 `mise` 管理工具链、使用 `hk` 编排本地 Git Hooks，所有内部变更均通过 Pull Request 合入 `main` 分支。

## 1. 本地环境初始化

克隆仓库后，在根目录安装项目依赖并激活 Git Hooks：

```sh
mise install
bun install --frozen-lockfile
hk install --mise
```

激活后，以下 Git Hooks 会自动生效：

- **`pre-commit`**：运行文档规范、Mermaid 语法、离线死链、拼写检查，以及 `oxfmt`、`oxlint`、`typecheck`、`bun test`。
- **`commit-msg`**：校验提交信息是否符合 Conventional Commits 规范。
- **`pre-push`**：运行 `bun audit --audit-level=high` 审计依赖安全。

## 2. 常用检查命令

- 执行全量只读检查：

  ```sh
  mise run docs:check
  ```

- 自动修复排版、Markdown 格式与代码格式：

  ```sh
  mise run docs:fix
  ```

## 3. 提交与版本规范

本项目采用 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/) 规范提交信息，并遵循 [Semantic Versioning 2.0.0](https://semver.org/) 规范管理版本号。

所有提交信息须遵循以下格式：

```text
<type>(<scope>): <简述>

<变更动机（可选）>

BREAKING CHANGE: <破坏性变更说明（可选）>
```

常用 `<type>` 说明：

- `feat`：新增面向用户的功能（触发次版本升级）
- `fix`：修复面向用户的缺陷（触发修订号升级）
- `feat!` / `BREAKING CHANGE:`：包含破坏性变更（`>= 1.0.0` 时触发主版本号升级）
- `docs`：仅修改文档
- `refactor`：代码重构（无新功能且无缺陷修复）
- `chore` / `ci`：工程基建、依赖或 CI 流程调整

## 4. Pull Request 流程

1. 从 `main` 分支创建特性或修复分支（仓库规则禁止直接向 `main` 推送）。
2. 提交前确认本地 `mise run docs:check` 全部通过。
3. 创建 Pull Request，等待 `Merge Gate`（`Path Filter`、`Docs Checks`、`Checks`、`Security`）全部通过后即可合并。
