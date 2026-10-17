# 飞书聊天体验与群聊配置

[简体中文](configuration.md) | [English](configuration.en.md) | [首页](../README.md)


本功能继续使用同一个 dot、同一个官方 Secure MCP Tunnel 和原飞书应用。当前分支使用独立 `@dot-bridge/core` 发行包提供公共传输、平台保护和聚合路由，不依赖 QQ 仓库或 QQ readiness 后端。飞书工具/事件 schema 位于本仓库 `src/tunnel-contract.js`，聚合适配器位于 `src/tunnel-adapter.js`；`scripts/run-tunnel-router.js` 显式注册飞书适配器。安装与单飞书拓扑见 [部署指南](deployment.md)。

下列增强体验是代码提供的可选能力，需启用受保护交互策略及对应权限。未设置 `LARK_INTERACTION_POLICY_FILE` 时保留本人私聊纯文字兼容模式，不自动启用媒体、表情、卡片或群聊。代码存在不代表目标实例已经启用或完成真实验收。

## 支持的体验

- 接收消息后先落库，再添加 `Typing` 表情和“已接收，等待处理”卡片。dot 实际调用 `begin_lark_reply` 后才显示“正在处理”；生成段落后调用 `append_lark_reply` 更新同一卡片，最后 `reply_to_lark` 完成它。没有可用的模型原始 token 流，不用回放已完成的答案模拟流式输出。
- 收发文字、富文本、图片、文件和语音；原消息回复接口固定收件人。Markdown 保留代码块、列表和表格。模型生成的 `<at>` 不会通知其他人或全群。
- 文字输入上限 20,000 JavaScript 字符，完整回答 30,000 字符；每个资源上限 8 MiB、每条至多 10 个资源。长回答超过保守的行内字节预算时，卡片显示预览并附上一个完整 Markdown 文件；这是一个逻辑回答的卡片与附件，不是重复回答。
- 引用消息按原会话查询。上下文只读保留期内、当前消息之前的已授权消息；私聊和不同群分开。群默认按发送人分开，可显式选择群内共享上下文。原 dot 的全局记忆并没有新的物理隔离，群任务规则必须禁止调用或披露私聊记忆。
- 文件提供原始 MCP resource，同时尝试提取 UTF-8 文本、PDF、DOCX、XLSX、PPTX。失败明确标注 `unsupported`，不是声称已经读懂。语音通过原 dot 支持的 MCP audio 内容传入；出站非 Opus 音频经受限 FFmpeg 转为 Opus，不另建模型 API 或转写机器人。
- 失败、超时、撤销或发送结果不明会更新已知卡片并移除自己的处理表情。没有 callback 时不伪造 dot 已收到。结果不明保留 `uncertain`，禁止自动重发。权限撤销后不再发送或读取该会话。

实际图片理解、文件理解、语音理解和逐段生成仍须原 dot 的工具调用与真实消息验收；离线合成测试不能证明宿主会处理所有 MCP 内容类型。

## 飞书应用权限

仅使用本功能实际所需的应用权限，已有权限不重复创建。私聊文本已有的接收和机器人发送权限继续复用：

| 功能 | 权限 |
| --- | --- |
| 引用原消息 | `im:message:readonly` |
| 群内 @ | `im:message.group_at_msg:readonly` |
| 指定群关键词、全消息触发 | `im:message.group_msg` |
| 查找及清除自己的表情 | `im:message.reactions:read`、`im:message.reactions:write_only` |
| 图片、文件、语音 | `im:resource` |
| 同一卡片更新 | `cardkit:card:write` |
| 操作者选择已加入的群 | `im:chat:read` |
| 按成员姓名建立白名单（可选） | `im:chat.members:read` |

`im:message.group_msg` 会让应用收到机器人已加入群的普通消息，桥在持久化之前按受保护规则筛选，未配置的群不保存或投递。开启这一应用权限仍是权限扩张，必须先明确获批。成员读取是配置便利，不是回复所有成员必需。不要为诊断额外授予 `application:application:self_manage`，也不要照搬参考插件的文档、日历、联系人或用户级授权。

参考为 [飞书官方 OpenClaw 插件](https://github.com/larksuite/openclaw-lark)；只参考交互与官方 API，未引入它的机器人运行时或广泛权限。

## 受保护配置

正式入口仍为：

```sh
node --env-file=/var/lib/dot-bridge/private/lark.env scripts/run-tunnel-live.js --confirm-live-owner-bridge
```

在原环境文件中指定 `LARK_INTERACTION_POLICY_FILE=/var/lib/dot-bridge/private/lark-interactions-v1.json`。该文件及父目录必须分别为 0600、0700，属主是运行用户，普通单链接文件，不跟随符号链接；Windows 使用对应的私有 DACL 保护。默认不提供此字段即保留原本人私聊模式。增强功能仅接受 `CALLBACK_TRANSPORT_MODE=standard` 的 Tunnel live 服务。

操作者脚本只通过 SSH 使用，没有面向模型的权限/配置工具，也不增加管理端口或新凭据：

```sh
# 只读应用配置和租户授权状态；只输出权限名称、数量和布尔值
node --env-file=/var/lib/dot-bridge/private/lark.env scripts/configure-interactions.js permissions --confirm-remote-read

# 根据实际官方 bot-info 创建新私有配置；群仍全部关闭，不修改环境或重启
node --env-file=/var/lib/dot-bridge/private/lark.env scripts/configure-interactions.js prepare /var/lib/dot-bridge/private/lark-interactions-v1.json --confirm-private-storage --confirm-remote-read

# 已加入的群名称/ID 只存私有文件，不输出到日志
node --env-file=/var/lib/dot-bridge/private/lark.env scripts/configure-interactions.js group-catalog /var/lib/dot-bridge/private/groups-catalog.json --confirm-private-storage --confirm-remote-read

# 根据私有规则另存一个新版本，不覆盖已有文件，不自动启用
node scripts/configure-interactions.js set-groups /var/lib/dot-bridge/private/lark-interactions-v1.json /var/lib/dot-bridge/private/group-rules.json /var/lib/dot-bridge/private/lark-interactions-v2.json --confirm-private-storage
node scripts/configure-interactions.js validate /var/lib/dot-bridge/private/lark-interactions-v2.json
```

规则文件只包含 `groups` 和可选的 `group_mentions`。以下是不可用于真实会话的占位例子：

```json
{
  "groups": [
    {"chat_id":"EXACT_APPROVED_GROUP","members":"allowlist","allow_from":["EXACT_APPROVED_MEMBER"],"mention":true,"auto_reply":"keywords","keywords":["帮助","提问"],"reply_in_thread":true,"context_scope":"sender"},
    {"chat_id":"ANOTHER_APPROVED_GROUP","members":"all","mention":true,"auto_reply":"all","reply_in_thread":false,"context_scope":"sender"}
  ],
  "group_mentions":{"enabled":false,"members":"owner","context_scope":"sender"}
}
```

`members` 可选 `owner`、`allowlist`、`all`；`auto_reply` 可选 `off`、`keywords`、`all`，@ 回复独立开关。关键词为大小写不敏感的包含匹配，不执行正则；空白名单、空关键词、重复群以及未使用的数组都会拒绝。每群可关闭、选择原群回复或原线程回复，选择 `sender` 或 `group` 上下文。全局 @ 可配置，但默认关闭；显式禁用的群始终覆盖全局设置。只识别官方 SDK 的精确机器人 open_id，@所有人或其他机器人不触发。

最多 50 个群，完整私有 JSON 不超过现有私有读取器的 16 KiB。变更规则另存版本、验证后指向新文件并优雅重启。禁止通过放宽权限解决启动拒绝。

## 原 dot 的任务与订阅

必须复用原事件任务及插件。刷新工具目录后，新增工具为 `get_lark_context`、`get_lark_attachment`、`reply_lark_attachment`、`reply_lark_media`、`begin_lark_reply`、`append_lark_reply`；原读取和回复工具保留。

当前 `conversation:owner` 订阅继续只接收本人私聊。启用获批群之前，原 dot 应在安全切换时撤销旧订阅，再从其真实流程建立 `conversation:configured`，它仍只接受一个有效订阅。callback 必须来自原 dot，不猜 URL，不复制其他环境。切换前排空可完成任务并备份状态，保留所有 uncertain。不得通过换数据库或主机绕开互斥。

任务对每条事件先读取源消息、期限和 durable reply 状态；终态不重发，仅原会话中的正文和附件作为数据。群聊只使用该 source 返回的上下文，不披露私聊或全局记忆，不代群成员执行外部操作、支付、删除、导出凭据等动作。实际开始后调用 begin，再逐段 append 真实新内容；最终完整文本调用 reply_to_lark，或一个媒体工具完成回答。禁止重放最终文本来伪造流式输出。送达以后台 sent 和用户看到的原会话结果为准。

## 迁移、停止与验收

数据库增加独立的加密详情、表情、卡片、段落序号表，保留原库、STORAGE_KEY、绑定、订阅代际及去重。备份使用 SQLite 一致性机制，或优雅停机后复制完整已检查状态；不要只复制正在写入的主文件。普通 systemd 配置不设置 `DOT_BRIDGE_SUPERVISED=1`，停止等待建议 180 秒以覆盖有界资源处理。

Node 24.15–24.x，OpenSSL；媒体转换需受保护的 Linux `/usr/bin/ffmpeg`、`python3`、`prlimit`，PDF 提取需官方发行版 `python3-pypdf`。子进程无 shell、只通过 stdin/stdout、20 秒/512 MiB/15 CPU 秒限制；不提取 ZIP 到磁盘、不获取文档外部资源，FFmpeg 协议仅允许 pipe。

独立验证只需本仓库：在没有 QQ/core 源码 checkout 的目录执行锁定安装、`npm run check`、`npm test` 和 `npm run simulate`。确认 `test/standalone-router.test.js` 实际执行且不因兄弟路径缺失而跳过；其合成场景包含群触发、图片资源、上下文及同一卡片回复，不证明真实网关或模型理解能力。本页列出的是验收步骤，具体执行结果见 [开发说明](development.md)。通过离线验证并获准后才部署固定提交候选；仅运行一个飞书消费者，无需 QQ 后端。真实验收由本人发消息，分别检查表情、同一卡片、长文文件、引用、多轮、图片、文件、语音、获批群 @/关键词/全消息/成员拒绝、重启去重和断开 SSH；整台 VPS 重启需另获批。

默认正文与回答七天逻辑清除；去重墓碑保留。WAL、数据库旧页、备份、系统日志仍可能保留加密历史，逻辑清除不是物理擦除。订阅到期由原 dot/平台按真实 refreshBefore 更新；桥没有另建自动续订任务。

## 运行限制

### 语音转写

部分 ChatGPT 工具环境会省略 MCP 音频内容。启用本地转写后，`get_lark_attachment` 同时返回 `extracted_text`，原 dot 可据此理解语音、回复原会话。转写只是参考，不能当作外部操作授权。

在后端环境文件设置 `DOT_BRIDGE_AUDIO_TRANSCRIPTION=local-whisper`、`DOT_BRIDGE_WHISPER_BINARY` 和 `DOT_BRIDGE_WHISPER_MODEL`。后两项是已安装、root 所有且服务用户不可修改的 whisper-cli 与多语言模型绝对路径；另需 `/usr/bin/ffmpeg`、`prlimit`、`flock`。与 QQ 共用原 `BRIDGE_LOCK_DIRECTORY`，一次只转写一条。音频通过内存管道处理，无需 API key，不发往外部转写服务，回答仍由原 dot 生成。

单条限制为 8 MiB、两分钟音频、28 秒转写，最多返回 12000 字符。繁忙、超时或听不清会标明 `extraction_status:unsupported`；没有可用音频或文字时，请发送者重发较短语音或文字。只有读取结果中存在转写才说明本次成功，媒体开关或附件下载成功本身并不代表 dot 能听懂。

以下字段放在后端环境文件中，不放在聚合器环境中：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `REPLY_TTL_SECONDS` | 900 | 本地回复期限（秒） |
| `SUBSCRIPTION_TTL_SECONDS` | 86400 | 订阅寿命上限，还受请求 TTL 和已认证主体寿命约束 |
| `QUEUE_LIMIT` | 100 | 队列容量 |
| `INBOUND_PER_MINUTE` / `REPLIES_PER_MINUTE` | 10 / 10 | 每分钟入站/回复限流 |
| `MAX_DELIVERY_ATTEMPTS` | 5 | 有界尝试数，不允许重发 uncertain 回复 |

飞书另支持 `TEXT_RETENTION_SECONDS`，默认 604800 秒，不得短于回复期限。飞书的回复期限是桥的本地策略，不是声称平台存在对应被动回复窗口。
