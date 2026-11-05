# dot-lark-bridge

[简体中文](README.md) | [English](README.en.md)

Connect your official Feishu app's owner private chat and approved groups to an existing OpenAI dot, which replies in the original conversation through the official Secure MCP Tunnel. No model API is used.

Clone only this repository. A pinned `@dot-bridge/core` distribution is included in `vendor/`; no QQ repository or QQ readiness service is required.


Received attachments can be reused by their source-message index, without copying Base64 through the model. Platform format, size and media-configuration limits still apply. Plain UTF-8 and BOM-marked UTF-16 documents include bounded text excerpts; truncated excerpts are explicitly marked and the original file remains available.

## Capabilities

- Owner-only private text by default, with durable queues, deduplication and restart recovery.
- Optional processing reactions, incremental updates to one card, Markdown, quotations and retained context.
- Optional images, files, audio and attachments for long answers. Interpretation depends on the original dot's actual content support.
- Groups are off by default. Each group can select owner/allowlist/all members and mentions, keywords or every-message triggers.
- Replies are bound to the source message. Uncertain outcomes remain `uncertain` and are never automatically resent.

## Start here

| Goal | Guide |
| --- | --- |
| Install, pair the app, connect the original dot and run continuously | [Deployment](docs/deployment.en.md) |
| Enable reactions, cards, media or group rules | [Configuration](docs/configuration.en.md) |
| Diagnose missing replies, expiry, backups and upgrades | [Operations and troubleshooting](docs/troubleshooting.en.md) |
| Change code, add IM adapters or contribute a PR | [Development](docs/development.en.md) |

## Runtime

Use Node.js **>=24.15 and <25** on a continuously running Linux VPS or native Windows with local NTFS. Windows also needs Python 3.10+. The deployment guide covers installation, owner pairing and systemd; development commands are in the development guide.

## Authorization and license

App authorization, owner pairing, persistent credential storage, group permissions and subscriptions require operator participation. Keep secrets out of Git, chats and logs. Tunnel Use holders share the local service identity, so independent deployments need their own credentials and access controls.

Feishu content is data and does not authorize unrelated external actions or export dot memory. Group tasks must explicitly restrict disclosure of private-chat memory.

The project uses the [MIT license](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.en.md) for provenance and dependencies.


Shared owner IM maintenance (`/status`, `/queue`, `/subscription`, `/cancel`) preserves the existing inbox, keys and subscriptions. Optional management-only gateway connection and shared protected document extraction are described in [configuration](docs/configuration.en.md).


## Interaction and maintenance

Keep the existing protected `LARK_INTERACTION_POLICY_FILE` for reactions, status cards, media, genuine card updates and owner/group rules. `append_lark_reply` submits only the newly generated delta with consecutive sequence numbers; complete the same card with the full `reply_to_lark` text. `get_lark_context` reads retained history/quotes in the source conversation scope.

The owner DM supports `/help`, `/status`, `/queue`, `/subscription`, and `/cancel [reference]`. In standard callback mode, explicit `DOT_BRIDGE_OWNER_MANAGEMENT=1` keeps maintenance connected without an active dot subscription. Cancel only unsent bridge replies; the current legitimate begin/append flow still completes one final answer, while uncertain outcomes remain for review. See [configuration](docs/configuration.en.md).

See [deployment](docs/deployment.en.md) for Windows/Linux foreground and Linux systemd operation. macOS is unverified; trials and feedback are welcome. Hosted-dot pause/reset/approval remain in the original platform.

## Choices, uploads and reminder management

Native choices become one new input for the original dot. They bind to the requesting actor, conversation and acknowledged prompt message for up to ten minutes. A dot environment with programmatic file access can upload generated media in bounded encrypted chunks, verify its size and SHA-256, then submit the source-bound final reply. Files are limited to 5 MiB and this provider's supported media types and formats.

Literal reminders support weekdays, fixed intervals, pause, resume and delivery history. Check `check_lark_outbound` before use and supply the saved reminder ID and current revision. Resuming skips old paused occurrences.
