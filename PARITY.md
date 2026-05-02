# PARITY.md

> Goal: define what "1:1 with Claude Code on the web" should mean for this repo.
>
> Date: 2026-05-01
>
> Scope: parity of the session/workspace/environment contract and UX while moving **CLI UI/UX -> Web UI** and **CLI runtime/logic -> Backend Core**, not a literal copy of Anthropic's cloud infrastructure.

---

## Bottom Line

Today the root web flow is no longer `same-dir` by default:

- new sessions materialize into `.workspace/worktrees/<sessionId>` for git repos
- non-git targets materialize into isolated `.workspace/workdirs/<sessionId>`
- session runtime state and transcript replay are persisted per session
- root-web fork now creates a sibling workspace and clones persisted transcript/state

The remaining parity gap is no longer "shared cwd tabs." It is the deeper architecture:

- runtime still flows through CLI subprocesses
- command/permission behavior is still not fully backend-native
- environment/work-item substrate is still only partially reused by the root `/api/*` lane

The target model should be:

`1 session = 1 workspace = 1 worker = 1 durable transcript = 1 session-scoped runtime state`

Use `workspace` as the product/domain concept.
Use `worktree` as the default git-backed implementation for materializing a workspace.

---

## Platform North Star

```text
Old:
Web -> CLI flags/subprocess -> runtime

Target:
Web / CLI / integrations
        -> Backend APIs
        -> Backend Core
```

### Translation

- **CLI UI/UX -> Web UI**
- **CLI runtime / logic -> Backend Core**
- Web becomes the primary user-facing surface
- CLI, if retained during migration, should become a thin client over backend contracts

### Consequences

- Session/workspace/state/transcript must be backend-owned resources
- Command/skill, tool, MCP, memory, and search semantics must live in backend services
- `subprocess-manager` and CLI flags are migration scaffolding, not the target architecture
- "Parity" does not mean preserving CLI shell structure; it means preserving user-visible behavior while extracting the runtime into a reusable backend platform

---

## Parity Classes

| Class | Meaning |
|------|---------|
| `Exact` | User-visible behavior should match Claude Code web semantics. |
| `Local Approximation` | Behavior should feel equivalent, but the implementation can be local instead of Anthropic-managed cloud infra. |
| `Phase 2` | Real parity item, but can land after core multiple-session correctness. |
| `Not Target` | Anthropic cloud/platform behavior that does not need to be copied for this local-first repo. |

---

## Parity Matrix

| Capability | Claude Code web contract | Parity class | Local target for this repo | Current repo status | Gap |
|------|---------|------|---------|------|------|
| Session runtime isolation | Each web session runs in a fresh Anthropic-managed VM and works on isolated changes. | `Local Approximation` | Each session gets its own persisted workspace path and its own worker process. | `Mostly implemented` | New root-web sessions now materialize into isolated worktrees/workdirs by default and chat/resume run from that persisted workspace. Remaining gap: worker runtime is still subprocess-based instead of backend-core owned. |
| Session = workspace binding | A session is not just a chat thread; it is bound to an environment/repo/branch. | `Exact` | Persist a workspace record and resolve everything from that record, never from process-global cwd. | `Mostly implemented` | Root `/api/*` session creation now persists materialized workspace metadata and the web client consumes that canonical workspace path/branch. Remaining gap: explicit no-session fallbacks can still end at raw `cwd`/`process.cwd()` for standalone utility use. |
| Durable transcript and full rehydrate | Reopening a session restores the real history: messages, tool calls, tool results, and thinking. | `Exact` | Session history API must return reconstructable structured transcript blocks. | `Mostly implemented` | `/api/sessions/:id/messages` now rebuilds structured user/assistant/tool/thinking blocks, returns a replay cursor, and the web UI rehydrates + reattaches without duplicating assistant output on reload. Remaining gap: this is proven for core turn artifacts, not every possible CLI block shape. |
| Session-scoped runtime state | Model, permission mode, and reasoning/thinking settings are session-level, not process-global. | `Exact` | Store and restore runtime state per session. | `Partial` | `/api/state` is now session-aware and persists `model` / `permissionMode` / `thinkingEffort`, and subprocess spawn consumes session `model` + `permissionMode`. Remaining gap: not every runtime knob is wired live into already-running workers. |
| Parallel sessions by default | Parallel sessions should not stomp each other's files or runtime state. | `Exact` | Default to isolated workspaces, not shared cwd. | `Mostly implemented` | Root-web session creation and first-run upgrade now converge on isolated worktrees/workdirs, so parallel sessions no longer share the repo working directory by default. Remaining gap: legacy sessions created before this migration can still exist until reopened or replaced. |
| Resume semantics | Reopen the same session, on the same work context, with the same transcript. | `Exact` | Resume should reattach or respawn into the same workspace with the same session state. | `Mostly implemented` | Resume upgrades legacy same-dir sessions onto managed workspaces and respawns the worker against the persisted workspace path. Remaining gap: the restart path is still subprocess-driven, not backend-core owned. |
| Fork semantics | Fork creates a new session from existing history without mutating the original. | `Exact` | New session ID, copied transcript seed, sibling workspace/branch. | `Implemented` | Root `/api/sessions/:id/fork` now creates a sibling workspace, copies session state, and clones persisted transcript events. Remaining gap: transcript cloning currently follows persisted events, not a dedicated backend-core transcript model. |
| Environment lifecycle | Sessions run inside a chosen environment; environments can be prepared, reused, or recreated after runtime expiry. | `Local Approximation` | Model environment as a reusable profile plus workspace materialization under `.workspace/`. | `Partial` | The repo already has `environments`, `work_items`, `session_workers`, and `/v1/environments/*`, but the root `/api/*` web path mostly bypasses that substrate and does not dispatch work the way the environment lanes do. |
| Repo and branch identity | A session is tied to repo/branch state and the UI can surface that identity. | `Exact` | Persist repo root, branch, base ref, and workspace path on the session/workspace record. | `Mostly implemented` | New root-web sessions now persist repo root, base ref, branch, and materialized workspace path; the web sidebar/state surface that branch identity. Remaining gap: current mapping is single-repo and normalizes session cwd to the repo root for git-backed worktrees. |
| Multi-repo session | Claude Code web remote sessions can include multiple repositories. | `Phase 2` | Data model should allow 1..N repos per workspace even if v1 only materializes one. | `Missing` | Current flow is single-cwd only and has no repo set or repo-mount model. |
| Review / archive / delete | Web sessions can be reviewed, archived, or deleted from the UI. | `Phase 2` | Diff review plus archive/delete first; sharing can be deferred for local-only mode. | `Partial` | Delete/archive from the root web route now dematerializes managed workspaces, but review/archive lifecycle is still incomplete at the product level. |
| Share / teammate handoff | Claude Code web lets users share sessions and collaborate through Anthropic surfaces. | `Not Target` | Optional later. | `N/A` | This is cloud-product behavior, not core local parity. |
| Teleport cloud session to terminal | Cloud session can move into terminal with branch + history restored. | `Not Target` | Optional later. | `N/A` | Valuable, but not required for "real multiple session" parity in this repo. |
| Security / isolation model | Anthropic runs the session in managed cloud infra with scoped credentials and isolation. | `Local Approximation` | Local sandbox plus per-workspace env injection; no session-bound behavior may leak through `process.cwd()`. | `Partial` | Session-bound search/memory/MCP/state routes now resolve from session workspace context and new sessions default to isolated worktrees/workdirs. Remaining gap: standalone utility fallbacks and shared local credentials are still fundamentally weaker than Anthropic-managed cloud isolation. |

---

## What Must Match First

These are the minimum conditions for this repo to feel like a real Claude Code web multiple-session system:

1. A session must own a durable workspace record.
2. Every session-bound API must resolve from that workspace record, not from `process.cwd()`.
3. Transcript replay must restore the full turn structure, not only user text.
4. Runtime state must be persisted per session.
5. Resume must reopen the same workspace.
6. New sessions must isolate code changes by default.

If any of those are missing, the product is still effectively "single-session with tabs."

For this repo, one more implementation rule is now explicit:

7. The backend, not the CLI shell, must own the runtime contract.

---

## Recommended Local Mapping

| Claude Code web concept | Local-first mapping for this repo |
|------|---------|
| Fresh cloud VM per session | Fresh workspace per session |
| Cloud environment | Local environment profile + worker registration |
| Cached filesystem snapshot | Prepared workspace template or cached bootstrap under `.workspace/` |
| Session attached to repo/branch | Session attached to workspace path + repo metadata |
| Parallel cloud sessions | Parallel workers bound to separate workspaces |
| Runtime expiry and reopen | Worker can die; session survives and respawns in same workspace |

The key point is:

- **workspace** is the stable object
- **worker** is replaceable
- **transcript/state** survive worker restarts
- **backend core** owns the lifecycle
- **UI clients** only render and invoke backend APIs

---

## Recommended Workflow

1. User clicks `New session`.
2. Server creates a `session` record and a `workspace` record.
3. Workspace is materialized under `.workspace/`.
4. If the target is a git repo, materialize the workspace as a git worktree by default.
5. If the target is not a git repo, materialize an isolated working directory instead.
6. Persist session-scoped state: model, permission mode, reasoning/thinking mode, selected repos, branch/base ref, workspace path.
7. Spawn one worker bound to that workspace path.
8. Persist transcript/events as the worker runs.
9. On reconnect, replay persisted transcript first, then attach live stream.
10. On resume, restart the worker in the same workspace.
11. On fork, create a new session ID plus a sibling workspace and branch from the source session.
12. On archive, optionally prune the materialized workspace but keep transcript/state metadata.

If a CLI client still exists during migration, it should call the same backend session/workspace/runtime APIs rather than being the runtime owner.

---

## `.workspace/` Shape

```text
.workspace/
  sessions/
    <sessionId>/
      session.json
      state.json
      worker.json
      transcript.ndjson
      logs/
      events/
  worktrees/
    <sessionId>/
  workdirs/
    <sessionId>/
  cache/
    <environmentId>/
  index.sqlite
```

Notes:

- `sessions/<sessionId>/` is the durable control-plane record.
- `worktrees/<sessionId>/` is the preferred git-backed workspace materialization.
- `workdirs/<sessionId>/` is the fallback for non-git targets.
- `cache/<environmentId>/` is the local analogue of a prepared environment snapshot.

---

## Important Current-Code Evidence

- `packages/remote-control-server/src/services/session-workspace.ts`
  Root-web session creation now upgrades the placeholder workspace row into an isolated managed workspace under `.workspace/`, preferring git worktrees and falling back to copied workdirs.
- `packages/remote-control-server/src/routes/web/sessions.ts:18-40`
  The older web session lane does dispatch work to an environment when `environment_id` is present.
- `packages/remote-control-server/src/routes/v1/sessions.ts:16-39`
  The v1 session lane also dispatches environment work, which highlights how the root `/api/*` adapter bypasses that model.
- `packages/remote-control-server/src/routes/api/index.ts`
  Create/resume/chat now materialize managed workspaces, fork now clones sibling workspaces plus persisted transcript, `/api/sessions/:id/messages` rebuilds structured transcript blocks, `/api/state` persists session runtime state, and the SSE routes now emit keepalive frames plus stable `seqNum` metadata for replay dedupe.
- `packages/remote-control-server/src/routes/api/index.ts`
  Search, MCP, and memory flows now resolve from session/workspace-aware cwd resolution when a session is present, though standalone fallback paths still end at `process.cwd()`.
- `packages/remote-control-server/src/services/subprocess-manager.ts:954-997`
  Multiple per-session subprocesses already exist.
- `packages/remote-control-server/src/services/session-context.ts:12-44`
  Per-session `AsyncLocalStorage` isolation already exists.
- `src/bridge/types.ts:63-69`
  The bridge layer already distinguishes `single-session`, `worktree`, and `same-dir`.
- `src/bridge/bridgeMain.ts:2292-2303`
  The bridge currently defaults multi-session to `same-dir` when the multi-session gate is enabled.
- `packages/remote-control-server/src/db.ts:32-120`
  The DB already has environment, session, work item, event, and pending-permission tables.
- `packages/remote-control-server/src/routes/v1/environments.ts:8-36`
  The repo already has an environment registration lane.
- `packages/remote-control-server/src/routes/v1/environments.work.ts:8-39`
  The repo already has a work-dispatch lane.
- `web/src/features/chat/hydrateSessionMessages.ts:128-225`
  Frontend history hydration already expects structured session messages.
- `web/src/pages/Index.tsx:532-549`
  The route session loader assumes the history endpoint can provide that structured transcript.
- `web/src/hooks/useSessions.ts`
  The web client now consumes create/fork session APIs that return backend-owned workspace metadata, rather than assuming a raw cwd is the workspace contract.
- `scripts/dev-all.mjs:70-85`
  Dev reset wipes DB/artifacts, but it is not yet a real workspace/session store reset.
- `src/screens/REPL.tsx:4138-4141`
  The CLI/remote path still distinguishes commands that render locally in the CLI process, which is exactly the kind of UI-owned logic that must move behind backend contracts.
- `src/commands.ts:510-582`
  The real command/skill graph already exists in code, but it is still discovered from CLI-oriented command loading rather than exposed as backend-owned APIs.

---

## Architectural Conclusion

The fastest path to real parity is **not** to keep extending the root `/api/*` adapter around `process.cwd()`, and **not** to preserve the CLI shell as the runtime owner.

The fastest path is:

1. Promote `workspace` to a first-class persisted object.
2. Make `.workspace/` the canonical session/workspace store.
3. Route all session-bound behavior through `session -> workspace -> worker`.
4. Treat `worktree` as the default implementation of a workspace, not the domain model itself.
5. Reuse the existing environment/work-item substrate instead of letting the root web lane bypass it.
6. Extract QueryEngine, command/skill semantics, tool orchestration, MCP, memory, and search into backend-owned services.
7. Let web replace CLI at the UI layer, rather than wrapping CLI execution forever.

If we do that, "multiple sessions" stops meaning "many chat IDs" and starts meaning "many isolated coding workspaces," which is the actual Claude Code web behavior users care about.

And the platform direction becomes reusable beyond web:

```text
Web / future clients / integrations
          -> Backend APIs
          -> shared runtime core
```

That is the architecture needed if the long-term goal is a real backend platform, not a permanent CLI adapter.

---

## Verification Standard

Parity should not be declared complete from mocked tests alone.

### Verified on 2026-05-01

- `POST /api/sessions` returned `cwd=/data/projects/ultraplan/.workspace/worktrees/<sessionId>`
- `GET /api/state?sessionId=...` returned the same isolated cwd plus `gitBranch=main-rcs-...`
- A real model turn replied `WORKSPACE_OK` from the isolated workspace
- `POST /api/sessions/:id/fork` returned a sibling worktree and `/api/sessions/:forkId/messages` replayed the cloned transcript
- A real `curl` POST `/api/chat/stream` turn stayed open across the idle gap, emitted keepalive frames, and completed with `thinking_delta`, `content_delta`, and `message_end`
- `GET /api/sessions/:id/messages` returned `lastSeqNum=7` for a completed turn
- A real browser reload of `/chat/<sessionId>` reattached via `GET /api/sessions/:id/stream?from=7`
- The reloaded DOM contained exactly one assistant leaf node for `RCS_DUP_OK_43`, proving hydrate + replay no longer double-renders the assistant reply
- A real default-runtime `Edit` turn emitted `permission_request`, `POST /api/chat/control` approved it, and the isolated workspace file changed to `EDIT_ME_AFTER` before the assistant replied `EDIT_PERMISSION_DONE`

### Verified on 2026-05-02

- A real attached-session slash-command flow used `POST /api/sessions`, `GET /api/sessions/:id/stream`, and `POST /api/command/execute` only; the server log contained no `POST /api/chat/stream` request for that flow
- A real `POST /api/command/execute` `/cost` turn returned `200`, and `GET /api/sessions/:id/messages` persisted both the user `/cost` command and the assistant cost summary
- A real backend-native `/cost` turn streamed only `message_start`, `content_delta`, and `message_end` over the attached session SSE, proving it no longer depends on subprocess bootstrap for that command path
- A real no-session slash-command flow used `POST /api/command/execute?cwd=...`, returned a new `sessionId`, and `GET /api/state?sessionId=...` plus `GET /api/sessions/:id/messages` rehydrated the isolated workspace/session without any `POST /api/chat/stream` request
- A real no-session backend-native `/files` turn used `POST /api/command/execute?cwd=...` and `GET /api/sessions/:id/messages` only, and persisted `No files in context` without any `POST /api/chat/stream` request
- A real no-session backend-native `/release-notes` turn returned `200` over `POST /api/command/execute`, persisted the user command plus the changelog link in `GET /api/sessions/:id/messages`, and still did not touch subprocess bootstrap when `getOrSpawn`/`enqueueMessage` were forced to throw
- A real workspace workflow command in `.claude/workflows/release.md` appeared in `GET /api/suggest/commands?q=release&cwd=...`, and `POST /api/command/execute` for `/release` returned `200` with `executionMode: "prompt"` instead of `404`, then delegated into the isolated workspace runtime
- A real project markdown command in `.claude/commands/ops/deploy.md` appeared in `GET /api/suggest/commands?q=ops&cwd=...`, and `POST /api/command/execute` for `/ops:deploy` returned `200` with `executionMode: "prompt"` instead of `404`, then delegated into the isolated workspace runtime

### Backend/API acceptance

- Final pass criteria must include real `curl` calls against the running backend
- Verify the actual shipped routes and wait for the exact response or stream behavior the client depends on
- This applies especially to:
  - session creation
  - session resume
  - transcript/history hydration
  - SSE/chat streaming
  - state persistence
  - workspace-bound search/MCP/memory routes

### UI acceptance

- Final pass criteria must include real `browser-use` automation against the running UI
- Validate real user-visible behavior end to end, not just component-level assertions
- This applies especially to:
  - multiple-session switching
  - transcript replay on reopen
  - live thinking/content/tool streaming
  - permission prompts
  - reconnect/resume behavior

### Test policy

- Unit tests and mocked integration tests remain useful and should continue to exist
- But they are supportive evidence only
- A parity gap is only really closed when the real backend and real UI both behave correctly where applicable

---

## Sources

Official docs:

- Claude Code on the web: https://code.claude.com/docs/en/claude-code-on-the-web
- Web quickstart: https://code.claude.com/docs/en/web-quickstart
- How Claude Code works: https://code.claude.com/docs/en/how-claude-code-works
- Remote Control: https://code.claude.com/docs/en/remote-control
- Claude Code Desktop: https://code.claude.com/docs/en/desktop

Key external facts used from those docs:

- Claude Code web sessions run in fresh Anthropic-managed VMs.
- Sessions can be reopened even after the environment expires, with history restored on a fresh runtime.
- Remote/cloud sessions can add multiple repositories.
- Remote Control distinguishes `same-dir`, `worktree`, and single-session modes.
- Desktop/local parallel sessions use git worktrees for isolation by default.
