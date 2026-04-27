# Goal of Repo

## Primary Goal

This repository exists to evolve the reverse-engineered Claude Code CLI into a
real backend runtime without throwing away the CLI engine that already works.

The target state is:

- one long-lived backend server
- many concurrent sessions
- session create/resume/list/rename/delete over API
- message send/receive over HTTP + SSE/WebSocket
- the same core Claude Code runtime per session
- the same tools, MCP, permissions, slash commands, transcripts, and config
  behavior that the CLI already has

## What "Backend First" Means Here

The backend is not supposed to be a thin wrapper around a separate product.
The backend is supposed to be Claude Code itself, service-ified.

That means:

- keep the real CLI execution model
- keep the real query loop
- keep the real tool system
- keep the real MCP integration
- keep the real permission flow
- keep the real session persistence and transcript model
- keep config loading from `settings.json`

The frontend is only a replacement for the terminal UI.
It should act like a remote client for the CLI engine, not a second source of
truth.

## Architecture Direction

The intended architecture is:

1. `src/main.tsx`, `src/query.ts`, `src/QueryEngine.ts`, tool runtime, MCP
   runtime, and auth/config loading remain the core engine.
2. `src/server/` becomes the transport and session orchestration layer for that
   engine.
3. Each backend session must preserve Claude Code semantics, not invent a new
   parallel conversation runtime.
4. The web app replaces Ink/terminal interaction, but does not replace the
   underlying Claude Code logic.

## Required Capabilities

The backend must support all of the following:

- multiple active sessions at the same time
- safe session isolation
- streaming responses per session
- control/permission responses from the client back into the running session
- resume archived sessions from transcript history
- list active and archived sessions consistently
- tool execution parity with CLI
- MCP parity with CLI
- auth/config parity with CLI

## Non-Goals

These are explicitly not the goal:

- building a separate backend that reimplements Claude Code behavior
- using a different runtime path than the CLI core for chat/tool execution
- replacing `settings.json` with env-only auth assumptions
- dropping MCP/tools/permissions just to make the web path easier
- keeping the old terminal UI as the architectural center

## Migration Rule

When in doubt, patch the CLI core and promote it into backend mode.
Do not add a second independent backend stack that drifts from the CLI.

The correct direction is:

- CLI engine -> backend runtime
- Ink UI -> optional client
- Web UI -> alternative client

## Definition of Done

This repo reaches its main goal when a user can:

1. start one backend server
2. open multiple sessions through API/UI
3. send messages to any session
4. receive streaming model output
5. approve or deny permission requests remotely
6. use the same tools and MCP servers the CLI uses
7. stop and later resume sessions from transcript-backed state
8. do all of that without depending on the terminal UI
