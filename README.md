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

详见[定时消息使用指南](https://github.com/Arcueid77/dot-bridge/blob/main/docs/scheduled-messages.md)。


## 交互与维护

保留原 `LARK_INTERACTION_POLICY_FILE`：处理表情、状态卡、媒体、真实增量卡片、本人私聊及受控群规则在同一受保护策略中配置。`append_lark_reply` 每次提交新生成的增量，序号连续；最后用完整文本 `reply_to_lark` 完成同一卡片。近期历史与引用由 `get_lark_context` 按原会话范围读取。

本人原私聊支持 `/help`、`/status`、`/queue`、`/subscription`、`/cancel [编号]`。标准回调模式下，显式 `DOT_BRIDGE_OWNER_MANAGEMENT=1` 可在 dot 订阅缺失时保持维护连接。取消只作用于尚未发送的桥回复；本次已开始的 begin/append 处理仍要完成唯一最终回复，结果不明保持核对。详情见[配置说明](docs/configuration.md)。

Linux、Windows 前台运行及 Linux systemd 的用法见[部署说明](docs/deployment.md)。macOS 尚未验证，欢迎试用并反馈。原 dot 的暂停、重置和审批继续使用原平台入口。

## 选项、文件和提醒管理

支持原生选项回复，点击后作为一条新输入交给原 dot。选项绑定发起人、原会话及实际发出的消息，最长十分钟有效。生成的图片、音频或文件可由具备程序文件读取能力的原 dot 分块上传，经大小与 SHA-256 校验后作为原消息的最终回复。单文件上限 5 MiB，仍需满足本渠道支持的媒体类型与格式。

固定文字提醒支持工作日、固定间隔、暂停、恢复和发送历史。先核对 `check_lark_outbound` 的开关，再按提醒编号与当前版本操作。暂停期间的旧时间点在恢复时跳过。
