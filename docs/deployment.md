# 部署指南

[简体中文](deployment.md) | [English](deployment.en.md) | [首页](../README.md)

本文是单渠道官方 Secure MCP Tunnel 的现行流程。拓扑为原 dot → 官方 tunnelclient → loopback 聚合器 → 飞书 后端。只克隆本仓库；未部署渠道不需要源码、凭据或 readiness 服务。以下步骤只用于此常驻 Tunnel 拓扑。

## 1. 检查环境并固定源码

选择可长期运行、带本地持久磁盘的 Linux VPS，或具有受支持私有文件保护的 Windows。服务器独立运行后，本地电脑只是管理入口。检查系统、架构、磁盘、已有服务、端口及实际出网；不要覆盖无关服务。

Node 必须 >=24.15 且 <25，使用内置 `node:sqlite`；从官方来源按架构安装，检查 OpenSSL。Windows 另需 Python 3.10+ 和本地 NTFS。macOS 等其他平台的私人 Tunnel 运行尚不受支持；静态托管、休眠实例和短时函数不适用。Docker 模板需独立构建/运行验收。

```sh
git clone https://github.com/AvaloNero/dot-lark-bridge.git
cd dot-lark-bridge
git fetch origin
git checkout --detach REVIEWED_COMMIT_SHA
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run simulate
```

用核验过的完整 SHA 替换占位值，保留 `vendor/`、lockfile 和发行元数据。QQ 可再运行 `npm run simulate:gateway`。分别报告通过、失败和平台跳过；这些测试不建立真实连接。

## 2. 准备运行用户与私有路径

Linux 使用专用非 root 用户，例如 `dot-bridge`，源码放 `/opt/dot-bridge/dot-lark-bridge`。先由管理员创建下列私有目录并设置最终运行用户为属主；叶目录 0700、文件 0600、普通单链接文件，拒绝符号链接/硬链接。Windows 使用所有者/SYSTEM 私有 DACL；不要用放宽权限绕过校验。

| 路径示例 | 内容 |
| --- | --- |
| `/var/lib/dot-bridge/private/lark/credentials.json` | 平台凭据及已核验主人绑定 |
| `/var/lib/dot-bridge/private/lark/storage-key` | 独立持久数据加密密钥 |
| `/var/lib/dot-bridge/private/lark/service-key` | 后端 service key |
| `/var/lib/dot-bridge/private/tunnel/aggregate-service-key` | 独立聚合器 key |
| `/var/lib/dot-bridge/private/tunnel/` | 官方 runtime key 与私有 profile |
| `/var/lib/dot-bridge/private/lark.env`、`router.env` | 后端与聚合器的独立配置 |
| `/var/lib/dot-bridge/lark/`、`/var/lib/dot-bridge/locks/` | 数据库、SQLite 侧文件和同机锁 |

三个本地 key（storage、后端、聚合器）彼此独立；每个为 32 个随机字节的规范 base64url 编码，即 43 个 ASCII 字符，无换行。获准后通过受保护流程生成或迁入，不在命令参数、聊天或日志显示。runtime key 是官方 Tunnel 凭据，不能替代这三个 key，也不证明外部用户身份。

迁移原库要保持 STORAGE_KEY、身份、队列、订阅、去重及 uncertain；用一致性备份或停机完整备份。若决定全新开始，先明确队列和去重丢失影响。开始消费前确认旧主机的消费者及重复 Tunnel 已停止；同机锁不是跨主机互斥。

## 3. 完成平台授权和本人绑定

优先复用已有飞书应用，核对 AppID、tenant、主人应用内 open_id，并在控制台启用机器人、`im.message.receive_v1` 长连接和应用发布。基础私聊需要 `im:message.p2p_msg:readonly`、`im:message:send_as_bot`；增强权限见功能配置。

已有应用扫码保存入口如下。它会更新官方确认页中列出的应用配置，需先批准权限差异及凭据保存：

```sh
node scripts/enroll-existing.js APPROVED_APP_ID VERIFIED_TENANT_KEY /var/lib/dot-bridge/private/lark/registered.json --confirm-existing-app-scan --confirm-private-storage
node scripts/setup.js pair --credentials /var/lib/dot-bridge/private/lark/registered.json --binding /var/lib/dot-bridge/private/lark/credentials.json --confirm-bind
```

第一条的专用注册传输目前要求已批准且可用的 HTTPS 代理；没有代理时会拒绝，正式运行的直连能力不等于此脚本支持直连。可以在获批代理环境完成 enrollment，再经批准安全迁移文件。已有有效文件则复用，不重复扫码；不得套用旧云电脑代理地址。

配对只接受已核验主人发送的短期口令，按提示在原私聊发送完整文字。若 SDK 未返回主人 open_id，先核实身份，再附加 `--owner-open-id`。不能从第一位发言者推断主人或伪造 tenant/chat。tenant 未核实时可 enrollment 为 unbound，但该文件不能启动 live；经官方来源确认后才用下面的身份导入及配对完成绑定。


已有 unbound 文件无需重新扫码。操作者审查官方来源并取得主人对 app/tenant/open_id 的准确确认后，准备受保护的证据 JSON：必须包含 `version:1`、`source:operator-reviewed-official-source`、24 小时内的 `verifiedAt`、`appId`、`tenantKey`、`ownerOpenId` 及分别相等的 `confirmedAppId`、`confirmedTenantKey`、`confirmedOwnerOpenId`。`sourceUrl` 必须是 `open.feishu.cn` 或 `accounts.feishu.cn` 的干净 HTTPS 地址，无凭据、端口、查询或 fragment。这是操作者核验记录，不是自动认证；与扫码主人冲突时拒绝。

```sh
node scripts/import-verified-identity.js PRIVATE_UNBOUND PRIVATE_EVIDENCE NEW_PRIVATE_REGISTERED --confirm-verified-owner-binding
```

命令只写入一个新的 registered 文件，不覆盖原文件、不连接或发送；随后使用前面的 pair 命令完成原私聊绑定。

没有应用时，`node scripts/setup.js register --credentials NEW_PRIVATE_FILE --tenant-key VERIFIED_TENANT_KEY --confirm-create-app` 是另行批准的新建流程。真正的飞书扫码、权限确认、控制台启用及本人配对都需要人参与。

## 4. 分别配置后端和聚合器

以下均为占位配置，应在私有环境文件填写。不要从旧 OAuth `.env.example` 直接复制所有字段，混合身份和模式会被拒绝。

后端 `lark.env`：

```dotenv
AUTH_MODE=tunnel-service
BRIDGE_MODE=tunnel
TUNNEL_SERVICE_OPERATION=live
TUNNEL_SERVICE_OWNER_ID=tunnel-owner:dot-bridge
HOST=127.0.0.1
PORT=8788
TUNNEL_SERVICE_KEY_FILE=/var/lib/dot-bridge/private/lark/service-key
LARK_TRANSPORT=long-connection
LARK_EXPECTED_APP_ID=APPROVED_APP_ID
LARK_CREDENTIALS_FILE=/var/lib/dot-bridge/private/lark/credentials.json
STORAGE_KEY_FILE=/var/lib/dot-bridge/private/lark/storage-key
DATABASE_PATH=/var/lib/dot-bridge/lark/bridge.sqlite
BRIDGE_LOCK_DIRECTORY=/var/lib/dot-bridge/locks
CALLBACK_TRANSPORT_MODE=standard
MCP_CALLBACK_ALLOWED_HOSTS=
```

聚合器 `router.env`：

```dotenv
AUTH_MODE=tunnel-service
BRIDGE_MODE=tunnel
TUNNEL_SERVICE_OPERATION=live
TUNNEL_SERVICE_OWNER_ID=tunnel-owner:dot-bridge
TUNNEL_CHANNELS=lark
TUNNEL_LIVE_CHANNELS=lark
HOST=127.0.0.1
PORT=8789
TUNNEL_SERVICE_KEY_FILE=/var/lib/dot-bridge/private/tunnel/aggregate-service-key
LARK_SERVICE_KEY_FILE=/var/lib/dot-bridge/private/lark/service-key
LARK_MCP_PORT=8788
```

端口仅作示例，先检查冲突；所有 MCP 监听仅 loopback。聚合器不加载平台凭据、存储密钥或数据库。单渠道只需要聚合器和该后端两个 service key。

callback 白名单初始留空时可以检查目录，但不能接收消息。真实地址必须来自原 dot 的订阅流程，再按核验过的精确主机名配置；不猜完整 URL、不使用通配符。直连环境使用 `CALLBACK_TRANSPORT_MODE=standard`；必须使用代理的环境要有实际受支持的 callback adapter，不能关闭必要代理或设置假的“已验证”开关。

## 5. 安装常驻服务并连接原 dot

以下为 Linux 后端 unit 模板。把 `/ABSOLUTE/NODE` 换为实际 Node 绝对路径，保存为 `dot-bridge-lark.service`：

```ini
[Unit]
Description=dot bridge lark backend
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=dot-bridge
Group=dot-bridge
WorkingDirectory=/opt/dot-bridge/dot-lark-bridge
ExecStart=/ABSOLUTE/NODE --env-file=/var/lib/dot-bridge/private/lark.env scripts/run-tunnel-live.js --confirm-live-owner-bridge
Restart=on-failure
RestartSec=5
TimeoutStopSec=180
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

聚合器另设 `dot-bridge-router.service`：同样使用运行用户、工作目录及停止宽限，`ExecStart` 改为 `/ABSOLUTE/NODE --env-file=/var/lib/dot-bridge/private/router.env scripts/run-tunnel-router.js --confirm-live`，并设置 `After=network-online.target dot-bridge-lark.service`。官方 tunnelclient 单独作为服务，按已安装版本支持的真实命令配置，排在聚合器之后；不要猜参数或沿用有限运行窗口。

普通常驻服务不设置 `DOT_BRIDGE_SUPERVISED=1`，也不依赖 SSH/stdin。管理员检查 unit 后执行 `systemctl daemon-reload` 并启用服务。Windows 需使用能在注销后继续运行且正确优雅停止的服务管理方式，不能把交互终端当作后台服务。

官方客户端只保留一个目标 Tunnel 实例、一个指向聚合器的 MCP target。`X-Dot-Bridge-Service-Key` 必须通过客户端支持的 `file:` 引用聚合器 key。runtime key 和 profile 由受批准的官方流程准备；检查账户、原 Tunnel、客户端版本及实际启动命令。Tunnel Use 仅限本部署主人，不以 runtime key 充当逐用户认证。

在原 dot 上刷新同一插件，检查工具和 `lark.message.created` 事件；建立一个 `{"conversation":"owner"}` 订阅，callback 签名资料由真实流程保存。飞书启用获批群时按功能指南切换为 `configured`。签名 challenge 成功、唯一订阅有效之后，后端才连接平台网关。默认配置下订阅最多 24 小时，由原 dot/平台按 `refreshBefore` 续订；本桥没有另建自动续订任务。

## 6. 人工参与和实际验收

需要人处理的事项集中在：选择应用及运行环境、批准长期凭据/权限/存储、本人扫码或配对、确认旧消费者停止、在原 dot 建立订阅，以及查看原聊天中的真实回复。确认参数只记录既有批准，不替用户授予权限。

分层检查依赖/测试 → 服务存活 → 本地鉴权和目录 → Tunnel → 有效订阅 → 平台网关 → 原聊天收到一次回答。后台 callback 2xx、目录可见或 gateway connected 都不等于端到端完成。请本人发普通消息，再试连续消息和优雅重启，核对无重复及状态保持；SSH 断开后再验一次。整台服务器重启另行安排。运行、备份和回滚见[运行与排错](troubleshooting.md)。
