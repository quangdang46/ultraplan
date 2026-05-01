# Canonical Event Model and afterSeq Semantics

> Design doc: `bd-3fg.3.1.2`
> Status: spec — no implementation required
> Basis: existing `events` table schema, `pending_permissions` table, `sse-writer.ts` replay logic, and `PARITY.md` / `GAPS.md` session contracts

---

## 1. Canonical Event Envelope

Every event stored in the `events` table or transmitted over SSE must conform to this envelope:

```typescript
interface CanonicalEvent {
  // Identity
  id: string           // UUID, unique across the entire system
  sessionId: string   // Owning session — foreign key to sessions.id

  // Sequence
  seqNum: number       // Monotonically increasing integer, unique per session

  // Classification
  type: EventType
  direction: 'inbound' | 'outbound'  // client→backend vs backend→client

  // Timestamping
  timestamp: string    // ISO 8601, set at write time

  // Payload — structure is type-dependent (see below)
  payload: unknown

  // Replay cursor (used in SSE API, not stored in DB row)
  afterSeq?: number    // When present, signals "stream events with seqNum >= afterSeq"

  // Turn grouping (advisory, not ordering-critical)
  turnId?: string      // Groups events into a logical conversation turn
  turnPhase?: 'input' | 'processing' | 'output' | 'complete'
}
```

### EventType Enum

```typescript
type EventType =
  | 'user_message'      // inbound — user typed something
  | 'assistant_message'  // outbound — model emitted text
  | 'tool_use'          // outbound — model invoked a tool
  | 'tool_result'       // inbound — tool completed with output
  | 'thinking'          // outbound — model thinking (hidden delta)
  | 'permission_request' // outbound — awaiting user approval
  | 'error'             // bidirectional — operation failed
  | 'turn_end'          // advisory — turn boundary marker
  | 'turn_start'        // advisory — turn boundary marker
  | 'turn_interrupted'  // advisory — turn was interrupted
  | 'session_state'     // metadata — model/permission mode changes
  | 'task_state'        // task list changes
```

### Payload Shapes (by type)

| `type` | `direction` | `payload` shape |
|--------|-------------|-----------------|
| `user_message` | inbound | `{ content: string, messageId?: string }` |
| `assistant_message` | outbound | `{ content: string \| ContentBlock[], messageId: string, model?: string }` |
| `tool_use` | outbound | `{ toolName: string, toolInput: unknown, toolCallId: string }` |
| `tool_result` | inbound | `{ toolCallId: string, output: string \| object, success: boolean }` |
| `thinking` | outbound | `{ thinking: string, blockId: string }` |
| `permission_request` | outbound | `{ requestId: string, toolName: string, toolInput: unknown, alwaysAllow?: boolean }` |
| `error` | bidirectional | `{ error: string, code?: string, seqNum?: number }` |
| `turn_end` / `turn_start` / `turn_interrupted` | outbound | `{ turnId: string }` |
| `session_state` | outbound | `{ model?: string, permissionMode?: string, thinkingEffort?: string }` |
| `task_state` | bidirectional | `{ tasks: Task[], version: number }` |

### DB Storage Relation

The `CanonicalEvent` maps to the `events` table:

```sql
CREATE TABLE events (
  id         TEXT PRIMARY KEY,   -- UUID
  session_id TEXT NOT NULL,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,      -- JSON
  direction  TEXT NOT NULL,      -- 'inbound' | 'outbound'
  seq_num    INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_events_session_seq ON events(session_id, seq_num);
```

Additional per-session tables used by the event system:

```sql
CREATE TABLE pending_permissions (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  request_id  TEXT NOT NULL,
  payload     TEXT NOT NULL,  -- JSON: permission request details
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_pending_permissions_session ON pending_permissions(session_id);
CREATE UNIQUE INDEX idx_pending_permissions_session_request ON pending_permissions(session_id, request_id);
```

---

## 2. afterSeq Semantics

`afterSeq` is the **replay cursor** parameter used when a client connects to the SSE stream.

### Parameter Origin

`afterSeq` can arrive through three mechanisms (precedence order):

1. **Query param** — `?afterSeq=N` (primary)
2. **Query param alias** — `?from_sequence_num=N` (legacy兼容)
3. **SSE header** — `Last-Event-ID: N`

Parsed by `resolveReplayCursor()` in `sse-writer.ts`. All three map to the same internal cursor.

### Formal Definition

```
afterSeq=N
  → server streams ALL persisted events where seqNum >= N
  → after persisted backlog is exhausted, server switches to live event stream
```

### Behavior Table

| Condition | Behavior |
|-----------|----------|
| `afterSeq=0` or omitted | Live-only stream, no replay |
| `afterSeq` points into existing history | Replay events from cursor, then attach live stream |
| `afterSeq` equals current max `seqNum` | No backlog returned; immediately enter live-only mode |
| `afterSeq` exceeds current max `seqNum` | No backlog; immediately enter live-only mode (idempotent) |

### Handoff Window

When a client reconnects, there is a brief window where events may be published between disconnect and the reconnect subscription being established. The replay logic in `sse-writer.ts` addresses this by:

1. **Subscribing to the EventBus before reading the replay snapshot** — prevents missing events published during the handoff
2. **Buffering live events** until the replay backlog is drained
3. **Deduplicating by `seqNum`** — ensures no event is delivered twice even if it appears in both the replay snapshot and the live buffer

Implementation (`createSequencedSSEStream` in `sse-writer.ts`):

```typescript
// Subscribe before snapshot so events published in handoff are captured
unsub = bus.subscribe((event) => {
  if (!shouldDeliver(event)) return;

  if (!liveMode) {
    bufferedLiveEvents.push(event);  // buffer until replay is done
    return;
  }
  deliver(event);  // live delivery after replay exhausted
});

// Replay from persisted snapshot
if (afterSeqNum > 0) {
  for (const event of bus.getEventsSince(afterSeqNum)) {
    deliver(event);
  }
}
// Sort and drain buffer, then switch to live mode
bufferedLiveEvents.sort((a, b) => a.seqNum - b.seqNum);
for (const event of bufferedLiveEvents) {
  deliver(event);
}
liveMode = true;
```

### Boundary Condition

When `afterSeq` equals the current max persisted `seqNum`:

- The replay loop yields zero events (cursor is at the frontier)
- `liveMode` is set immediately
- Client receives only events published after the connect timestamp

This is intentional — it means "I have already seen everything up to N, give me everything from now on."

---

## 3. Deduplication Rules

### Core Rule: Idempotent Reconnect

Reconnecting with the same `afterSeq` value produces **identical persisted events plus any new events** published since the previous connection.

The server never re-issues an event with the same `(sessionId, seqNum)` pair.

### Client Responsibilities

| Responsibility | Description |
|---------------|-------------|
| Store last `seqNum` | Client should store the highest `seqNum` it has received and passed |
| Pass on reconnect | On reconnect, pass the last received `seqNum` as `afterSeq` |
| Handle duplicate delivery | Even with the deduplication logic, a client may receive the same event twice in a race window; clients must deduplicate by `(id)` or `(sessionId, seqNum)` |
| Acknowledge receipt | For permission events, resolution via `POST /api/sessions/:id/permission` constitutes an acknowledge |

### Race Window

```
timeline: ---[lastAckedSeq]----[reconnect]----[newEventPublished]----[streamStarts]----
              ↑                              ↑                         ↑
         last known              reconnect initiated      first new event
         safe cursor             (gap window)              in new stream
```

During the gap window (`[reconnect timestamp, stream starts]`), events with `seqNum > lastAckedSeq` may be published. These events:

1. Are persisted before the new subscription is active
2. Are included in the replay from `lastAckedSeq`
3. Are therefore delivered to the reconnecting client

No events are lost in the race window due to pre-subscription before snapshot.

### Deduplication Implementation (Server Side)

```typescript
// deliveredSeqNums is a Set<number> scoped to the current stream connection
const shouldDeliver = (event: SessionEvent) =>
  filter(event) && event.seqNum > afterSeqNum && !deliveredSeqNums.has(event.seqNum);

// Each delivered event is tracked to prevent double-delivery within a session
deliveredSeqNums.add(event.seqNum);
```

---

## 4. Ordering Guarantees

### Append-Only Invariant

The `events` table is **append-only**. No event is ever updated or deleted. The `seqNum` is the sole total order within a session.

### seqNum as Sole Ordering Guarantee

- **No event may be assumed to precede another based on wall-clock time**
- Two events with `seqNum=5` can never exist in the same session — `seqNum` is unique
- Turn boundaries (`turnId`, `turnPhase`) are **advisory grouping metadata**, not ordering constraints
- Events from concurrent producers (e.g., a tool result arriving while the model is still streaming) are ordered by `seqNum` — the lower `seqNum` happened first

### Turn Semantics

```
turnId: string     -- groups events belonging to the same logical turn
turnPhase: enum     -- 'input' | 'processing' | 'output' | 'complete'
```

A turn is a grouping convenience for the UI. A turn's events are always contiguous in `seqNum` order, but not all events belong to a turn (e.g., `session_state` events may fall between turns).

### Concurrent Session Handling

Each session has an independent `seqNum` sequence. There is no global ordering across sessions. Events from session A and session B are unrelated.

---

## 5. Pending Permission Preservation

### Requirement

Permission requests must survive worker restarts and client reconnects. A client that disconnects while a permission is pending must still see that permission request when it reconnects.

### Storage

Pending permissions are stored in the `pending_permissions` table:

```sql
CREATE TABLE pending_permissions (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  request_id  TEXT NOT NULL,
  payload     TEXT NOT NULL,  -- JSON, the permission request details
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Replay Order on Reconnect

When a client reconnects to a session with pending permissions, events are replayed in this order:

1. **Pending permissions** — emitted BEFORE any live or persisted events
2. **Persisted event backlog** — events from `events` table with `seqNum >= afterSeq`
3. **Live event stream** — events published after backlog exhaustion

This ensures the client cannot miss a pending approval that must be resolved before any other turn can proceed.

### Permission Lifecycle

```
permission_request event emitted → row inserted in pending_permissions
                                         ↓
user approves/denies → POST /api/sessions/:id/permission
                           → permission_response event recorded in events table
                           → pending_permissions row deleted
                           → turn resumes or terminates
```

If the worker dies with a pending permission, the `pending_permissions` row survives because it is session-scoped (not worker-scoped). On reconnect, the client sees the pending permission again.

---

## 6. Turn Lifecycle

### Turn States

A turn is the unit of conversation work — one user input plus the model's complete response (including tool calls and tool results).

```
pending_input → processing → awaiting_permission
                 ↓                ↓
              output          processing (after resolution)
                 ↓
              complete
                 
Any state → interrupted (worker death or cancel)
```

| State | Meaning |
|-------|---------|
| `pending_input` | Turn has been created but no user message received yet |
| `processing` | Turn is actively running — model thinking, tool execution |
| `awaiting_permission` | Turn is blocked waiting for a permission resolution |
| `output` | Turn is producing final text output |
| `complete` | Turn finished normally |
| `interrupted` | Turn was cancelled or worker died |

### Turn Transition Events

```
turn_start        → emitted when a new turn begins (first user message received)
  → (normal flow through processing/awaiting_permission/output states)
turn_end          → emitted when turn finishes (message_end equivalent)
turn_interrupted  → emitted when turn is cancelled or worker dies
```

These are **advisory markers** for UI grouping. The authoritative ordering is always `seqNum`.

### One Active Turn Rule

A session has **at most one active turn** at any time. New user input is queued (or rejected) if a turn is currently `processing` or `awaiting_permission`.

This simplifies replay — a reconnect never needs to reconstruct a partially-complete turn from interleaved events; the `turnPhase` field unambiguously marks the state.

### Turn and seqNum Relationship

Turn events are stored in the `events` table like any other event type:

```typescript
// Example turn event
{
  id: "uuid",
  sessionId: "session-123",
  seqNum: 42,
  type: "turn_start",
  direction: "outbound",
  timestamp: "2026-05-01T12:00:00Z",
  payload: { turnId: "turn-7" },
  turnId: "turn-7",
  turnPhase: "input"
}
```

The turn phases map to `turnPhase` values:

| Turn phase | `turnPhase` value |
|------------|-------------------|
| User message arriving | `input` |
| Model processing, tools running | `processing` |
| Blocked on permission | `awaiting_permission` (via separate permission_request events) |
| Final output streaming | `output` |
| Turn complete | `complete` |

---

## Relationship to GAPS.md Items

This spec addresses the following GAPS.md items:

| GAPS.md Section | Gap | Addressed By |
|-----------------|-----|--------------|
| 1.1 (Session Persistence) | Persisted event replay after restart | `afterSeq` semantics + append-only invariant |
| 1.1 | SSE reconnect with durable backlog | Replay from `events` table via `bus.getEventsSince()` |
| 1.1 | Event contract consistency | Canonical event envelope with typed payloads |
| 2.1.1 (Replay/Contract Parity) | `/web` SSE only replays in-memory | This spec requires SSE to always replay from `events` table, not just EventBus |
| 2.1.1 | Pending permission recovery | Section 5 — pending_permissions table + replay order |
| 13.3 (Canonical event contract) | One stable event model for live + replay | This spec — every event typed, sequenced, and stored |
| 13.2 (Canonical API contract) | `GET /api/sessions/:id/events/stream?afterSeq=N` | `afterSeq` semantics in Section 2 |

---

## Open Questions / Future Extensibility

1. **Multi-repo turns** — when a session has multiple repositories, does `turnId` scope across all repos or per-repo? Currently out of scope; single-repo assumed.
2. **Turn timeout** — if a turn is stuck in `processing` for >N minutes, should `turn_interrupted` be auto-emitted? Not specified here; worker lifecycle handles this via session status.
3. **Event retention policy** — this spec does not define when old events are purged. A production system would need a retention policy (e.g., keep last 10,000 events per session or last 30 days).
4. **Backward compat for `from_sequence_num`** — currently aliased to `afterSeq` in `resolveReplayCursor`. If a future version changes semantics, this alias must be documented separately.