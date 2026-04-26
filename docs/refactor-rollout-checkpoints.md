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
  - reply with quote (selection -> submit -> quoted context preserved)
  - quote clear via `Esc` and close button
  - slash prompt (`/help`, dynamic skill command)
  - `@` mention in empty query and path mode
  - tool call message and result rendering
- Contract snapshot:
  - SSE event types and required fields
  - chat request payload (`message` required, optional `quote`)
  - suggest response fields (`items`, `isPartial`, `generation`, `capApplied`)

## Phase D - Reply With Quote Transport

- Scope:
  - shared quote payload contract in chat request
  - web submit path propagation (`ActionBar` -> `useStream` -> API client)
  - backend route quote validation + query composition
- Behavior gate:
  - legacy `{ message }` payload still accepted
  - quote payload validation returns explicit errors (`QUOTE_*`)
  - `@` and `/` composer interactions unchanged
- Rollback:
  - disable quote payload submission in web and keep UI preview only
  - ignore quote in backend composition while still accepting payload
