# Web UI Gap Checklist

## Bugs (fix first)

- [x] **AskUserQuestion not showing** — fixed SSE event shape: normalize `payload` → `data` in both `streamChat` and `streamSessionEvents` parsers; fixed `useStream.ts` to handle both `{ request_id, request }` and nested shapes
- [x] **All `/api/*` calls 404** — added `/api` route adapter in RCS (`routes/api/index.ts`) implementing auth, state, tools, chat stream/control, session messages, suggest, command/execute; mounted at `/api` in `index.ts`

## Already Done

- [x] ThinkingCollapsible — collapsible thinking blocks
- [x] DiffViewer in ConversationToolItem — colored +/- diff for file edits
- [x] Token stats in PanelTop — input/output token counts (polls every 5s)
- [x] TaskList panel — real task list from stream data, toggled via ListTodo button
- [x] PermissionPanel expanded — Bash, FileEdit, FileWrite, WebFetch specific cards
- [x] Context window visualization — `ContextBar.tsx` with stacked bar + legend, polls `/api/context` every 8s
- [x] Rate limit + cost bar — `PanelTop` polls `/api/usage` every 10s, shows `$0.042` style cost
- [x] Workspace code search — `SearchDialog.tsx` + `/api/search` ripgrep endpoint, Ctrl+Shift+F trigger
- [x] Export conversation — ExportDialog with copy-to-clipboard and download .txt; triggered from PanelTop
- [x] Model switcher — ModelPicker dropdown in PanelTop to switch Opus/Sonnet/Haiku
- [x] Prompt history search — HistoryDialog with fuzzy search, Ctrl+Shift+H trigger
- [x] Thinking effort selector — EffortPicker (low/medium/high) in PanelTop next to ModelPicker
- [x] Image/file attachment — paste/drag-drop images into ActionBar input
- [x] `/api/*` route adapter in RCS — full adapter with auth, state, tools, chat stream/control, session messages, suggest, command/execute
- [x] Fix SSE event normalization — `useStream.ts` handles both `{ type, data }` and `{ type, payload }` shapes
- [x] Running cost display — `$0.042` style cost in PanelTop alongside token counts
- [x] Keyboard shortcut help — `?` button + overlay listing all shortcuts
- [x] Session rename UI — rename button visible in Sidebar (already implemented)

## High Priority

- [x] **`/api/context` endpoint** — token breakdown by category (system, user, assistant, tool) with percentages
- [x] **`/api/usage` endpoint** — rate limit status + running cost (input/output pricing at $3/$15 per million tokens)
- [x] **`/api/history` endpoint** — all past user prompts across sessions, sorted by timestamp
- [x] **`/api/sessions/:id/rewind` endpoint** — delegates /rewind as user message to session
- [x] **`/api/search` endpoint** — ripgrep-powered workspace search with JSON output

## Medium Priority

- [x] **Compact/summarize context** — `/compact` slash command works via `/api/command/execute`; delegates to active session
- [x] **Multi-agent coordinator panel** — `AgentPanel.tsx` shows live agent status, elapsed time, last output; toggled via Bot icon in PanelTop
- [x] **Sub-agent progress tree** — `AgentPanel` reads `toolCalls` with `kind === "Agent"` from `useStreamContext`, shows nested agent hierarchy
- [x] **MCP server management** — `McpManagerDialog.tsx` + `/api/mcp` GET/POST/DELETE; triggered from PanelTop (Database icon)
- [x] **Memory file manager** — `MemoryDialog.tsx` + `/api/memory` GET/PUT; triggered from PanelTop (BookOpen icon)

## Low Priority

- [x] **Rewind last turn** — Undo button in ActionBar calls `/api/sessions/:id/rewind`
- [x] **Bug report / feedback** — `BugReportDialog.tsx` structured bug report with optional transcript; copies to clipboard; Ctrl+Shift+B shortcut
- [ ] **Voice input** — microphone push-to-talk (behind feature flag)
- [x] **Diagnostics page** — `DiagnosticsDialog.tsx` checks API, auth, state, tools, MCP, memory; triggered from PanelTop (Stethoscope icon)

## CLI → API surface (expose all CLI features as REST endpoints)

- [x] `/api/auth/init` + `/api/auth/verify` + `/api/auth/validate` — token-based auth flow
- [x] `/api/sessions` CRUD — create, list, get, kill, rename
- [x] `/api/sessions/:id/stream` GET — SSE event stream (fix shape to match `ServerEvent`)
- [x] `/api/chat/stream` POST — send message, returns SSE
- [x] `/api/chat/control` POST — permission response
- [x] `/api/chat/interrupt` POST — interrupt session
- [x] `/api/state` GET — model, permissionMode, tokenUsage, cwd, gitBranch
- [x] `/api/state` PATCH — change model, permissionMode, thinking effort
- [x] `/api/suggest/files` GET — `@` file mention suggestions
- [x] `/api/suggest/commands` GET — `/` slash command suggestions
- [x] `/api/command/execute` POST — execute slash command
- [x] `/api/tools` GET — list available tools
- [x] `/api/sessions/:id/messages` GET — session transcript
- [x] `/api/context` GET — context window breakdown by category
- [x] `/api/usage` GET — rate limit status + running cost
- [x] `/api/search` GET — ripgrep workspace search
- [x] `/api/history` GET — past prompts with timestamps
- [x] `/api/sessions/:id/rewind` POST — undo last turn
- [x] `/api/mcp` GET/POST/DELETE — MCP server management
- [x] `/api/memory` GET/PUT — CLAUDE.md memory files

## Testing

- [x] **`scripts/test-api.sh`** — Comprehensive cURL smoke tests for all 32 API check-points (auth, sessions CRUD, chat stream, interrupt, control, state, tools, suggest, commands, context, usage, history, search, MCP, memory, rewind, error cases)
- [x] **Playwright MCP** — `.claude/settings.json` wired with `@playwright/mcp@latest` MCP server for browser automation within Claude Code
- [x] **Playwright E2E suite** — 6 new test files in `tests/integration/` covering:
  - `web-auth-flow.test.ts` — init/verify/validate, localStorage persistence, 401 rejection
  - `web-session-crud.test.ts` — create, list, get, rename, kill, 404 handling, UI navigation
  - `web-chat-stream.test.ts` — SSE stream connect, interrupt, permission response, rewind, empty state
  - `web-dialogs.test.ts` — Diagnostics, History, Search, Bug Report, MCP, Memory, keyboard shortcut help
  - `web-panel-interactions.test.ts` — Task list, Agent panel, Context bar, Export, Sidebar collapse
  - `web-keyboard-shortcuts.test.ts` — Ctrl+Shift+F/H/B, ?, Escape, Arrow key navigation

### Running Tests

```bash
# API smoke tests (requires: bun run rcs)
./scripts/test-api.sh

# Playwright E2E (requires: bun run rcs + cd web && bun run dev)
bun run playwright test

# Playwright in headed mode (to watch browser)
bun run playwright test --headed

# Single test file
bun run playwright test tests/integration/web-auth-flow.test.ts
```