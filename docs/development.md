# 开发说明

[简体中文](development.md) | [English](development.en.md) | [首页](../README.md)

日常安装和操作只需[部署](deployment.md)、[功能配置](configuration.md)和[运行排错](troubleshooting.md)。本页面向修改代码的维护者；下文保留必要的设计约束与验证范围。已完成交接通过 Git 历史追溯。

## 仓库职责

| 部分 | 位置与职责 |
| --- | --- |
| 共享实现 | [dot-bridge-core](https://github.com/AvaloNero/dot-bridge-core)：callback 传输、私有文件/平台锁、注册渠道聚合器 |
| 本 IM 适配器 | `src/tunnel-adapter.js`、`src/tunnel-contract.js`：本渠道工具、事件及协议 |
| 平台与业务 | 本仓库 `src/`：SDK/网关、身份校验、持久队列、受限回复、体验 |
| 单渠道入口 | `scripts/run-tunnel-router.js` 只注册本仓库适配器 |
| 固定发行包 | `vendor/core-release.json`、`vendor/*.tgz`、lockfile 共同记录版本、源码 revision 与 integrity |

core 不导入各 IM 的 SDK；新增渠道应持有自身适配器并使用公共接口，不复制一份共享实现。固定包可独立部署，安装不需 core 或其他 IM 源码。修改 core 时发布新的不可变版本并更新消费者的包、元数据与锁文件，不能覆盖同名版本。

旧 QQ 原型仅是来源记录；当前飞书部署和测试不需要 QQ readiness 后端。

## 必须保留的约束

- 持久提交后才 ACK；入站身份、订阅代次、期限、去重、租约和回复状态都在服务端校验。
- 工具按已核验的源消息定位原会话，不开放任意收件人或 URL；同一入站最多一个逻辑回答。
- HTTPS、公网 DNS/IP 固定、原域名 TLS 校验和禁止重定向；代理无法满足策略时拒绝，不偷偷回退。
- 认证/回调、平台请求和可选 Sites 路径各有边界。runtime key 不是外部用户身份，`clientInfo` 不是认证。
- 回复处理中崩溃或 ACK 不明进入 uncertain，禁止自动重发。订阅撤销/过期立即限制后续读取、入站和发送。
- 不记录凭据、身份、正文或完整地址；SQLite 只加密载荷与部分秘密，元数据和去重 ID 仍依赖私有磁盘保护。
- 同机模式锁不提供跨主机互斥。普通常驻服务不使用有限窗口/依赖 stdin 的开发监督器。

协议依据见[来源声明](../THIRD_PARTY_NOTICES.md)，共享实现以 core 为准。OAuth 兼容路径验证既有发行方 RS256/JWKS；Sites 是另行授权和验证的模式，不作为 Tunnel 失败后的自动降级。

## 已记录的验证范围

2026-10-15 的独立 Windows 修复工作树验证使用 Node 24.15.0、本地 NTFS、OpenSSL 3.5.6 和 core 0.2.1；不含 QQ/core 源码 checkout。

| 范围 | 结果与限制 |
| --- | --- |
| 锁定安装、check、simulate | 通过；模拟包含官方 SDK dispatcher、本地 MCP、签名事件和一次合成原会话回复 |
| 完整测试 | 275 项：260 通过、0 失败、15 跳过 |
| 跳过原因 | 10 项 Linux 私有文件检查、5 项 Linux POSIX 交接报告器；并非 Windows 凭据保护失效 |
| 独立 router | 实际执行通过，无缺少 QQ 兄弟仓库导致的跳过 |
| 证据边界 | 该次记录不包括更新后的 Linux 回归、Docker 构建/运行、服务切换或新的真实消息验收 |

本次文档精简未重跑这些完整套件。飞书网关、原 dot 订阅以及卡片/媒体/群规则的实际启用和用户可见效果仍需目标实例的独立证据；上述离线结果不能替代。详细历史记录可从 Git 找回。

## 验证和提交

在不含其他 IM/core 源码的独立目录执行：

```sh
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run simulate
```

`test/standalone-router.test.js` 必须实际执行，不能因缺少兄弟仓库而跳过。 对共享实现的修改应在 core 仓库运行相应测试。记录精确 SHA、OS、Node、通过/失败/跳过/未运行；Windows 结果不能替代 Linux，合成结果不能替代真实消息验收。

文档以中文主文件和同目录 `.en.md` 成对维护。首页只链接四份现行指南；同一流程只维护一处。`docs/languages.json` 列出当前双语文件，`npm run check` 检查覆盖、切换链接及本地链接。完成的交接和被替代的说明直接删除，需要时从 Git 历史恢复。

PR 先确认变更范围、通过适用检查并更新描述。希望保留普通提交且避免额外 merge commit 时，选择 **Rebase and merge**：

```sh
gh pr merge PR_NUMBER --rebase
```

若只需保留一个整理后的功能提交，可选择 **Squash and merge**。不要选择 Create a merge commit。合并前需要解决冲突并按仓库规则完成检查；已发布主干的历史重写须单独明确授权，并保留回滚引用及精确旧 SHA 保护。
