# Deployment

[简体中文](deployment.md) | [English](deployment.en.md) | [Home](../README.en.md)

This is the current single-channel official Secure MCP Tunnel workflow: original dot → official tunnelclient → loopback router → Feishu backend. Clone only this repository. Undeployed channels need no source, credentials or readiness service. The steps below cover this persistent Tunnel topology.

## 1. Inspect the host and pin the source

Use a continuously running Linux VPS with local persistent storage, or Windows with supported private-file protection. Once deployed, the local computer is only an administration entry point. Inspect OS, architecture, disk, existing services, ports and actual egress policy; preserve unrelated services.

Node must be >=24.15 and <25, using built-in `node:sqlite`. Install an architecture-compatible official build and check OpenSSL. Windows also requires Python 3.10+ and local NTFS. Private Tunnel operation on macOS and other platforms is not supported. Static hosting, sleeping instances and short-lived functions do not meet the runtime requirements. Docker builds and operation need separate acceptance.

```sh
git clone https://github.com/Arcueid77/dot-lark-bridge.git
cd dot-lark-bridge
git fetch origin
git checkout --detach REVIEWED_COMMIT_SHA
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run simulate
```

Replace the placeholder with a reviewed full SHA. Keep `vendor/`, lockfile and release metadata together. QQ can also run `npm run simulate:gateway`. Report passes, failures and platform skips separately. These tests do not establish a real connection.

## 2. Prepare a runtime user and private paths

On Linux use a dedicated non-root user, for example `dot-bridge`, with source at `/opt/dot-bridge/dot-lark-bridge`. An administrator must create private directories owned by the final runtime user: leaf directories 0700, files 0600, regular files with one link. Symlinks and hardlinks are rejected. Windows uses owner/SYSTEM-only private DACLs; do not loosen access to bypass checks.

| Example path | Contents |
| --- | --- |
| `/var/lib/dot-bridge/private/lark/credentials.json` | Provider credentials and verified owner binding |
| `/var/lib/dot-bridge/private/lark/storage-key` | Independent persistent-data encryption key |
| `/var/lib/dot-bridge/private/lark/service-key` | Backend service key |
| `/var/lib/dot-bridge/private/tunnel/aggregate-service-key` | Independent router key |
| `/var/lib/dot-bridge/private/tunnel/` | Official runtime key and private profile |
| `/var/lib/dot-bridge/private/lark.env` and `router.env` | Separate backend/router settings |
| `/var/lib/dot-bridge/lark/` and `/var/lib/dot-bridge/locks/` | Database, SQLite sidecars and local lock |

The three local keys—storage, backend and router—must be independent. Each contains the canonical base64url encoding of 32 random bytes: 43 ASCII characters, no newline. Generate or migrate them through an approved protected process, never through command arguments, chats or logs. The official Tunnel runtime key is separate; it cannot replace these keys or establish external user identity.

A database migration must retain its STORAGE_KEY, identity, queues, subscriptions, deduplication and uncertain states. Use a consistent backup or a complete stopped-service backup. A fresh start requires an explicit decision about lost queue/deduplication state. Confirm the old host's consumer and duplicate Tunnel are stopped before consuming messages; the local lock is not cross-host fencing.

## 3. Authorize the provider and bind the owner

Prefer the existing Feishu app. Verify AppID, tenant and the owner's app-scoped open_id. Enable its bot, `im.message.receive_v1` long connection and publication in the console. Basic private chat needs `im:message.p2p_msg:readonly` and `im:message:send_as_bot`; optional grants are listed in Configuration.

The existing-app enrollment below updates the app configuration shown on the official confirmation page. Approve the permission differences and persistent storage first:

```sh
node scripts/enroll-existing.js APPROVED_APP_ID VERIFIED_TENANT_KEY /var/lib/dot-bridge/private/lark/registered.json --confirm-existing-app-scan --confirm-private-storage
node scripts/setup.js pair --credentials /var/lib/dot-bridge/private/lark/registered.json --binding /var/lib/dot-bridge/private/lark/credentials.json --confirm-bind
```

The dedicated registration transport in the first command currently requires an approved working HTTPS proxy. Without one it refuses; direct connectivity in the persistent runtime does not make this helper direct-capable. Enrollment can run in an approved proxy environment, followed by an approved secure file transfer. Reuse valid files instead of rescanning. Never copy an old cloud computer's proxy address blindly.

Pairing accepts only a short-lived challenge sent by the already verified owner in the original private chat. If the SDK did not return their open_id, verify it and supply `--owner-open-id`. Never infer the owner from the first sender or invent tenant/chat values. Enrollment can remain unbound when the tenant is unknown, but cannot run live until official identity verification, import and pairing complete. Use the verified import below before pairing.


Do not rescan when an approved unbound file already exists. After reviewing an official source and obtaining the owner's exact app/tenant/open_id confirmation, prepare private evidence JSON containing `version:1`, `source:operator-reviewed-official-source`, `verifiedAt` within 24 hours, `appId`, `tenantKey`, `ownerOpenId` and matching `confirmedAppId`, `confirmedTenantKey`, `confirmedOwnerOpenId`. `sourceUrl` must be a clean HTTPS URL at `open.feishu.cn` or `accounts.feishu.cn`, without credentials, a port, query or fragment. This is an operator attestation, not automatic authentication; a scanning-owner mismatch is rejected.

```sh
node scripts/import-verified-identity.js PRIVATE_UNBOUND PRIVATE_EVIDENCE NEW_PRIVATE_REGISTERED --confirm-verified-owner-binding
```

The command writes one new registered file without overwriting the original, connecting or sending. Complete the original private-chat binding with the pair command above.

For a new app, `node scripts/setup.js register --credentials NEW_PRIVATE_FILE --tenant-key VERIFIED_TENANT_KEY --confirm-create-app` is a separately approved creation flow. Scanning, grant review, console activation and owner pairing require human participation.

## 4. Configure backend and router separately

These are placeholders for private environment files. Do not copy every field from the old OAuth `.env.example`; mixed identities and modes are rejected.

Backend `lark.env`:

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

Router `router.env`:

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

Check ports for conflicts; all MCP listeners bind only loopback. The router loads no provider credentials, storage key or database. A single channel needs two service keys: router and backend.

An initially empty callback allowlist permits catalog inspection but blocks messages. Obtain the actual callback through the original dot's subscription flow, then configure only the reviewed exact hostname. Never invent URLs or use wildcards. Direct-capable hosts use `CALLBACK_TRANSPORT_MODE=standard`. Required-proxy environments need a supported callback adapter; do not disable a necessary proxy or assert verification with an environment flag.

## 5. Install persistent services and connect the original dot

This is a Linux backend unit template. Replace `/ABSOLUTE/NODE` with the actual absolute Node path and save as `dot-bridge-lark.service`:

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

Create a separate `dot-bridge-router.service` with the same runtime user, working directory and stop grace. Set `ExecStart` to `/ABSOLUTE/NODE --env-file=/var/lib/dot-bridge/private/router.env scripts/run-tunnel-router.js --confirm-live` and `After=network-online.target dot-bridge-lark.service`. Run official tunnelclient as its own service after the router, using a command supported by the installed version. Do not guess client flags or reuse finite diagnostic windows.

Ordinary persistent services must not set `DOT_BRIDGE_SUPERVISED=1` or depend on SSH/stdin. After inspecting the units, an administrator runs `systemctl daemon-reload` and enables the services. Windows needs service management that survives logout and stops gracefully; an interactive terminal is insufficient.

Keep one instance of the intended official Tunnel and one MCP target pointing to the router. `X-Dot-Bridge-Service-Key` must use the client's supported `file:` reference to the router key. Provision the runtime key/profile through an approved official flow, checking the account, original Tunnel, client version and actual launch command. Restrict Tunnel Use to the deployment owner; its runtime key is not per-user authentication.

Refresh the same plugin on the original dot and inspect its tools and `lark.message.created` event. Create one `{"conversation":"owner"}` subscription; its signing material must come from the real flow. For approved Feishu groups, switch to `configured` as described in Configuration. The backend connects to the provider only after signed challenge verification and an active unique subscription. With default settings, leases are bounded to 24 hours and renewed by the original dot/platform using `refreshBefore`; the bridge creates no independent renewal task.

## 6. Human steps and real acceptance

Human participation is concentrated in choosing the app/host, approving persistent credentials/permissions/storage, scanning or pairing, confirming the old consumer is stopped, creating the original-dot subscription and checking the actual reply. Confirmation flags acknowledge existing approval; they do not grant it.

Verify in layers: dependencies/tests → process health → local authentication/catalogs → Tunnel → active subscription → provider Gateway → one answer in the original chat. Callback 2xx, visible tools or gateway connected alone do not prove end-to-end delivery. Have the owner send ordinary messages, check consecutive replies, then test graceful restart and retained state without duplicates. Repeat after SSH disconnects. Schedule a whole-server reboot separately. See [Operations and troubleshooting](troubleshooting.en.md) for maintenance and rollback.
