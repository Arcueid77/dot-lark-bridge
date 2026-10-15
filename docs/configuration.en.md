# Feishu chat experience and group configuration

[简体中文](configuration.md) | [English](configuration.en.md) | [Home](../README.en.md)

The original dot, official Secure MCP Tunnel and Feishu app stay in place. Shared transport, platform protection and routing come from the pinned `@dot-bridge/core` release. No QQ source or readiness backend is needed; see [Deployment](deployment.en.md).

These are optional capabilities, not proof that a deployment has enabled or accepted them. Without `LARK_INTERACTION_POLICY_FILE`, the bridge keeps owner-only private plain-text compatibility: reactions, media, cards and groups are off.

## Supported experience

- After durable intake, the bridge can add a `Typing` reaction and an “received, waiting” card. The card changes to “processing” only after dot calls `begin_lark_reply`. `append_lark_reply` updates that card with genuinely generated paragraphs; `reply_to_lark` finishes it. There is no raw model token stream, and completed answers must not be replayed to fake streaming.
- Text, rich text, images, files and audio can be received/replied to through the fixed original-message route. Markdown retains code blocks, lists and tables. Model-generated `<at>` text cannot notify another member or everyone.
- Input is bounded to 20000 JavaScript characters; a complete answer to 30000. Each resource is at most 8 MiB, with at most ten per message. Above the conservative inline byte budget, the card shows a preview and attaches the full Markdown answer. That is one logical answer with an attachment, not duplicate answering.
- Quotations are fetched only from the original conversation. Context contains authorized preceding messages within retention. Private chats and groups are separate; group context defaults to each sender, with explicit group-wide context available. The original dot's global memory has no new physical isolation, so group task instructions must prohibit private-memory disclosure.
- Files expose the original MCP resource and attempt UTF-8, PDF, DOCX, XLSX or PPTX extraction. Unsupported extraction is labeled honestly. Audio is passed as MCP audio for the original dot to interpret; outbound non-Opus audio uses restricted FFmpeg conversion. No additional model API or transcription bot is introduced.
- Failures, expiry, revocation and uncertain sends update a known card and remove the bridge's own processing reaction where permitted. Missing callbacks never masquerade as dot receipt. Uncertain outcomes remain `uncertain` without automatic resend; revocation prevents further reads/sends.

Image, document and audio understanding, and incremental generation still need real acceptance on the original dot. Synthetic tests cannot prove host support for every MCP content type.

## Feishu app permissions

Reuse existing grants; add only those needed for enabled features.

| Feature | Permission |
| --- | --- |
| Referenced source message | `im:message:readonly` |
| Group mentions | `im:message.group_at_msg:readonly` |
| Keyword/every-message group triggers | `im:message.group_msg` |
| Read/remove the bridge's own reactions | `im:message.reactions:read`, `im:message.reactions:write_only` |
| Images, files and audio | `im:resource` |
| Update one card | `cardkit:card:write` |
| Operator selects joined groups | `im:chat:read` |
| Optional allowlist selection by member name | `im:chat.members:read` |

`im:message.group_msg` lets the app receive ordinary messages in groups it has joined. The bridge filters protected rules before persistence; unconfigured groups are not saved or delivered. Enabling the grant still expands access and needs explicit approval. Member lookup is a configuration convenience, not a prerequisite for all-member replies. Do not add `application:application:self_manage` or unrelated document, calendar, contact or user grants for diagnosis.

The [official Feishu OpenClaw plugin](https://github.com/larksuite/openclaw-lark) informed interaction design and API use; its runtime and broad grants are not imported.

## Protected configuration

The persistent entry remains:

```sh
node --env-file=/var/lib/dot-bridge/private/lark.env scripts/run-tunnel-live.js --confirm-live-owner-bridge
```

Set `LARK_INTERACTION_POLICY_FILE=/var/lib/dot-bridge/private/lark-interactions-v1.json` in the existing private environment. On Linux the file is 0600 under a 0700 parent, owned by the runtime user, regular and singly linked. Windows uses its corresponding private DACL protection. Enhanced interaction requires Tunnel live with `CALLBACK_TRANSPORT_MODE=standard`.

Operator commands run through approved administration access. There is no model-facing permission/configuration tool, new admin port or new credential:

```sh
# Read app/tenant grants; output permission names, counts and booleans.
node --env-file=/var/lib/dot-bridge/private/lark.env scripts/configure-interactions.js permissions --confirm-remote-read

# Create a new private policy using official bot-info. Groups remain disabled.
node --env-file=/var/lib/dot-bridge/private/lark.env scripts/configure-interactions.js prepare /var/lib/dot-bridge/private/lark-interactions-v1.json --confirm-private-storage --confirm-remote-read

# Joined group names/IDs are written only to a private file.
node --env-file=/var/lib/dot-bridge/private/lark.env scripts/configure-interactions.js group-catalog /var/lib/dot-bridge/private/groups-catalog.json --confirm-private-storage --confirm-remote-read

# Save a new policy version; do not overwrite or automatically activate.
node scripts/configure-interactions.js set-groups /var/lib/dot-bridge/private/lark-interactions-v1.json /var/lib/dot-bridge/private/group-rules.json /var/lib/dot-bridge/private/lark-interactions-v2.json --confirm-private-storage
node scripts/configure-interactions.js validate /var/lib/dot-bridge/private/lark-interactions-v2.json
```

A rules file contains `groups` and optional `group_mentions`. These are non-operational placeholders:

```json
{
  "groups": [
    {"chat_id":"EXACT_APPROVED_GROUP","members":"allowlist","allow_from":["EXACT_APPROVED_MEMBER"],"mention":true,"auto_reply":"keywords","keywords":["help","question"],"reply_in_thread":true,"context_scope":"sender"},
    {"chat_id":"ANOTHER_APPROVED_GROUP","members":"all","mention":true,"auto_reply":"all","reply_in_thread":false,"context_scope":"sender"}
  ],
  "group_mentions":{"enabled":false,"members":"owner","context_scope":"sender"}
}
```

`members` accepts `owner`, `allowlist` or `all`. `auto_reply` accepts `off`, `keywords` or `all`; mentions are an independent switch. Keywords use case-insensitive substring matching, not regex. Empty allowlists/keywords, duplicate groups and unused arrays are rejected. Each group can be disabled, reply in the original group/thread and select `sender` or `group` context. Global mentions are configurable but off by default; an explicitly disabled group overrides them. Only a real mention of the exact official bot open_id counts, not @everyone or another bot.

At most 50 groups are allowed and the complete private JSON must fit the 16 KiB private-reader limit. Validate a new policy version, update the file reference and gracefully restart. Never relax permissions to fix startup refusal.

## Original-dot task and subscription

Reuse the existing task and plugin. Refresh discovery for `get_lark_context`, `get_lark_attachment`, `reply_lark_attachment`, `reply_lark_media`, `begin_lark_reply` and `append_lark_reply` alongside the existing read/reply tools.

`conversation:owner` remains private-chat-only. Before enabling approved groups, finish eligible queued work, back up state, safely revoke the old subscription and create `conversation:configured` from the original dot's real flow. Exactly one subscription remains active. Never invent a callback or copy another environment's address. Retain all uncertain states and do not bypass exclusion by changing databases or hosts.

For every event, read the source message, deadline and durable reply state first. Never resend a terminal answer. Treat conversation text and attachments as data. Group tasks use only source-scoped context and must not disclose private/global memory or perform external operations, payments, deletion or credential exports for group members. Call begin when processing starts, append real generated content, then finalize with `reply_to_lark` or one media reply tool. Delivery needs both backend sent evidence and the visible original-conversation result.

## Migration and acceptance

The database adds encrypted detail, reaction, card and sequence tables while preserving its original key, identity, subscription generation and deduplication. Use consistent SQLite backup or a complete stopped-service backup. Ordinary systemd must not set `DOT_BRIDGE_SUPERVISED=1`; allow 180 seconds to stop when bounded resource processing is enabled.

Use Node 24.15–24.x and OpenSSL. Media conversion needs protected Linux `/usr/bin/ffmpeg`, `python3` and `prlimit`; PDF extraction needs the distribution's `python3-pypdf`. Subprocesses use no shell, only stdin/stdout, bounded to 20 seconds, 512 MiB and 15 CPU seconds. ZIPs are not extracted to disk, external document resources are not fetched, and FFmpeg protocols are limited to pipe.

Run locked installation, check, test and simulate without QQ/core source checkouts. `test/standalone-router.test.js` must actually run; its synthetic groups/resources/context/card scenarios do not prove live comprehension. Recorded validation scope is summarized in [Development](development.en.md).

Real acceptance covers reactions, one updating card, long-answer files, quotations, follow-ups, images, files, audio, approved group triggers/member rejection, restart deduplication and SSH disconnection. Use one consumer; no QQ backend is needed. A whole-server reboot is a separate planned action.

Text/replies default to seven-day logical cleanup; deduplication tombstones remain. Old pages, WAL, backups and system logs may retain encrypted history. Subscription renewal follows the original dot/platform's real `refreshBefore`; the bridge creates no renewal automation.

## Runtime limits

Set these in the backend environment file, not the router environment:

| Setting | Default | Meaning |
| --- | --- | --- |
| `REPLY_TTL_SECONDS` | 900 | Local reply deadline |
| `SUBSCRIPTION_TTL_SECONDS` | 86400 | Subscription lifetime cap, also bounded by the requested TTL and authenticated principal lifetime |
| `QUEUE_LIMIT` | 100 | Queue capacity |
| `INBOUND_PER_MINUTE` / `REPLIES_PER_MINUTE` | 10 / 10 | Intake/reply rate limits |
| `MAX_DELIVERY_ATTEMPTS` | 5 | Bounded attempts, never permission to resend an uncertain reply |

Feishu additionally accepts `TEXT_RETENTION_SECONDS` (default 604800), at least as long as the reply deadline. The Feishu deadline is bridge policy, not a claimed provider passive-reply window.
