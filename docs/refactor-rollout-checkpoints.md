# Refactor Rollout Checkpoints

This document tracks phased rollout checkpoints for the clean-code separation work.

## Phase A - Contracts + Routing Split

- Scope:
  - shared contracts package
  - backend route split (`app/router`, feature routes)
- Behavior gate:
  - `/api/chat/stream` still streams same event names
  - `/api/suggest/files` and `/api/suggest/commands` payload shape unchanged
- Rollback:
  - revert to previous `packages/backend/src/index.ts` monolith entrypoint

## Phase B - Composer and Stream Internals

- Scope:
  - composer providers split (file index/path/ranking/commands/slash)
  - query event parser/mapper split
  - web stream parser/transport split
- Behavior gate:
  - `@` top-level and path-like modes unchanged
  - `/` still submits through chat stream path in UI
  - tool result rendering supports string/array/object payloads
- Rollback:
  - switch imports in `composerService.ts` and `queryService.ts` back to inline logic

## Phase C - Observability and Error Model

- Scope:
  - structured backend logs
  - unified backend error envelope with `auth_domain`
  - typed API client errors in web client
- Behavior gate:
  - unauthorized responses return domain-aware payloads
  - no plaintext auth header logging
- Rollback:
  - disable backend structured logs with `BACKEND_LOG_LEVEL=error`
  - revert `errorResponse` usage to raw JSON if necessary

## Snapshot Checklist Per Release

- Manual smoke:
  - normal chat prompt
  - slash prompt (`/help`, dynamic skill command)
  - `@` mention in empty query and path mode
  - tool call message and result rendering
- Contract snapshot:
  - SSE event types and required fields
  - suggest response fields (`items`, `isPartial`, `generation`, `capApplied`)
