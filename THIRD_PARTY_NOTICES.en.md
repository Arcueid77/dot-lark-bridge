# Sources and dependencies

[简体中文](THIRD_PARTY_NOTICES.md) | [English](THIRD_PARTY_NOTICES.en.md) | [Home](README.en.md)

The repository's original MIT LICENSE, Copyright (c) 2026 A2KT, is unchanged.

The general MCP 2.0, Standard Webhooks signing, OAuth/JWKS, SSRF, SQLite queue and regression designs originated in the same author's [dot-qq-bridge](https://github.com/AvaloNero/dot-qq-bridge), fixed MIT commit `3578dd0bbc3c3fca12c610fb23c14d13ef77a193`. This project removes QQ callback/signing/sending protocols and adds Feishu binding and subscription generation/revocation race protection.

The official [`@larksuiteoapi/node-sdk`](https://github.com/larksuite/node-sdk) 1.74.0 is consumed as an npm dependency, not copied as built source into this repository. It is MIT, Copyright (c) 2022 Lark Technologies Pte. Ltd.; the npm package carries its full LICENSE. `package-lock.json` records versions, transitive dependencies, integrity and license metadata. Distributions containing node_modules must retain each dependency's license.

The bridge uses Node.js built-in HTTP/HTTPS/crypto/sqlite/fs. This project's MIT terms do not replace Node.js or runtime component licenses. Standard Webhooks HMAC follows the public protocol without copying a third-party standardwebhooks implementation.

Public protocol sources: [MCP Events](https://developers.openai.com/plugins/build/mcp-events), [OpenAI authentication](https://developers.openai.com/plugins/build/auth), [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md), [Feishu incoming events](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive?lang=en-US) and [original-message replies](https://open.feishu.cn/document/server-docs/im-v1/message/reply?lang=en-US). This project does not reproduce complete official documentation or use other bridges' cookies, user tokens, account credentials or private model memory.
