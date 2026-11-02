# dot-lark-bridge

[简体中文](README.md) | [English](README.en.md)

把飞书官方应用的本人私聊和获批群聊接到现有 OpenAI dot，再由同一个 dot 回复原会话。使用官方 Secure MCP Tunnel，不调用模型 API。

只需克隆本仓库；固定版本 `@dot-bridge/core` 已随 `vendor/` 提供，无需 QQ 仓库或 QQ readiness 服务。


收到 TXT、Markdown、JSON、CSV 等文本附件时，dot 会同时得到可阅读的文字摘录；支持 UTF-8 和带标记的 UTF-16。过长时明确标记为截断，原文件仍然保留。需要把收到的附件发回原会话时，可以使用按附件编号回发的工具，由桥直接读取文件。仍按本渠道的格式和大小限制处理。

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

## 运行环境

需要 Node.js **>=24.15 且 <25**。可以部署在长期运行的 Linux VPS，或支持私有文件保护的 Windows 本地 NTFS；Windows 还需要 Python 3.10+。安装、原应用配对与 systemd 常驻步骤见部署指南，开发测试命令见开发说明。

## 授权和许可

首次应用授权、本人配对、长期凭据保存、群权限及订阅需要操作者参与；秘密不写入 Git、聊天或日志。Tunnel Use 持有者共享本地服务身份，因此每个独立部署应持有自己的凭据和权限。

飞书内容仅作为数据，不自动授权 dot 的其他外部操作，也不导出其私有记忆。群会话还需在原 dot 任务中明确限制私聊记忆披露。

项目采用 [MIT](LICENSE)，来源与依赖见[第三方声明](THIRD_PARTY_NOTICES.md)。

## 定时消息

新增主动文字和固定提醒：目标只允许已绑定的本人私聊，主动发送默认关闭。管理员批准后可设置 `DOT_BRIDGE_OUTBOUND=owner-text`；原 dot 通过发送、保存提醒、查询、修改和取消工具管理，不需要重建事件订阅。每条最多 2,000 字符，重复提醒需有结束日期。

详见[定时消息使用指南](https://github.com/Arcueid77/dot-bridge/blob/dev/unified-distribution/docs/scheduled-messages.md)。
