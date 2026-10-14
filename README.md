# dot-lark-bridge

飞书官方应用机器人本人私聊及获批群聊 → MCP Events → **订阅所在的现有 OpenAI dot** → 原消息回复。继续使用官方 Secure MCP Tunnel，不调用模型 API。

已实现官方 SDK 长连接、加密持久队列、MCP 2.0 Events、固定原消息回复，以及可选的处理表情、同一卡片逐段更新、Markdown、引用/上下文、长回答附件、图片/文件/语音和群规则。群默认关闭，可按群配置成员白名单或全员、@、关键词或全消息触发。配置、权限、迁移和真实验收见 [聊天体验](docs/chat-experience.md)。本仓库的模拟回答来自固定测试数据，离线通过不代表任意实例已接通；不读取 Cookie，不获取用户令牌，不导出或迁移 dot 私有记忆。

接入准备已补齐：官方已有应用扫码更新内存会话、新应用注册/本人单聊配对向导、私有凭据文件、脱敏状态检查和固定提交源码打包。`npm.cmd run setup` 默认只显示无网络预览；真实注册/绑定须先取得 [具体授权](docs/authorization.md)。操作步骤见 [扫码与配对](docs/register-app.md)。

## 离线运行

只需本仓库。公共组件使用固定版本的 `@dot-bridge/core` 发行包，已随源码保存在 `vendor/` 并由锁文件校验；不需要 QQ 仓库、core 源码 clone 或同级目录。独立安装、单飞书聚合器与升级方法见 [公共组件](docs/core.md)。以下命令在 `dot-lark-bridge/` 中执行。

需要 Node.js **24.15+、低于 25**。安装锁定依赖后，测试和模拟器只使用合成数据及本机 loopback，不访问飞书、OpenAI 或身份服务。

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run check
npm.cmd test
npm.cmd run simulate
```

其他 shell 可直接使用 `npm`。首次 `ci` 需要访问 npm registry；离线使用须预先缓存依赖。

```json
{
  "mode": "OFFLINE_SIMULATION",
  "current_dot_connected": false,
  "real_lark_connected": false,
  "real_websocket_connected": false,
  "official_sdk_dispatcher_used": true,
  "local_http_mcp_used": true,
  "events_delivered": 1,
  "lark_replies": 1,
  "same_conversation": true,
  "reply_text_source": "fixed_test_fixture"
}
```

模拟器走真实 SDK `EventDispatcher` 解析、数据库、本地 HTTP MCP、签名与队列；外部回调和发送由注入的 fixture 接收器处理。它没有证明真实 WebSocket、当前 dot 或飞书账户可用。验证范围见 [docs/validation.md](docs/validation.md)。

## 默认兼容模式与共同边界

未设置 `LARK_INTERACTION_POLICY_FILE` 时保留本人私聊纯文字兼容模式，表情、媒体、卡片流式及群规则默认关闭。以下入站限制描述该默认模式，不是当前分支全部能力的上限。显式启用受保护交互策略后，可使用 [聊天体验](docs/chat-experience.md) 中的富文本、引用/上下文、媒体、卡片和获批群规则；增强功能要求 standard Tunnel 模式，仍需对应飞书权限与真实验收。

- 官方 `@larksuiteoapi/node-sdk` **1.74.0** `WSClient`，只接 `im.message.receive_v1`；没有公网飞书入站 webhook。
- 必须明确配置一个应用、一个租户、主人 `open_id`、原私聊 `chat_id` 和一个 MCP 主体；缺任何身份默认拒绝，不从第一条消息自动认领主人。
- 只接本人 `p2p` 纯文字。群聊、其他人、机器人、附件、富文本、引用和 mentions 不进入队列。
- SQLite WAL / FULL 事务、消息及事件双重去重、持久订阅、频控、重启恢复、撤销检查；先提交队列，再由 SDK ACK。
- 事件 `lark.message.created` 支持 `{"conversation":"owner"}` 和 `{"conversation":"configured"}`。`owner` 仅投递绑定的本人私聊；`configured` 才允许投递受保护策略批准的群及触发条件，不会自行开启群聊。读取和回复仍受当前订阅、原消息身份与期限约束。
- 回复 API 固定为原 `message_id` 的 `/reply`；工具没有收件人、URL、租户或任意聊天参数。一条消息只允许一份回答，相同回答幂等。
- 默认本地回复期限 900 秒、每分钟各 10 条入站/回复、队列 100 项、最多 5 次远端尝试。期限是本桥策略，不是飞书的被动回复窗口。
- 不确定的回复 ACK、5xx、损坏响应或中断发送进入 `uncertain`，不自动重发；MCP 事件按稳定 event ID 有界重试。

服务端提示和工具说明不构成对 dot 其他工具的权限隔离。飞书文字只作为数据；付款、删除、外部写入、凭据或记忆导出等请求仍回 ChatGPT 取得明确确认，并需在那里配置相应权限。

## 配置与服务

正式 Secure MCP Tunnel 单飞书拓扑为：原 dot → 原官方 Tunnel → `@dot-bridge/core` 聚合器 → 飞书 live 后端；本仓库 `scripts/run-tunnel-router.js` 只注册飞书适配器，不需要 QQ readiness 进程。正式入口与受保护配置见 [公共组件](docs/core.md) 和 [部署](docs/deployment.md)。

下列 `npm start` / OAuth 说明保留为兼容 HTTP 服务路径，不能替代上述 Tunnel live 入口。先读 [真实接入清单](docs/activation.md)，在获准的秘密存储中填入配置后运行：

```powershell
Copy-Item .env.example .env
npm.cmd start
```

空模板是 `AUTH_MODE=deny` / `LARK_TRANSPORT=disabled`；没有合法 `STORAGE_KEY` 时拒绝启动。`dev` 仅允许 loopback 合成测试且禁用真实长连接。兼容 HTTP 服务使用 `oauth` + `long-connection`，验证已有发行方的 RS256 JWT，不创建 OAuth 服务或账户。官方 Tunnel live 路径使用 `AUTH_MODE=tunnel-service` + `BRIDGE_MODE=tunnel` + `TUNNEL_SERVICE_OPERATION=live`，聚合器和后端只监听 loopback。

| 接口 | 用途 |
| --- | --- |
| `POST /mcp` | MCP 2.0 工具、事件发现、订阅和撤销，必须鉴权 |
| `GET /.well-known/oauth-protected-resource/mcp` | OAuth 资源元数据，仅 OAuth 模式提供 |
| `GET /healthz` | 进程存活；200 不代表真实互通 |
| `GET /readyz` | 配置、有订阅、SDK 连接状态；不证明 dot 已回答 |

`npm.cmd run status` 只读现有数据库的数量与状态，不输出正文、秘密或回调地址。它不是管理 API。
`npm.cmd run doctor` 默认只读脱敏配置状态，无真实凭据也能指出缺项。配对完成的私有文件可用 `LARK_CREDENTIALS_FILE` 挂载；与环境身份冲突时拒绝启动。

## 交付与依赖

- [架构](docs/architecture.md)、[安全边界](docs/security.md)、[协议核实](docs/protocol.md)。
- [真实接入](docs/activation.md)、[云端托管与操作](docs/deployment.md)。
- [registerApp 扫码/配对向导](docs/register-app.md)、[最少授权](docs/authorization.md)、[官方认证选择](docs/auth-decision.md)：代码可供审核，扫码实测与尚未通过的 WSS 诊断见验证记录。
- `npm.cmd run handoff`：从干净的本地固定提交导出源码 ZIP 与 SHA-256 清单；排除秘密、数据与依赖目录。启动说明见 [云端交接](docs/handoff.md)。
- `plugin/`：远程地址为 `.invalid` 的手动接入模板，尚未安装或发布。
- `Dockerfile`：非 root 常驻容器及持久卷模板，尚未构建或部署。

最终要摆脱用户电脑在线，需要真正的常驻云进程、持久磁盘、TLS 入口、出网和秘密管理，以及当前 dot 可用的插件/事件订阅。不是静态托管或短时函数。费用、供应商、发行方及真实身份仍需主线程确认。

通用设计的历史来源是 QQ 原型固定提交 `3578dd0bbc3c3fca12c610fb23c14d13ef77a193`；这项来源记录不是运行时依赖。本分支公共实现来自独立 `dot-bridge-core` 发行包，当前固定版本、源码 revision 与包校验记录见 [公共组件](docs/core.md)。仓库原有 [MIT LICENSE](LICENSE) 保持不变，来源与依赖见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

官方参考：[OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events)、[飞书 Node SDK](https://github.com/larksuite/node-sdk)。官方协议支持此桥接方式；账户开通、当前 dot 的实际订阅位置和模型行为仍须真实联调验收。

Windows 原生私有文件、数据库和模式锁使用 [core 安全平台层](docs/core.md)。Windows 需要已有 Python 与本地 NTFS；Linux 原有分支保留。历史 Windows 离线结果不代表当前分支、Linux 或真实 dot 消息验收。本次文档核对未运行仓库代码；历史结果与当前待验证项分列于 [验证记录](docs/validation.md)。
