# dot-lark-bridge

[简体中文](README.md) | [English](README.en.md)

把飞书官方应用的本人私聊和获批群聊接到现有 OpenAI dot，再由同一个 dot 回复原会话。使用官方 Secure MCP Tunnel，不调用模型 API。

只需克隆本仓库；固定版本 `@dot-bridge/core` 已随 `vendor/` 提供，无需 QQ 仓库或 QQ readiness 服务。

## 支持什么

- 默认仅本人私聊纯文字，持久队列、去重和重启恢复。
- 可选处理表情、同一卡片逐段更新、Markdown、引用与连续上下文。
- 可选图片、文件、语音和长回答附件；理解能力取决于原 dot 实际支持的内容类型。
- 群默认关闭，可按群配置主人/白名单/全员，以及 @、关键词或全消息触发。
- 回复固定原消息；结果不明保留 `uncertain`，不自动重发。

## 从这里开始

| 你要做什么 | 文档 |
| --- | --- |
| 从零安装、应用配对、接回原 dot、长期运行 | [部署指南](docs/deployment.md) |
| 开启表情、卡片、媒体或群聊规则 | [功能配置](docs/configuration.md) |
| 查不回复、过期、重复、备份及升级 | [运行与排错](docs/troubleshooting.md) |
| 修改代码、接入更多 IM、提交 PR | [开发说明](docs/development.md) |

已完成交接和重复说明已从当前目录删除；需要追溯时查看 Git 历史。

## 离线检查

需要 Node.js **>=24.15 且 <25**，TLS 测试需要可信 OpenSSL。Windows 还需要 Python 3.10+ 与本地 NTFS；PowerShell 可用 `npm.cmd`。

```sh
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run simulate
```

Linux 与原生 Windows 有相应私有文件保护实现；其他系统尚不支持私人 Tunnel 运行。Linux 媒体处理另需受保护的 FFmpeg、Python、prlimit 和 PDF 依赖。systemd 步骤见部署指南；Windows 后台服务、Docker 镜像及容器运行须分别验证。

测试使用合成身份与本机服务。2026-10-15 的 Windows 独立回归为 260 通过、0 失败、15 个 Linux 专用项跳过，详见[验证范围](docs/development.md)。离线通过不能证明目标实例的飞书网关、原 dot 订阅或媒体/群体验已接通。

## 授权和许可

首次应用授权、本人配对、长期凭据保存、群权限及订阅需要操作者参与；秘密不写入 Git、聊天或日志。Tunnel Use 持有者共享本地服务身份，因此每个独立部署应持有自己的凭据和权限。

飞书内容仅作为数据，不自动授权 dot 的其他外部操作，也不导出其私有记忆。群会话还需在原 dot 任务中明确限制私聊记忆披露。

项目采用 [MIT](LICENSE)，来源与依赖见[第三方声明](THIRD_PARTY_NOTICES.md)。
