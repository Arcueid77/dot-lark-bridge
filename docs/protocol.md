# 官方协议核实

以下官方资料核实记录日期：2026-10-02；本次文档更新没有重新联网核实官方协议或执行 SDK 测试。当前独立包与代码能力边界见 [core.md](core.md)、[chat-experience.md](chat-experience.md)，历史测试及待验证项见 [validation.md](validation.md)。

核实日期：2026-10-02。OpenAI 官方页面、飞书 SDK README、安装的 1.74.0 SDK 实现和类型声明均已检查。飞书网页依赖前端渲染，抓取正文为空的部分由官方 SDK 生成接口定义补充核对；没有把空网页或 search snippet 当作完整接口契约。

## OpenAI

本服务按 [MCP Events](https://developers.openai.com/plugins/build/mcp-events) 实现 `2026-07-28`、`server/discover`、`events/list/subscribe/unsubscribe` 和 webhook 回调验证。它保存订阅、签名密钥与期限；投递使用 Standard Webhooks HMAC，事件 ID 稳定，正文一次序列化。只支持 webhook，`cursor=null`，没有历史重放能力。

MCP 请求须同时带 `_meta` 中的协议版本/client capabilities 与相符 HTTP `MCP-Protocol-Version` / `Mcp-Method`，tool call 另须 `Mcp-Name`。响应使用 `resultType=complete`。本服务不是旧版 initialize/session 服务，没有 SSE 事件订阅模式；事件由独立 HTTPS POST 交付。需在目标客户端实测当前 MCP 2.0 支持。

兼容 OAuth HTTP 路径的认证由已有发行方负责；官方 Tunnel live 路径使用受保护 service key 与固定本地 owner，配置见 [core.md](core.md)。[OpenAI Authentication](https://developers.openai.com/plugins/build/auth) 描述资源发现、authorization code + PKCE 与客户端注册要求；本桥只做 RS256 JWT 资源验证，不提供授权页、token endpoint、client registration 或刷新 token。

`plugin/plugin.json` 与 `plugin/mcp.json` 是 [官方 portable plugin 包结构](https://developers.openai.com/plugins/build/plugins) 的模板；后续真实连接按 [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt) 验收。模板未安装、扫描或发布。

## 飞书

依赖固定为 [官方 larksuite/node-sdk](https://github.com/larksuite/node-sdk) 的 `@larksuiteoapi/node-sdk@1.74.0`；lockfile 固定依赖版本及 integrity。使用 `WSClient`。默认兼容模式仅处理本人私聊文字；本仓库另有可选附件、群聊和卡片实现，启用条件见 [chat-experience.md](chat-experience.md)，不应把默认模式当作全部能力上限。长连接的认证属于应用连接，后续推送不另外套用 QQ 验签算法。

| 官方接口 / SDK 路径 | 本服务使用 |
| --- | --- |
| `WSClient` / `EventDispatcher` | 自建飞书应用、自动重连、`im.message.receive_v1` |
| `/callback/ws/endpoint` | 仅官方 SDK 连接发现；AppID/Secret，不输出返回的 WSS URL |
| `auth.v3.tenantAccessToken.internal` → `POST /open-apis/auth/v3/tenant_access_token/internal` | body 为 `app_id/app_secret`；`tenant_access_token/expire` 缓存在内存 |
| `im.v1.message.reply` → `POST /open-apis/im/v1/messages/:message_id/reply` | 默认 text/content、`reply_in_thread=false`、稳定 `uuid`；获批群策略可选择线程回复，收件人始终由原消息决定 |

按 SDK 的 V2 envelope 路径，原始 `header` 包含 `app_id/tenant_key/event_id/event_type/create_time`；handler 由 SDK 合并 header 与 event 后接收。`message.create_time` 使用毫秒字符串，sender `open_id` 是应用内身份。本桥同时检查 header 和 sender 的 tenant。

发送依据 [回复消息接口](https://open.feishu.cn/document/server-docs/im-v1/message/reply?lang=zh-CN)，接收依据 [接收消息事件](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive?lang=zh-CN)。本服务使用严格受限的 HTTPS requester 调用应用 token 与原消息 reply 端点，以控制跳转、授权复查和不确定发送重试；可选增强交互另使用 `src/lark-interactions-api.js` 中的资源、表情、引用及 CardKit 接口，所需权限见 [chat-experience.md](chat-experience.md)。不使用用户 access token。

SDK 长连接处理应尽快返回；服务在 3 秒目标内只做同步校验与有界事务，不等待 dot。集群推送不是广播，因此原型部署一个实例，不能把两个独立数据库的客户端当作高可用。SDK handler 抛错会使其发送 error ACK；历史自动测试记录包含调用 SDK `handleEventData` 验证这一行为，未建立真实 WebSocket；本次未重跑。

上述历史核实记录没有完成飞书应用可用范围、权限批准、重投期限、消息 UI 位置及境外 Lark 支持的账户联调；目标实例仍需独立证据。本版只允许飞书域名，不声明通用于 Lark 国际版。900 秒 reply deadline 是本地过期策略，不能照搬 QQ 的被动回复窗口。
