# RCS Web UI — Gap Analysis vs Claude Code CLI

> Goal: Web UI = 100% CLI UX. This document tracks remaining gaps that still need to be fixed.

## 0. Verified Closures

- Root `/api/sessions` now provisions isolated session workspaces under `.workspace/` by default.
- Git-backed sessions now materialize as dedicated worktrees with persisted branch metadata.
- Root `/api/sessions/:id/fork` now creates a sibling workspace and clones persisted transcript/state.
- Root search, MCP, and memory routes can now resolve from `sessionId -> workspace` instead of only raw `cwd`.
- `/api/chat/stream` and `/api/sessions/:id/stream` now emit SSE keepalive frames so real clients survive >30s model/tool idle gaps.
- Live POST chat stream events now carry stable `seqNum` metadata so the web client can dedupe attach/replay events after route sync.
- Session history hydration now returns `lastSeqNum`, and the web route loader seeds that replay cursor before attaching SSE so reopen/reload does not duplicate assistant output.
- Real verification on 2026-05-01 confirmed:
  - `POST /api/sessions` returned `.workspace/worktrees/<sessionId>`
  - `GET /api/state?sessionId=...` returned the same isolated cwd + branch
  - a real model turn replied `WORKSPACE_OK`
  - `POST /api/sessions/:id/fork` returned a sibling worktree and replayed transcript in `/messages`
  - a real `curl` SSE turn returned `session_created -> message_start -> thinking_delta -> content_delta -> message_end`
  - that same `curl` SSE turn stayed alive across the idle gap via keepalive frames and ended with `KEEPALIVE_OK`
- Real verification on 2026-05-02 confirmed:
  - `GET /api/sessions/:id/messages` returned `lastSeqNum=7` for a completed turn
  - a browser reload of `/chat/<sessionId>` attached via `GET /api/sessions/:id/stream?from=7`
  - the reloaded DOM contained exactly one assistant leaf node for `RCS_DUP_OK_43` instead of a duplicated replay
  - a default-runtime `Edit` turn emitted a real `permission_request` with `old_string` / `new_string`
  - `POST /api/chat/control` approved that request without overriding the tool input
  - the isolated workspace file changed from `EDIT_ME_BEFORE` to `EDIT_ME_AFTER`
  - the assistant completed the turn with `EDIT_PERMISSION_DONE`

---

## 1. Architecture Gaps

### 1.1 Session Persistence
| Feature | CLI | Current Web/RCS | Gap |
|---------|-----|-----------------|-----|
| Session survives restart | ✅ File-based (`~/.claude/sessions/`) | ✅ SQLite persistence | OK |
| Session list persists | ✅ File system | ✅ SQLite sessions table | OK |
| Event history persists | ✅ Session file | ✅ SQLite events table (5000 limit) | OK |
| Resume conversation | ✅ `--resume` flag | ✅ `getOrSpawn(resume=true)` with `--resume` flag | OK |

### 1.2 Multi-Session
| Feature | CLI | Current Web/RCS | Gap |
|---------|-----|-----------------|-----|
| Multiple concurrent sessions | ✅ Many terminals | ⚠️ `subprocess-manager` (max 16) | OK, still in-memory handles |
| Switch between sessions | ✅ Separate terminal per session | ✅ URL routing | OK |
| Session isolation | ✅ Separate process per session | ✅ session-context.ts with AsyncLocalStorage | OK |
| Global state singleton | N/A (1 process = 1 session) | ✅ Per-session ALS isolation | OK |

### 1.3 Backend Architecture
| Feature | Target | Current | Gap |
|---------|--------|---------|-----|
| CLI logic in-process | ✅ Direct QueryEngine call | ❌ Subprocess spawn | Phase 3 |
| Feature flags | ✅ All enabled | ❌ Uses `bun:bundle` env flags | Hardcode true for RCS |
| DB abstraction | ✅ Interface (SQLite/PostgreSQL) | ❌ No DB abstraction | Phase 1 |
| Permission callbacks | ✅ EventBus-based | ❌ Ink UI (subprocess) | Phase 3 |

---

## 2. Streaming & Realtime Gaps

### 2.1 Event Flow
```
CLI event order:
session_created → message_start → thinking_delta(×N) → content_delta(×N)
→ tool_start → [running] → tool_result → content_delta(×N) → content_block → message_end

Parallel tools:
tool_start(A) → tool_start(B) → tool_result(A) → tool_result(B)
```

### 2.2 Thinking
| Feature | CLI | Current Web | Gap | Priority |
|---------|-----|-------------|-----|----------|
| Collapsed by default | ✅ `∴ Thinking (ctrl+o)` | ✅ `ThinkingCollapsible` | OK | — |
| Dim italic content | ✅ `dimColor italic` | ✅ Styling exists | OK | Low |
| Auto-hide 30s after streaming ends | ✅ `streamingEndedAt + 30000ms` | ✅ Implemented in ThinkingCollapsible | OK |
| Only show latest thinking block | ✅ `lastThinkingBlockId` | ✅ Thinking appends to last block | OK |
| `∴ Thinking` label | ✅ | ✅ | OK | Low |
| Expand/collapse toggle | ✅ `ctrl+o` | ✅ Click collapsible | OK |

### 2.3 Content (Text) Streaming
| Feature | CLI | Current Web | Gap | Priority |
|---------|-----|-------------|-----|----------|
| Character-by-character | ✅ Append every delta | ✅ `content_delta` append | OK |
| `●` prefix while streaming | ✅ `BLACK_CIRCLE` | ✅ Implemented in Conversation.tsx | OK |
| Separate `StreamingMarkdown` | ✅ Outside message list | ⚠️ Inside message object | Low (acceptable) |
| Markdown rendering | ✅ Ink Markdown | ✅ Markdown render exists | OK |
| Code syntax highlighting | ✅ | ✅ Shiki | OK |
| Finalize on `content_block` | ✅ Clear streaming buffer | ✅ Clears streaming state | OK |

### 2.4 Tool Calls
| Feature | CLI | Current Web | Gap | Priority |
|---------|-----|-------------|-----|----------|
| Spinner animation while running | ✅ `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | ✅ Loader2 with animate-spin | OK |
| Tool start event | ✅ | ✅ `tool_start` SSE exists | OK |
| Tool result event | ✅ | ✅ `tool_result` SSE renders correctly | OK |
| Tool name + input preview | ✅ `name - {input...}` (50 chars) | ✅ `tool_input_delta` updates title in realtime | OK |
| `✓` on success | ✅ Green checkmark | ✅ Check icon | OK |
| `✗` on failure | ✅ Red X | ✅ X icon | OK |
| Elapsed time display | ✅ `(2.3s)` | ✅ Tracked via toolStartTimesRef | OK |
| Output preview (last 5 lines) | ✅ | ✅ `outputLines.slice(-5)` | OK |
| Expandable full output | ✅ | ✅ Has `item.output` | OK |
| Parallel tool rows | ✅ Multiple rows concurrently | ✅ Map-based | OK |
| Tool color by type | ✅ Bash=yellow, Read=cyan... | ✅ Implemented via getToolColor() | OK |
| Tool-specific rendering | ✅ DiffView for Edit, code for Read | ✅ `DiffViewer` exists | OK |
| Live output while tool is running | ✅ Bash stdout in realtime | ✅ tool_output_delta events | OK |
| Incremental tool input updates | ✅ | ✅ `tool_input_delta` handled | OK |
| Full CLI-feel tool timeline | ✅ | ✅ start → input_delta → result | OK |
| End-to-end multi-tool turn parity | ✅ | ✅ Verified with real API/UI turns (multi-tool + replay) | OK |
| Thinking + tool + response in one turn | ✅ | ✅ Transport works | OK |
| Permission/tool parity end-to-end | ✅ | ✅ Verified | OK |
| Full tool output source parity | ✅ | ✅ `message.content.tool_result` + `tool_use_result` | OK |
| Realtime command/input preview | ✅ | ✅ `tool_input_delta` updates title | OK |
| Tool result id matches tool start id | ✅ | ✅ Verified `toolCallId` match | OK |
| Tool result text extraction | ✅ | ✅ Verified correct result text | OK |
| Tool input reconstruction from stream | ✅ | ✅ `tool_input_delta` accumulates | OK |
| Permission replay on reconnect after tool | ✅ | ✅ Replay via pending_permissions | OK |
| Rich tool lifecycle like CLI | ✅ | ✅ Full pipeline working | OK |
| Realtime partial tool stdout | ✅ | ✅ `tool_output_delta` with stream=stdout/stderr | OK |
| Tool result persisted/replayed | ✅ | ✅ pending_permissions + replay on reconnect | OK |
| Tool event ordering robustness | ✅ | ✅ Verified | OK |
| Tool card content after reconnect | ✅ | ✅ Permission replay + stream replay | OK |
| Subprocess tool event shape normalization | ✅ | ✅ Fixed `type=user` → `tool_result` | OK |
| Missing tool result root cause | N/A | ✅ Fixed: subprocess emits `type=user` | Resolved |
| Missing tool result fix status | N/A | ✅ Fixed in `subprocess-manager.ts` | Resolved |
| CLI-equivalent tool observability | ✅ | ✅ Full parity | OK |
| Tool output visible in web UI | ✅ | ✅ | OK |

### 2.5 Permission Flow
| Feature | CLI | Current Web | Gap | Priority |
|---------|-----|-------------|-----|----------|
| Inline permission card | ✅ In message flow | ✅ `PermissionPanel` | OK |
| Approve/Deny buttons | ✅ `y/n` keyboard | ✅ Buttons | OK |
| Edit tool input before approval | ✅ `e` key | ✅ `updatedInput` wired to API | OK |
| Tool-specific permission card | ✅ Bash shows command, Edit shows diff | ✅ Real default-runtime `Edit` permission prompt + approval verified end to end. | OK |
| Permission replay on reconnect | ✅ N/A (same process) | ✅ Replay via pending_permissions table | OK |
| Always allow option | ✅ `a` key | ✅ `alwaysAllow` in API + UI | OK |

---

## 3. UI/UX Gaps

### 3.1 Layout & Navigation
| Feature | CLI | Current Web | Gap | Priority |
|---------|-----|-------------|-----|----------|
| Session sidebar | N/A (terminal) | ✅ Sidebar | OK |
| Session rename | ✅ `/name` command | ✅ Rename UI | OK |
| Session kill | ✅ `/quit` | ✅ Kill button | OK |
| New session | ✅ New terminal | ✅ `/new` route | OK |
| Session status indicator | ✅ Process alive/dead | ✅ `connectionState` badge (connected/interrupted/reconnecting) | OK |
| Active session highlight | N/A | ✅ | OK |

### 3.2 Input Area
| Feature | CLI | Current Web | Gap | Priority |
|---------|-----|-------------|-----|----------|
| Multi-line input | ✅ Shift+Enter | ✅ | OK |
| File attachment (`@`) | ✅ Tab completion | ✅ Verified in real UI (`@` suggestions + file refs) | OK |
| Slash commands | ✅ `/help`, `/model`, `/clear`... | ⚠️ Attached-session and no-session slash commands now route through `/api/command/execute`; `/cost` + `/files` + `/release-notes` are backend-native, and both workspace workflow commands from `.claude/workflows/` plus project markdown commands from `.claude/commands/` now resolve instead of 404. Full CLI catalog is still partial | Medium |
| Input disabled while streaming | ✅ | ✅ | OK |
| Cancel stream (Escape) | ✅ Ctrl+C / Escape | ✅ `cancelStream` | OK |
| Command history (↑↓) | ✅ | ✅ Implemented in ActionBar.tsx | OK |
| Tab completion | ✅ Files, commands | ✅ `triggerState` + `@` / `/` support | OK |

### 3.3 Message Display
| Feature | CLI | Current Web | Gap | Priority |
|---------|-----|-------------|-----|----------|
| User message styling | ✅ `> ` prefix, bold | ✅ Terracotta bubble | OK |
| Assistant message styling | ✅ Plain text | ✅ Warm sand bubble | OK |
| Copy code button | N/A | ✅ | OK |
| Selection tooltip (reply/copy) | N/A | ✅ `SelectionTooltip` | OK |
| Image display | ✅ (terminal image) | ✅ `content_block` with image type | OK |
| Error message styling | ✅ Red text | ✅ `state.error` displayed | OK |

### 3.4 Status & Info
| Feature | CLI | Current Web | Gap | Priority |
|---------|-----|-------------|-----|----------|
| Token/context usage | ✅ `/cost` command | ✅ `UsageWarnings` component + backend-native `/cost` for attached sessions | OK |
| Cost display | ✅ `/cost` | ✅ `UsageWarnings` component + backend-native `/cost` for attached sessions | OK |
| Model indicator | ✅ Shown in prompt | ✅ `ModelPicker` | OK |
| Rate limit warning | ✅ | ✅ `UsageWarnings` shows `rateLimit` | OK |
| Context window warning | ✅ Auto-compact notification | ✅ `UsageWarnings` shows `usedPct` | OK |

---

## 4. Reconnect & Error Handling Gaps

| Feature | CLI | Current Web | Gap | Priority |
|---------|-----|-------------|-----|----------|
| Network disconnect → reconnect | N/A (local) | ✅ Retries with exponential backoff in useStream | OK |
| Stale session → graceful fallback | N/A | ✅ `sessionMissing` state + "Start new session" UI | OK |
| Session interrupted indicator | N/A | ✅ `connectionState: 'interrupted'` + Resume banner | OK |
| Retry failed message | ✅ Auto-retry API | ✅ Retries implemented in useStream | OK |
| Error toast/banner | ✅ Inline error | ✅ `state.error` displayed in UI | OK |
| Backend restart detection | N/A | ✅ `serverEpochRef` + `connectionState: 'restarted'` | OK |

---

## 5. Feature Parity Gaps

| Feature | CLI | Current Web | Gap | Priority |
|---------|-----|-------------|-----|----------|
| Plan mode | ✅ `/plan` | ✅ Plan approval UI exists | OK |
| Agent/subagent | ✅ `AgentTool` | ✅ `AgentPanel` exists | OK |
| Task list | ✅ `TodoWrite` | ✅ `TaskList` component | OK |
| MCP servers | ✅ `/mcp` | ✅ Verified with real API + real UI dialog | OK |
| Memory files (`CLAUDE.md`) | ✅ `/memory` | ✅ Verified with real API + real UI dialog | OK |
| Workspace search | ✅ Grep/Glob | ✅ Verified with real API + real UI dialog | OK |
| Diff view for edits | ✅ Inline diff | ✅ `DiffViewer` | OK |
| Mermaid diagrams | N/A | ✅ `MermaidPanel` | Bonus |
| Export conversation | ✅ `/export` | ✅ Verified with real UI export dialog | OK |
| Keyboard shortcuts help | ✅ `/help` | ✅ `KeyboardShortcutHelp` | OK |

---

## 6. Implementation Priority

### P0 — Critical (blocks basic usage)
1. ~~SQLite persistence (sessions + events)~~ ✅ Done
2. ~~Frontend stale session graceful fallback~~ ✅ Done
3. ~~Tool elapsed time tracking + display~~ ✅ Done
4. ~~Live tool output while running (Bash stdout)~~ ✅ Done
5. ~~Permission replay on reconnect~~ ✅ Done
6. ~~Backend restart detection + "session interrupted" UI~~ ✅ Done

### P1 — High (noticeable UX gap)
7. ~~Spinner animation for running tools~~ ✅ Done
8. ~~`●` prefix for streaming text~~ ✅ Done
9. ~~Tool color mapping by type~~ ✅ Done
10. ~~Network disconnect → auto-reconnect~~ ✅ Done
11. ~~AsyncLocalStorage (multi-session in-process)~~ ✅ Done
12. ~~Thinking auto-hide after 30s~~ ✅ Done

### P2 — Medium (polish)
13. ~~Always allow option for permissions~~ ✅ Done
14. ~~Edit tool input UI~~ ✅ Done
15. ~~Token/cost display in UI~~ ✅ Done
16. ~~Rate limit + context window warnings~~ ✅ Done
17. ~~Error retry mechanism~~ ✅ Done
18. ~~Session status indicator (active/interrupted/idle)~~ ✅ Done
19. ~~Full slash command parity~~ ⚠️ Attached-session and no-session slash commands now route through `/api/command/execute`; `/cost` + `/files` + `/release-notes` are backend-native, and both workspace workflow commands from `.claude/workflows/` plus project markdown commands from `.claude/commands/` now resolve instead of 404. Full CLI catalog parity is still partial

### P3 — Low (nice to have)
20. ~~Command history (↑↓)~~ ✅ Done
21. ~~Tab completion~~ ✅ Done
22. ~~Image display~~ ✅ Done
23. ~~Only show latest thinking block~~ ✅ Done

---

## 7. Architecture Roadmap

```
Phase 1: SQLite Persistence
  ✅ DB layer with SQLite
  ✅ Persist sessions + events
  ✅ Hydrate EventBus from DB on restart
  ✅ Frontend graceful stale session

Phase 2: AsyncLocalStorage (Multi-Session)
  ✅ SessionContext type + ALS store
  ✅ Per-session isolation in RCS

Phase 3: Embed CLI Logic → RCS Direct
  → Replace subprocess with QueryEngine call
  → Replace Ink UI → EventBus callbacks
  → Remove subprocess-manager

Phase 4: Production Ready
  → Enable all features (no env vars)
  → DB abstraction layer (SQLite/PostgreSQL)
  → Clean CLI entrypoint → thin wrapper
```

---

## 8. Remaining Open Items

### High Priority (not yet implemented)
- **Phase 3 architecture**: Embed CLI logic in-process (subprocess → direct QueryEngine)

### Medium Priority
- Feature flags in RCS still depend on `bun:bundle` gating instead of an RCS-owned always-on contract
- DB abstraction layer (SQLite/PostgreSQL) is still missing
- Permission callbacks still depend on subprocess/Ink instead of backend-native EventBus handlers
- Slash command full parity beyond current `/api/command/execute` coverage (many local CLI-only commands, user/global skills, richer custom command coverage, and security-gated commands remain partial)
- Export conversation dialog verification

### Phase 3 Items (refactor, not bug)
- CLI logic in-process (direct QueryEngine call)
- DB abstraction (interface for SQLite/PostgreSQL)
- Permission callbacks (EventBus-based, not Ink UI)
- Feature flags (all enabled, no bun:bundle env)

---

*Last updated: 2026-05-02 (After backend-native /release-notes verification)*

---

## 7. Changes Applied 2026-05-02 (Session 2)

### P0: Live Runtime State Updates — Complete
- `PATCH /api/state` now forwards all three runtime knobs to the running CLI worker via `control_request`:
  - `model` → `set_model`
  - `permissionMode` → `set_permission_mode`
  - `thinkingEffort` → `set_max_thinking_tokens` (via `effortToThinkingTokens` mapping)
- 6 tests in `api-state-patch.test.ts`, all passing

### Gap Closures
- **EffortPicker**: Extended from 3 levels (low/medium/high) to 5 (low/medium/high/xhigh/max)
- **PermissionModePicker**: New component added to PanelTop alongside ModelPicker and EffortPicker
- **Slash command catalog**: Expanded from 55 to 67 commands. Added: effort, privacy-settings, hooks, export, usage-report, upgrade, ultra-review, context, copy, ide, rename, passes
- **No-session fallback**: `workspace-access.ts` now uses `DEFAULT_WORKSPACE` env var before `process.cwd()`
- **Legacy session migration**: `POST /api/admin/migrate-legacy-sessions` route (apiKeyAuth required) finds sessions without workspaces and materializes them
- **Transcript block shapes**: Audited — `buildArtifact()` in `hydrateSessionMessages.ts` handles all block types generically, `Conversation.tsx` renders artifacts. No gaps found.

### Remaining
- Session runtime isolation still subprocess-based (Phase 3)
- Not every possible CLI block shape is explicitly tested in rehydration
- Slash command catalog still partial (CLI has ~90 commands, catalog has 67)
- Legacy sessions can still exist until migration is run
