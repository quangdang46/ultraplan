# Route Ownership

This document defines which execution mode owns which routes.

## Execution Modes

| Mode | Description | Auth | Client |
|------|-------------|------|--------|
| `managed-web` | New hybrid platform | UUID | Web UI (`/code/*`) |
| `remote-control` | Legacy RC API | API Key | CLI Bridge |

## Route Map

### managed-web

| Route | Handler | Notes |
|-------|---------|-------|
| `/api/*` | `packages/remote-control-server/src/routes/api/index.ts` | Adapter layer for web client |
| `/api/auth/*` | `packages/remote-control-server/src/routes/api/index.ts` | Auth: init, verify, validate |
| `/api/sessions/*` | `packages/remote-control-server/src/routes/api/index.ts` | Session CRUD |
| `/api/chat/*` | `packages/remote-control-server/src/routes/api/index.ts` | Chat stream, control, interrupt |
| `/api/commands/*` | `packages/remote-control-server/src/routes/api/commands/*` | Command catalog, policy |
| `/api/suggest/*` | `packages/remote-control-server/src/routes/api/index.ts` | File/command suggestions |
| `/api/mcp` | `packages/remote-control-server/src/routes/api/index.ts` | MCP server management |
| `/api/memory` | `packages/remote-control-server/src/routes/api/index.ts` | CLAUDE.md files |
| `/api/search` | `packages/remote-control-server/src/routes/api/index.ts` | Workspace search (ripgrep) |
| `/api/usage` | `packages/remote-control-server/src/routes/api/index.ts` | Token usage |
| `/api/context` | `packages/remote-control-server/src/routes/api/index.ts` | Context window breakdown |
| `/api/history` | `packages/remote-control-server/src/routes/api/index.ts` | Prompt history |
| `/api/state` | `packages/remote-control-server/src/routes/api/index.ts` | Session state |
| `/api/tools` | `packages/remote-control-server/src/routes/api/index.ts` | Tool list |
| `/web/sessions/*` | `packages/remote-control-server/src/routes/web/sessions.ts` | Session management |
| `/web/sessions/:id/events` | `packages/remote-control-server/src/routes/web/sessions.ts` | SSE event stream |
| `/web/sessions/:id/history` | `packages/remote-control-server/src/routes/web/sessions.ts` | Historical events |
| `/web/sessions/:id/control` | `packages/remote-control-server/src/routes/web/control.ts` | Control requests |
| `/web/sessions/:id/interrupt` | `packages/remote-control-server/src/routes/web/control.ts` | Interrupt session |
| `/web/environments` | `packages/remote-control-server/src/routes/web/environments.ts` | Environment list |
| `/web/bind` | `packages/remote-control-server/src/routes/web/auth.ts` | Session binding |
| `/environments` | `packages/remote-control-server/src/routes/api/index.ts` | Environment listing |

### remote-control

| Route | Handler | Notes |
|-------|---------|-------|
| `/v1/sessions/*` | `packages/remote-control-server/src/routes/v1/sessions.ts` | Legacy session API |
| `/v1/sessions/:id/events` | `packages/remote-control-server/src/routes/v1/sessions.ts` | Event ingestion |
| `/v1/environments/*` | `packages/remote-control-server/src/routes/v1/environments.ts` | Environment management |
| `/v1/environments/bridge/*` | `packages/remote-control-server/src/routes/v1/environments.ts` | Bridge registration |
| `/v1/environments/work` | `packages/remote-control-server/src/routes/v1/environments.work.ts` | Work dispatch |
| `/v1/session-ingress` | `packages/remote-control-server/src/routes/v1/session-ingress.ts` | Session ingress |
| `/v2/code/sessions/*` | `packages/remote-control-server/src/routes/v2/code-sessions.ts` | Code session API |
| `/v2/code/sessions/:id/bridge` | `packages/remote-control-server/src/routes/v2/code-sessions.ts` | Bridge connection info |
| `/v2/worker` | `packages/remote-control-server/src/routes/v2/worker.ts` | Worker state management |
| `/v2/worker-events` | `packages/remote-control-server/src/routes/v2/worker-events.ts` | Worker event ingestion |
| `/v2/worker-events-stream` | `packages/remote-control-server/src/routes/v2/worker-events-stream.ts` | Worker SSE stream |

### ACP (Agent Client Protocol)

| Route | Handler | Notes |
|-------|---------|-------|
| `/acp/agents` | `packages/remote-control-server/src/routes/acp/index.ts` | Agent listing |
| `/acp/channel-groups/*` | `packages/remote-control-server/src/routes/acp/index.ts` | Channel groups |
| `/acp/ws` | `packages/remote-control-server/src/routes/acp/index.ts` | WebSocket endpoint |
| `/acp/relay/*` | `packages/remote-control-server/src/routes/acp/index.ts` | Relay handler |

## Mode Guards

Routes in `managed-web` mode **MUST NOT** use `process.cwd()` as a fallback for workspace paths. The web client **MUST** provide an explicit `cwd` parameter.

### Routes requiring explicit cwd

These routes use `process.cwd()` fallback and should be reviewed for mode guards:

| File | Routes | Issue |
|------|--------|-------|
| `routes/api/index.ts` | `/api/suggest/files`, `/api/suggest/commands`, `/api/search`, `/api/mcp`, `/api/memory`, `/api/chat/stream` | Uses `process.cwd()` fallback |
| `routes/api/commands/catalog.ts` | `/api/commands/catalog` | Uses `process.cwd()` for command loading |
| `routes/api/commands/policy.ts` | `/api/commands/:id/policy` | Uses `process.cwd()` for command lookup |

### Adding Mode Guards

```typescript
import { assertManagedWebMode } from "../../../../src/types/mode.js";

// At top of handler
assertManagedWebMode(c.req);

// Then cwd is safe to use with explicit fallback
const cwd = c.req.query("cwd") || process.cwd();
```

## Feature Flag Based Mode Detection

Mode detection checks these feature flags in priority order:

1. `BRIDGE_MODE` → remote-control
2. `DAEMON` → remote-control

If no RC flags are set, mode is determined by route prefix:
- `/v1/*`, `/v2/*` → remote-control
- All other routes → managed-web
