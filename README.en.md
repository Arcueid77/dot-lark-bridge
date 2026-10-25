# dot-lark-bridge

[简体中文](README.md) | [English](README.en.md)

Connect your official Feishu app's owner private chat and approved groups to an existing OpenAI dot, which replies in the original conversation through the official Secure MCP Tunnel. No model API is used.

Clone only this repository. A pinned `@dot-bridge/core` distribution is included in `vendor/`; no QQ repository or QQ readiness service is required.

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
