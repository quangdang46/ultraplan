import { randomUUID } from "node:crypto";
import { getEventBus, removeEventBus } from "../transport/event-bus";
import { db } from "../db";
import {
  storeAddPendingPermission,
  storeClearPendingPermissions,
  storeClearSessionRequiresAction,
  storeRemovePendingPermission,
} from "../store";
import {
  buildCanonicalSessionEvent,
  type CanonicalSessionEvent,
  type NormalizedEventPayload,
  type SessionEventDirection,
  type SessionEventType,
} from "../types/messages";

function getNextSeqNum(sessionId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(seq_num), 0) AS max_seq
       FROM events
       WHERE session_id = ?`,
    )
    .get(sessionId) as Record<string, unknown> | undefined;

  return Number(row?.max_seq ?? 0) + 1;
}

export function getLastPersistedSeqNum(sessionId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(seq_num), 0) AS max_seq
       FROM events
       WHERE session_id = ?`,
    )
    .get(sessionId) as Record<string, unknown> | undefined;

  return Number(row?.max_seq ?? 0);
}

function toSeqNum(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.trunc(value);
}

function shouldHoistField(type: string, key: string, value: unknown): boolean {
  if (value === undefined || key === "content" || key === "raw") {
    return false;
  }

  if (key === "uuid" && typeof value === "string" && value.length === 0) {
    return false;
  }

  if ((key === "task_list_id" || key === "taskListId" || key === "tasks") && type !== "task_state") {
    return false;
  }

  return true;
}

/**
 * Extract plain text from various message payload formats.
 * Handles:
 *   { content: "text" }
 *   { message: { role: "user", content: "text" } }
 *   { message: { content: [{type:"text",text:"..."}] } }
 */
function extractContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return typeof payload === "string" ? payload : "";
  }

  const p = payload as Record<string, unknown>;

  // Direct content field
  if (typeof p.content === "string" && p.content) return p.content;

  // message.content (child process format)
  const msg = p.message;
  if (msg && typeof msg === "object") {
    const mc = (msg as Record<string, unknown>).content;
    if (typeof mc === "string") return mc;
    if (Array.isArray(mc)) {
      return mc
        .filter((b: unknown) => typeof b === "object" && b !== null && (b as Record<string, unknown>).type === "text")
        .map((b: Record<string, unknown>) => (b as Record<string, unknown>).text || "")
        .join("");
    }
  }

  return "";
}

/**
 * Normalize event payload into a flat structure that matches the ServerEvent
 * contract types while preserving the original in `raw` for backward compat.
 *
 * Key principle: backend-owned fields stay flattened at the top level while
 * adapter-only noise is left inside `raw` for compatibility reads.
 */
export function normalizePayload(type: string, payload: unknown): NormalizedEventPayload {
  if (!payload || typeof payload !== "object") {
    return { content: typeof payload === "string" ? payload : "", raw: payload };
  }

  const p = payload as Record<string, unknown>;
  const content = extractContent(payload);

  const normalized: NormalizedEventPayload = {
    content,
    raw: payload,
  };

  for (const [key, value] of Object.entries(p)) {
    if (shouldHoistField(type, key, value)) {
      normalized[key] = value;
    }
  }

  // Preserve tool aliases
  if (p.name && !normalized.tool_name) normalized.tool_name = p.name;
  if (p.input && !normalized.tool_input) normalized.tool_input = p.input;

  return normalized;
}

/** Publish an event to a session's bus and persist to SQLite */
export function publishSessionEvent(
  sessionId: string,
  type: SessionEventType,
  payload: unknown,
  direction: SessionEventDirection,
): CanonicalSessionEvent {
  const normalized = normalizePayload(type, payload);
  const requestedSeqNum =
    normalized && typeof normalized === "object"
      ? toSeqNum((normalized as Record<string, unknown>).seqNum)
      : null;
  const requestedSeqAlias =
    requestedSeqNum ??
    (normalized && typeof normalized === "object"
      ? toSeqNum((normalized as Record<string, unknown>).seq)
      : null);
  const nextSeqNum = requestedSeqAlias ?? getNextSeqNum(sessionId);
  const bus = getEventBus(sessionId, nextSeqNum - 1);
  const eventId = randomUUID();

  const event = bus.publish({
    id: eventId,
    sessionId,
    type,
    payload: normalized,
    direction,
    seqNum: nextSeqNum,
  });

  try {
    db.prepare(
      `INSERT OR IGNORE INTO events (id, session_id, type, payload, direction, seq_num, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.id,
      event.sessionId,
      event.type,
      JSON.stringify(event.payload),
      event.direction,
      event.seqNum,
      new Date(event.createdAt).toISOString(),
    );
  } catch {
    // Non-fatal: in-memory bus is the hot path
  }

  // Persist permission_request to pending_permissions table for replay on reconnect
  if (type === "permission_request" && direction === "outbound") {
    const requestId = (normalized as Record<string, unknown>).request_id as string;
    if (requestId) {
      try {
        storeAddPendingPermission(sessionId, requestId, { request_id: requestId, ...normalized });
      } catch {
        // Non-fatal: pending_permissions is for replay only
      }
    }
  }

  // Remove permission_response from pending_permissions table (cleanup)
  // Handles both inbound (from POST /chat/control) and outbound (from subprocess via control_response)
  if (type === "permission_response") {
    const requestId = (normalized as Record<string, unknown>).request_id as string;
    if (requestId) {
      try {
        storeRemovePendingPermission(sessionId, requestId);
      } catch {
        // Non-fatal: pending_permissions cleanup is best-effort
      }
    }
  }

  return event;
}

/** Load persisted events from SQLite for a session */
export function loadPersistedEvents(
  sessionId: string,
  sinceSeqNum = 0,
): CanonicalSessionEvent[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, type, payload, direction, seq_num, created_at
       FROM events
       WHERE session_id = ? AND seq_num > ?
       ORDER BY seq_num ASC`,
    )
    .all(sessionId, sinceSeqNum) as Array<Record<string, unknown>>;

  return rows.map((row) =>
    buildCanonicalSessionEvent({
      id: row.id as string,
      sessionId: row.session_id as string,
      type: row.type as SessionEventType,
      payload: JSON.parse(row.payload as string),
      direction: row.direction as SessionEventDirection,
      seqNum: row.seq_num as number,
      createdAt: new Date(row.created_at as string).getTime(),
    }),
  );
}

export function hydrateEventBusFromPersistence(sessionId: string, sinceSeqNum = 0): void {
  const persisted = loadPersistedEvents(sessionId, sinceSeqNum);
  if (persisted.length === 0) return;

  const bus = getEventBus(sessionId, getLastPersistedSeqNum(sessionId));
  for (const event of persisted) {
    bus.publish({
      id: event.id,
      sessionId: event.sessionId,
      type: event.type,
      payload: event.payload,
      direction: event.direction,
      seqNum: event.seqNum,
      createdAt: event.createdAt,
    });
  }
}

export function truncateSessionEvents(
  sessionId: string,
  lastSeqNumToKeep: number,
): void {
  const keepSeqNum = Math.max(0, Math.trunc(lastSeqNumToKeep));
  db.prepare(
    `DELETE FROM events
     WHERE session_id = ? AND seq_num > ?`,
  ).run(sessionId, keepSeqNum);
  storeClearPendingPermissions(sessionId);
  storeClearSessionRequiresAction(sessionId);
  removeEventBus(sessionId);
}

const FORK_EXCLUDED_EVENT_TYPES = new Set<SessionEventType>([
  "session_created",
  "session_ended",
  "session_status",
  "permission_request",
  "permission_response",
  "interrupt",
]);

function clonePayloadForFork<T>(payload: T): T {
  if (payload === undefined) {
    return payload;
  }
  const cloned = JSON.parse(JSON.stringify(payload)) as T;
  if (cloned && typeof cloned === "object") {
    delete (cloned as Record<string, unknown>).seq;
    delete (cloned as Record<string, unknown>).seqNum;
  }
  return cloned;
}

export function clonePersistedSessionEvents(
  sourceSessionId: string,
  targetSessionId: string,
): number {
  const events = loadPersistedEvents(sourceSessionId, 0);
  let copied = 0;

  for (const event of events) {
    if (FORK_EXCLUDED_EVENT_TYPES.has(event.type)) {
      continue;
    }

    publishSessionEvent(
      targetSessionId,
      event.type,
      clonePayloadForFork(event.payload),
      event.direction,
    );
    copied += 1;
  }

  return copied;
}
