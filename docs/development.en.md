# Development

[简体中文](development.md) | [English](development.en.md) | [Home](../README.en.md)

Users need [Deployment](deployment.en.md), [Configuration](configuration.en.md) and [Operations](troubleshooting.en.md). This page is for maintainers changing code. The constraints and validation scope below are maintained here. Completed handoffs can be retrieved from Git history.

## Repository responsibilities

| Component | Location and responsibility |
| --- | --- |
| Shared implementation | [dot-bridge-core](https://github.com/Arcueid77/dot-bridge-core): callback transport, private files/platform locks and registered-channel router |
| IM adapter | `src/tunnel-adapter.js` and `src/tunnel-contract.js`: channel tools, events and protocol |
| Provider and business logic | This repository's `src/`: SDK/Gateway, identities, durable queues, restricted replies and interaction |
| Single-channel host | `scripts/run-tunnel-router.js` registers only this adapter |
| Pinned distribution | `vendor/core-release.json`, `vendor/*.tgz` and the lockfile record version, source revision and integrity |

Core does not import provider SDKs. A new channel owns its adapter and uses shared interfaces, without copying shared implementation. Installation needs neither core nor other IM source. Core changes require a new immutable version and coordinated consumer archive/metadata/lockfile updates; never replace an already published version in place.

The former QQ prototype is provenance only. Current Feishu deployment and tests do not require a QQ readiness backend.

## Invariants to preserve

- Commit durable intake before ACK. Enforce source identity, subscription generation, deadline, deduplication, leases and reply state server-side.
- Resolve the original conversation from a verified source message, without arbitrary recipients or URLs. One inbound message permits one logical answer.
- Preserve HTTPS, public DNS/IP pinning, original-host TLS and no redirects. Refuse unsupported proxy policies rather than silently falling back.
- Authentication/callback, provider and optional Sites paths have separate boundaries. A runtime key is not external user identity; `clientInfo` is not authentication.
- A crash during reply or unknown ACK becomes uncertain and is never automatically resent. Revocation/expiry blocks later reads, intake and sends.
- Do not log credentials, identities, bodies or full URLs. SQLite encrypts payloads and selected secrets, not all metadata/deduplication IDs; protect the disk.
- Local mode locks are not cross-host fencing. Ordinary persistent services must not use finite-window or stdin-dependent development supervision.

Protocol sources are listed in [third-party notices](../THIRD_PARTY_NOTICES.en.md); shared implementation belongs to core. OAuth compatibility validates an existing RS256/JWKS issuer. Sites requires separate authorization and validation; it is never an automatic fallback from Tunnel failure.

## Recorded validation scope

The standalone Windows fix worktree was verified on October 15, 2026 with Node 24.15.0, local NTFS, OpenSSL 3.5.6 and core 0.2.1, without QQ/core source checkouts.

| Scope | Result and limits |
| --- | --- |
| Locked install, check, simulate | Passed; simulation covered the official SDK dispatcher, local MCP, signed event and one synthetic original-conversation reply |
| Full suite | 275 tests: 260 passes, zero failures, 15 skips |
| Skip reasons | Ten Linux private-file cases and five Linux POSIX handoff reporter cases; not failure of Windows credential protection |
| Standalone router | Actually ran and passed, without a missing-sibling QQ skip |
| Evidence boundary | That record did not include updated Linux regression, Docker build/runtime, service cutover or new real-message acceptance |

This documentation cleanup did not rerun those full suites. Gateway, original-dot subscription, cards/media/groups and visible client behavior still need independent evidence on the target instance; the offline results cannot substitute for it. Detailed earlier records remain retrievable through Git.

## Validation and contributions

In a directory without other IM/core source:

```sh
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run simulate
```

`test/standalone-router.test.js` must actually run without skipping for missing sibling source. Shared changes need the relevant tests in core. Record exact SHA, OS, Node, passes/failures/skips/unrun checks. Windows evidence does not substitute for Linux, and synthetic tests do not prove live delivery.

Maintain current Chinese files and sibling `.en.md` files together. The homepage links four current guides; maintain each workflow in one place. `docs/languages.json` lists bilingual coverage, and `npm run check` verifies coverage, language switches and local links. Delete completed handoffs and superseded instructions; retrieve them from Git history if needed.

Before merging, confirm scope, applicable checks and the final PR description. To retain ordinary commits without adding a merge commit, choose **Rebase and merge**:

```sh
gh pr merge PR_NUMBER --rebase
```

Use **Squash and merge** if one consolidated feature commit is preferable. Avoid Create a merge commit. Resolve conflicts and satisfy repository checks first. Rewriting published main history requires separate explicit authorization, a rollback reference and an exact old-SHA guard.
