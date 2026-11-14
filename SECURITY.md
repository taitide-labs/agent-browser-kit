# 安全政策

## 支持版本

仅针对当前最新发布的次版本提供安全更新与漏洞修复。

| 版本 | 是否支持 |
| :--- | :--- |
| 最新正式版 | 支持 |
| 更早版本 | 不支持 |

## 报告安全漏洞

> 请勿通过公开 Issue 披露潜在安全漏洞。

如果你在 `agent-browser-kit` 中发现了安全问题，请通过 GitHub 仓库的 **Security -> Advisories -> Report a vulnerability** 提交私密漏洞报告。

请在报告中尽可能提供：

- 受影响的版本号与运行环境；
- 复现步骤或 PoC；
- 潜在影响范围与修复建议（如有）。

我们会在收到报告后 **3 个工作日内** 确认受理并评估影响范围，协调修复后再同步发布安全公告。

## 构建产物溯源验证

所有正式发布的归档均附带 `SHA256SUMS.txt` 与 GitHub SLSA Build Provenance 溯源签名，可通过以下命令验证产物确由本仓库官方 GitHub Actions 原生构建：

```sh
gh attestation verify <artifact-file> --repo taitide-labs/agent-browser-kit
```
