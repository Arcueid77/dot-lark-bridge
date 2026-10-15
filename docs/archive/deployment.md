# 常驻云端部署与操作

> 历史归档 / Historical archive: 保留原始语言及当时的适用范围，不作为当前部署指南。
> This record retains its original language and dated scope. Start with the [current guide](../deployment.en.md) / [现行指南](../deployment.md).


官方 Secure MCP Tunnel 的正式入口为 `scripts/run-tunnel-live.js --confirm-live-owner-bridge`，
使用 `AUTH_MODE=tunnel-service`、`BRIDGE_MODE=tunnel`、`TUNNEL_SERVICE_OPERATION=live`、
`TUNNEL_SERVICE_OWNER_ID=tunnel-owner:dot-bridge`、`LARK_TRANSPORT=long-connection`。
配对凭据、独立 service key、STORAGE_KEY、数据库和锁均使用受保护文件/目录。
聚合器和飞书后端只监听 loopback；未部署渠道无需后端。持续运行服务使用普通非 root systemd，
不设 `DOT_BRIDGE_SUPERVISED=1`，不把 stdin、SSH 或诊断窗口当作监督器。
飞书新体验和群聊升级见 [chat-experience.md](chat-experience.md)。升级保留原状态，
先固定飞书 SHA 与 core 发行版本、测试、备份，再启动；离线结果和真实实例验收分别记录。

下文的 OAuth、反向代理、Sites 与 run-service 示例为其他历史部署方式，
不能替代本次 Tunnel live 入口，也不能作为已部署或已验收的结论。

最终运行位置应是获批准的单实例云 VM 或持续运行的容器服务。需要持续进程/CPU、稳定 HTTPS MCP 入口、出站 WSS 与 HTTPS、持久卷、TLS 和秘密管理。停止用户电脑不能影响云实例。静态网站、请求结束就冻结的函数和会休眠的实例不满足要求；本次未选择供应商或产生费用。

固定提交源码 ZIP/SHA-256、Node/SQLite/worker 启动方式和 systemd 审核模板见 [handoff.md](handoff.md)。官方认证选择与安全隧道的边界见 [auth-decision.md](auth-decision.md)。

## 发布前准备

- 审批供应商、地区、数据存储/备份范围、预算、OAuth 发行方和身份绑定；完成 [activation.md](activation.md)。
- Docker 模板使用 Node 24；正式发布前锁定获审核镜像 digest。`package-lock.json` 固定 SDK 与传递依赖；构建使用 `npm ci --omit=dev --ignore-scripts`。
- 以非 root 用户运行，`DATABASE_PATH=/data/bridge.sqlite` 挂独占可写持久卷，严格限制卷 ACL；秘密从独立 secret store 注入，不进镜像、构建参数或仓库。
- 在反向代理提供 `PUBLIC_ORIGIN` 对应 HTTPS，保留原 Host。后端仅允许代理访问，不能公开裸 3000 端口；不要记录 Authorization 或请求正文。
- 允许出网至飞书、已审批的 callback 域名与发行方 JWKS；确认 DNS 返回公网地址，TLS 正常。WSS 在每次连接时重新检查 DNS，SDK 处理 TLS 和重连。
- 一个实例、一份数据库。不能将两个独立卷的 SDK 客户端做负载均衡；SQLite 网络共享盘和多机高可用不属于本原型。

容器模板提供 `/healthz` 存活探测，`/readyz` 还要求有效订阅和 SDK connected；未有订阅时 503 属于预期接入状态。它们都不验证模型已回答、飞书 UI 已收到或用户已读。SDK permanent failure 需监控、修正凭据/配置后由操作者重启。

## 启停与恢复

用平台 supervisor 自动恢复进程，留出至少 45 秒优雅停止时间。SIGTERM 停止 SDK 重连及接收、暂停 worker，等待当前 timer worker 后关闭数据库。不要在正在发送时直接销毁卷。

进程恢复后，event lease 到期可按原 event ID 重投；reply processing lease 到期变 uncertain。pending 回复继续前复查原身份、subscription generation、期限和服务端路由。不得把 uncertain 改成 pending，或用新 UUID 重发原消息。

脱敏状态检查：

```powershell
npm.cmd run status
```

命令只读现有数据库并输出数量/状态，不需要解密正文。不应将数据库下载到公共位置或在错误排查中转发完整环境。

先在 ChatGPT 停止订阅并核对 cancelled。紧急断开可先停服务；或者保持原身份元组，以 `AUTH_MODE=deny` / `LARK_TRANSPORT=disabled` 重启，再处理飞书应用与发行方授权。已经上网的发送无法撤回，随后确认 ACK 会记录 sent。

## 备份与保留

SQLite WAL 不能只复制正在写入的单个主文件。使用 SQLite 一致性备份，或优雅停机后备份主库及必要 WAL；备份存储密钥应单独保护。恢复必须带原身份配置与原 STORAGE_KEY；数据库拒绝换身份和换 key。

正文/回答默认 7 天逻辑清除，永久去重墓碑与统计仍会增长，需监控卷容量。备份、WAL 和旧页可能继续含加密历史；逻辑删除不是物理擦除。长时间中断、未订阅及平台已过重投期限的消息可能丢失，服务不拉聊天历史补齐。

本次未执行 Docker build、云部署、反向代理配置、秘密创建、付费选择、插件安装或用户电脑离线的真实验收。


## 带日志的正式常驻入口

获准服务配置齐备后，使用 `node --env-file=/approved/private/service.env scripts/run-service.js --confirm-persistent-service`（或 `npm run serve -- --confirm-persistent-service`）。入口只接受 OAuth + long-connection，继续要求完整本人绑定、callback 策略及数据库存储密钥。缺项拒绝，不能用诊断握手成功替代这些门槛。systemd 模板指向此入口，但尚未安装/启用服务。

- 记录启动、HTTP 发现、返回地址验证、SDK ready、重连中/已重连、失败、停止阶段；严格只允许已知事件名。
- 每 30 秒输出进程心跳和 SDK 连接状态、订阅存在与否、投递是否可用、重连计数。心跳不是收到飞书 pong 的独立证明。
- `gateway_connected` 仅指飞书传输；`mcp_subscription_active` 指有效订阅；`ready_for_delivery` 需配置、订阅、连接同时满足。`end_to_end_verified` 始终 false，真实同一个 dot 收到并成功回原私聊仍须外部验收。
- 不输出 App ID/Secret、token、owner/chat/tenant ID、消息正文、回调/WSS URL或原始 SDK 错误。SIGINT/SIGTERM 关闭 SDK 重连、worker、HTTP 和数据库。
- 正式服务没有 15/60 秒自动停止，也没有临时扫码脚本的十分钟凭据清除；长期凭据由获批私有挂载管理。断线重连由官方 SDK 管理，不额外创建重试风暴。

## 扫码后直接存入获批私有存储

`node scripts/enroll-existing.js <approved-app-id> <verified-tenant-key> <approved-new-private-file> --confirm-existing-app-scan --confirm-private-storage` 只在两项明确批准齐备后执行。必须是已存在的 0700 私有目录、新的 0600 文件，不覆盖、不跟随 symlink。飞书 Secret 直接从官方响应写入私有文件，不需要用户抄到终端，也不输出到聊天。

这是文件权限保护，不是应用层加密；机器管理员/获权运行账户仍可能读取，云电脑数据是否持久由环境决定。若使用外部 secret manager，须采用已批准、实际可用的导入/挂载流程，不能宣称本仓库已经提供托管秘密库。

扫码成功保存后仍须验证 tenant/owner、本人 p2p 配对生成完整绑定，然后复用正式服务入口。注册脚本不启动短诊断、WSS 或 dot 订阅，也不假定安装/授权的机器人已发布启用。已有获准有效凭据应复用，不为了重新排查而重复扫码。

正式运行现在必须先选 [tunnel 或 sites 模式](modes.md) 并配置同一私有锁目录。上述 OAuth/本地 MCP 要求适用于 tunnel；sites 模式本地 AUTH_MODE=deny、不开 HTTP/MCP，改由获准双凭据与当前用户订阅租约校验。


## 独立源码与容器构建上下文

只需 `dot-lark-bridge` 本仓库，固定版本 core 安装包已在 `vendor/`，lockfile 校验其 integrity。
不需要 QQ 同级 clone、named build context 或第三个未受 Git 管理目录。
常驻单飞书拓扑、聚合器环境及迁移见 [公共组件](core.md)。

```sh
docker build -t dot-lark-bridge .
```

Dockerfile 复制 vendor 包后执行锁定安装，不包含私人凭据。此轮需要的真实部署使用
systemd；镜像构建与容器运行仍需单独验收，不能把源码检查当作镜像已部署。
