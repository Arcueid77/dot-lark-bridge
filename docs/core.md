# 独立安装与公共组件

飞书源码不再依赖 QQ 仓库、同级目录或 QQ readiness 后端。公共实现的唯一
源码仓库是 `dot-bridge-core`，本仓库通过固定版本的 `@dot-bridge/core` 包使用。
`vendor/dot-bridge-core-0.2.1.tgz` 是该版本的发行包，不在这里维护另一份公共源码。
lockfile 固定其版本和 SHA-512 integrity；安装时不需要克隆 core 仓库。

本次只读核对的分支代码基线为 `e05502e8f58b76922029f4db97276684f577357b`。
`vendor/core-release.json` 记录包版本 `0.2.1`、core 源码 revision
`fac9d7d05b6c0a5da20411d20963af5eb9c456fc` 和发行包 SHA-256
`3f1c77376002432ebc748e4f32eeb559684b93a812c85e29cb0e16e43f02842a`。
这些是仓库中的发行元数据，本次文档核对未解包、重新计算包 hash 或运行安装/测试。

```sh
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm run check
npm test
```

core 包提供严格 callback 传输、私有文件保护、平台模式锁，以及注册渠道的
loopback MCP 聚合路由器。平台保护和 callback 安全规则保留；安装不会创建
密钥、订阅、飞书应用或 Tunnel，也不读取私有配置。Windows 使用已有受信任
Python 与本地 NTFS，Linux 保留 descriptor-relative 文件校验。

飞书的工具/事件 schema、上下文、群聊规则、卡片、表情和媒体协议由
`src/tunnel-contract.js` 与 `src/tunnel-adapter.js` 持有。core 不导入飞书或 QQ
SDK；启动入口在代码中显式注册受审查的适配器，不能从环境或请求加载任意模块。
`src/network.js` 从 `@dot-bridge/core/transport` 使用公共 callback 传输；
`src/bridge-mode.js` 使用 core 平台模式锁；`scripts/run-tunnel-router.js`
从 `@dot-bridge/core/router/main.js` 启动聚合器并注册本仓库的 `larkAdapter`。
独立包架构不会改变默认本人私聊策略；增强交互与获批群的启用条件见
[聊天体验](chat-experience.md)。

## 单飞书拓扑

原 dot → 原官方 Secure MCP Tunnel → core 聚合器 → 飞书 live 后端。
聚合器入口属于本仓库：

```sh
node --env-file=/受保护路径/router.env scripts/run-tunnel-router.js --confirm-live
node --env-file=/受保护路径/lark.env scripts/run-tunnel-live.js --confirm-live-owner-bridge
```

聚合器环境仅配置 `AUTH_MODE=tunnel-service`、`BRIDGE_MODE=tunnel`、
`TUNNEL_SERVICE_OPERATION=live`、`TUNNEL_CHANNELS=lark`、
`TUNNEL_LIVE_CHANNELS=lark`、固定本地 owner、loopback host/port、
`TUNNEL_SERVICE_KEY_FILE`、`LARK_SERVICE_KEY_FILE` 和 `LARK_MCP_PORT`。
只需要聚合器与飞书两个相互独立的 service key；原 QQ key 可受保护保留供回滚，
但新服务不读取它。QQ 配置字段会拒绝，不能用 disabled 标记掩盖依赖。

官方 Tunnel 的单个 MCP target 和 aggregate key file 引用保留。数据库路径、
STORAGE_KEY、主人绑定、群规则、有效订阅、队列、去重及 uncertain 状态保留。
切换前优雅停旧消费者并确认退出，禁止同时启动两个飞书消费者。

新增 IM 提供自己的 trusted adapter 和后端，使用 core 公共接口注册渠道；
`TUNNEL_CHANNELS` 选择实际部署的渠道，live 集合只能是它的子集。
未部署渠道不需要源码、凭据、端口或 readiness 进程。

## 升级、验证和回滚

更新 core 需要生成新版本发行包，并让消费仓库一起更新锁文件；禁止覆盖
已经发布的同名版本。保留 core Git revision、发行包 hash 和飞书 Git revision。
独立验证应解压飞书提交到没有 QQ/core 源码仓库的目录，运行锁定安装和完整测试。
`test/standalone-router.test.js` 必须实际运行，不能因缺少兄弟路径而 skip。
该文件已有不依赖 QQ 后端的合成集成场景；存在测试源码不等于本次执行通过。
历史测试与本分支待验证清单见 [validation.md](validation.md)。

离线回归不代表原 dot 已订阅、飞书网关已连接或真实消息已回复。切换后的验收
仍需检查 authenticated catalogs、官方 Tunnel、有效订阅、网关和同一原聊天的回复。
回滚使用切换前的固定提交、依赖包、私有配置和 systemd 单元；保留当前数据库，
不要用旧数据库覆盖切换后收到的消息。存在 incompatible schema 时先停机评估。
