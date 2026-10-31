# Feishu chat experience and group configuration

[简体中文](configuration.md) | [English](configuration.en.md) | [Home](../README.en.md)

This page covers images, audio, files, cards and group settings for your existing dot, official Secure MCP Tunnel and Feishu app. For installation, see [Deployment](deployment.en.md).

These features require a protected interaction configuration and the corresponding Feishu permissions. Without `LARK_INTERACTION_POLICY_FILE`, the bridge handles only the owner's private text messages. Enable media, reactions, cards and groups using the settings below.

`check_lark_readiness` reports gateway and original-dot subscription state separately, including the stored expiry and complete pending, processing and uncertain outbound-work counts. The gateway waits for a valid subscription. Missing diagnostic history cannot reconstruct an earlier failure. Reading status never renews a subscription or changes configuration.

Feishu continues to use `MCP_CALLBACK_ALLOWED_HOSTS`. A mistakenly supplied `CALLBACK_HOSTS` setting is reported as a name mismatch; its domains are not accepted or copied automatically.

## Supported experience

- After durable intake, the bridge can add a `Typing` reaction and an “received, waiting” card. The card changes to “processing” only after dot calls `begin_lark_reply`. `append_lark_reply` updates that card with genuinely generated paragraphs; `reply_to_lark` finishes it. There is no raw model token stream, and completed answers must not be replayed to fake streaming.
- Text, rich text, images, files and audio can be received/replied to through the fixed original-message route. Markdown retains code blocks, lists and tables. Model-generated `<at>` text cannot notify another member or everyone.
- Input is bounded to 20000 JavaScript characters; a complete answer to 30000. Each resource is at most 5 MiB, with at most ten per message. Above the conservative inline byte budget, the card shows a preview and attaches the full Markdown answer. That is one logical answer with an attachment, not duplicate answering.
- Quotations are fetched only from the original conversation. Context contains authorized preceding messages within retention. Private chats and groups are separate; group context defaults to each sender, with explicit group-wide context available. The original dot's global memory has no new physical isolation, so group task instructions must prohibit private-memory disclosure.
- Files expose the original MCP resource and attempt UTF-8, PDF, DOCX, XLSX or PPTX extraction. Unsupported extraction is labeled honestly. Audio is passed as MCP audio for the original dot to interpret; outbound non-Opus audio uses restricted FFmpeg conversion. No additional model API or transcription bot is introduced.
- Failures, expiry, revocation and uncertain sends update a known card and remove the bridge's own processing reaction where permitted. Missing callbacks never masquerade as dot receipt. Uncertain outcomes remain `uncertain` without automatic resend; revocation prevents further reads/sends.

The original dot must be able to read the corresponding tool content. If it receives voice messages but cannot interpret them, enable local transcription as described below.

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

Non-Opus conversion and PDF/Office extraction also require the protected `DOT_BRIDGE_AUDIO_GUARD` component described below; core dumps are disabled. These conversions remain off without the guard. Existing Opus audio, images and ordinary file transfer still work. Do not weaken system-file or private-directory permissions to enable conversion.

Image replies accept PNG, JPEG, GIF and WebP. Audio replies accept existing Ogg, WAV and MP3, converting to Opus as required by Feishu; no text-to-speech service is included. The bridge's 5 MiB cap still applies. See the official [image upload](https://open.feishu.cn/document/server-docs/im-v1/image/create) and [file upload](https://open.feishu.cn/document/server-docs/im-v1/file/create) references.

After updating, send text, an image, a short voice message and a small file from your private chat, and confirm each reply returns to that conversation. If cards or groups are enabled, also check their updates, trigger rules and member limits. Restarting the service should not resend completed replies, and disconnecting SSH should leave the service running. Plan a whole-server reboot separately.

Text/replies default to seven-day logical cleanup; deduplication tombstones remain. Old pages, WAL, backups and system logs may retain encrypted history. Subscription renewal follows the original dot/platform's real `refreshBefore`; the bridge creates no renewal automation.

## Runtime limits

### Voice transcription

Some ChatGPT hosts omit native MCP audio. With local transcription enabled, `get_lark_attachment` also returns `extracted_text` for the original dot to read and answer in the source conversation. It is an imperfect reference, never authorization for external actions.

Set `DOT_BRIDGE_AUDIO_TRANSCRIPTION=local-whisper`, `DOT_BRIDGE_WHISPER_BINARY` and `DOT_BRIDGE_WHISPER_MODEL` in the backend environment. Use absolute paths to a reviewed root-owned whisper-cli and multilingual model, neither writable by the service user. Install `/usr/bin/ffmpeg`, `prlimit`, `flock`. Share the existing private `BRIDGE_LOCK_DIRECTORY` with QQ to serialize recognition. Audio uses memory pipes on the VPS; no API key or external transcription service is involved.

Limits: 5 MiB, 120 seconds of audio, 28 seconds of recognition and 12000 output characters. Busy, timed-out or unclear audio returns `extraction_status:unsupported`; ask for a shorter recording or text if neither representation is usable. A media switch or successful download alone does not establish that the dot understood the voice.

Compile core's included `audio/no-core-dump.c` as a shared library in the protected runtime directory and set its absolute path in `DOT_BRIDGE_AUDIO_GUARD`. Audio subprocesses are made nondumpable so piped crash collectors cannot retain voice memory. Local recognition refuses to run without this protection.

Set these in the backend environment file, not the router environment:

| Setting | Default | Meaning |
| --- | --- | --- |
| `REPLY_TTL_SECONDS` | 900 | Local reply deadline |
| `SUBSCRIPTION_TTL_SECONDS` | 86400 | Subscription lifetime cap, also bounded by the requested TTL and authenticated principal lifetime |
| `QUEUE_LIMIT` | 100 | Queue capacity |
| `INBOUND_PER_MINUTE` / `REPLIES_PER_MINUTE` | 10 / 10 | Intake/reply rate limits |
| `MAX_DELIVERY_ATTEMPTS` | 5 | Bounded attempts, never permission to resend an uncertain reply |

Feishu additionally accepts `TEXT_RETENTION_SECONDS` (default 604800), at least as long as the reply deadline. The Feishu deadline is bridge policy, not a claimed provider passive-reply window.
