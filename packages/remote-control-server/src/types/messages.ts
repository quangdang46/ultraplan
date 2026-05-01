/** SDK 消息类型 — 与 CC CLI bridge 模块兼容 */
export interface SDKMessage {
  type: string;
  content?: unknown;
  [key: string]: unknown;
}

export interface UserMessage extends SDKMessage {
  type: "user";
  content: string;
}

export interface AssistantMessage extends SDKMessage {
  type: "assistant";
  content: string;
}

export interface PermissionRequest extends SDKMessage {
  type: "permission_request";
  tool_name: string;
  tool_input: unknown;
}

export interface PermissionResponse extends SDKMessage {
  type: "permission_response";
  approved: boolean;
  request_id: string;
}

export interface ControlRequest extends SDKMessage {
  type: "control_request";
  action: string;
  [key: string]: unknown;
}

export type SessionEventDirection = "inbound" | "outbound";

export type SessionEventType =
  | "assistant"
  | "automation_state"
  | "content_block"
  | "content_delta"
  | "control_request"
  | "control_response"
  | "error"
  | "init"
  | "interrupt"
  | "message_end"
  | "partial_assistant"
  | "permission_request"
  | "permission_response"
  | "result"
  | "session_ended"
  | "session_started"
  | "status"
  | "system"
  | "task_state"
  | "thinking_delta"
  | "tool_input_delta"
  | "tool_output_delta"
  | "tool_result"
  | "tool_start"
  | "tool_use"
  | "unknown"
  | "user"
  | "user_message"
  | (string & {});

export const CANONICAL_SESSION_EVENT_TYPES = [
  "user.message",
  "assistant.message",
  "assistant.end",
  "thinking.delta",
  "content.delta",
  "tool.start",
  "tool.input.delta",
  "tool.output.delta",
  "tool.result",
  "permission.requested",
  "permission.resolved",
  "task.state",
  "session.state",
  "session.control",
  "error",
] as const;

export type CanonicalSessionEventType = (typeof CANONICAL_SESSION_EVENT_TYPES)[number];

export type SessionEventKind =
  | "assistant"
  | "content"
  | "error"
  | "permission"
  | "session"
  | "task"
  | "thinking"
  | "tool"
  | "user";

export interface SessionEvent {
  id: string;
  sessionId: string;
  type: SessionEventType;
  payload: unknown;
  direction: SessionEventDirection;
  seqNum: number;
  createdAt: number;
}

export interface CanonicalSessionEvent extends SessionEvent {
  seq: number;
  timestamp: string;
  turnId: string;
  messageId: string | null;
  canonicalType: CanonicalSessionEventType;
  kind: SessionEventKind;
}

export interface SessionEventInput {
  id: string;
  sessionId: string;
  type: SessionEventType;
  payload: unknown;
  direction: SessionEventDirection;
  seqNum?: number;
  createdAt?: number;
}

const RAW_EVENT_TO_CANONICAL: Record<string, CanonicalSessionEventType> = {
  assistant: "assistant.message",
  automation_state: "session.state",
  content_block: "content.delta",
  content_delta: "content.delta",
  control_request: "session.control",
  control_response: "permission.resolved",
  error: "error",
  init: "session.state",
  interrupt: "session.control",
  message_end: "assistant.end",
  partial_assistant: "assistant.message",
  permission_request: "permission.requested",
  permission_response: "permission.resolved",
  result: "assistant.end",
  session_ended: "session.state",
  session_started: "session.state",
  status: "session.state",
  system: "session.state",
  task_state: "task.state",
  thinking_delta: "thinking.delta",
  tool_input_delta: "tool.input.delta",
  tool_output_delta: "tool.output.delta",
  tool_result: "tool.result",
  tool_start: "tool.start",
  tool_use: "tool.start",
  unknown: "session.state",
  user: "user.message",
  user_message: "user.message",
};

const CANONICAL_EVENT_KIND: Record<CanonicalSessionEventType, SessionEventKind> = {
  "assistant.end": "assistant",
  "assistant.message": "assistant",
  "content.delta": "content",
  error: "error",
  "permission.requested": "permission",
  "permission.resolved": "permission",
  "session.control": "session",
  "session.state": "session",
  "task.state": "task",
  "thinking.delta": "thinking",
  "tool.input.delta": "tool",
  "tool.output.delta": "tool",
  "tool.result": "tool",
  "tool.start": "tool",
  "user.message": "user",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function pickString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = nonEmptyString(record[key]);
    if (value) return value;
  }
  return null;
}

function pickNestedString(
  record: Record<string, unknown> | null,
  parentKey: string,
  keys: string[],
): string | null {
  if (!record) return null;
  return pickString(asRecord(record[parentKey]), keys);
}

function coerceSeqNum(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.trunc(value);
}

function coerceCreatedAt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return Date.now();
  }
  return Math.trunc(value);
}

export function getCanonicalSessionEventType(type: SessionEventType): CanonicalSessionEventType {
  const direct = RAW_EVENT_TO_CANONICAL[type];
  if (direct) return direct;

  if (type.includes("error")) return "error";
  if (type.includes("permission")) return type.includes("response") ? "permission.resolved" : "permission.requested";
  if (type.includes("control")) return type.includes("response") ? "permission.resolved" : "session.control";
  if (type.includes("tool")) {
    if (type.includes("input")) return "tool.input.delta";
    if (type.includes("output")) return "tool.output.delta";
    if (type.includes("result")) return "tool.result";
    return "tool.start";
  }
  if (type.includes("thinking")) return "thinking.delta";
  if (type.includes("content")) return "content.delta";
  if (type.includes("assistant")) return "assistant.message";
  if (type.includes("user")) return "user.message";
  if (type.includes("task")) return "task.state";
  if (type.includes("interrupt")) return "session.control";
  return "session.state";
}

export function getSessionEventKind(canonicalType: CanonicalSessionEventType): SessionEventKind {
  return CANONICAL_EVENT_KIND[canonicalType];
}

export function extractSessionEventMessageId(
  type: SessionEventType,
  payload: unknown,
): string | null {
  const record = asRecord(payload);
  const directMessageId = pickString(record, ["messageId", "message_id"]);
  if (directMessageId) return directMessageId;

  const nestedMessageId = pickNestedString(record, "message", ["id", "messageId", "message_id"]);
  if (nestedMessageId) return nestedMessageId;

  const canonicalType = getCanonicalSessionEventType(type);
  if (
    canonicalType === "user.message" ||
    canonicalType === "assistant.message" ||
    canonicalType === "assistant.end"
  ) {
    return pickString(record, ["uuid", "id"]);
  }

  return null;
}

export function extractSessionEventTurnId(event: Pick<SessionEvent, "id" | "sessionId" | "type" | "payload">): string {
  const record = asRecord(event.payload);
  const directTurnId =
    pickString(record, ["turnId", "turn_id"]) ??
    pickNestedString(record, "message", ["turnId", "turn_id"]);
  if (directTurnId) return directTurnId;

  const messageId = extractSessionEventMessageId(event.type, event.payload);
  if (messageId) return messageId;

  const requestId = pickString(record, ["request_id", "requestId"]);
  if (requestId) return requestId;

  const canonicalType = getCanonicalSessionEventType(event.type);
  if (canonicalType === "tool.start" || canonicalType === "tool.input.delta" || canonicalType === "tool.output.delta" || canonicalType === "tool.result") {
    const toolId = pickString(record, ["toolCallId", "tool_call_id", "tool_use_id", "id"]);
    if (toolId) return toolId;
  }

  if (canonicalType === "task.state") {
    const taskListId = pickString(record, ["taskListId", "task_list_id"]);
    if (taskListId) return taskListId;
  }

  if (canonicalType === "session.state" || canonicalType === "session.control") {
    return `${event.sessionId}:${canonicalType}`;
  }

  return `${event.sessionId}:${event.id}`;
}

export function buildCanonicalSessionEvent(event: SessionEvent): CanonicalSessionEvent {
  const seqNum = coerceSeqNum(event.seqNum);
  const createdAt = coerceCreatedAt(event.createdAt);
  const canonicalType = getCanonicalSessionEventType(event.type);

  return {
    ...event,
    seqNum,
    createdAt,
    seq: seqNum,
    timestamp: new Date(createdAt).toISOString(),
    turnId: extractSessionEventTurnId(event),
    messageId: extractSessionEventMessageId(event.type, event.payload),
    canonicalType,
    kind: getSessionEventKind(canonicalType),
  };
}

// --- Normalized Event Payloads (SSE contract) ---

export interface NormalizedEventPayload {
  content: string;
  raw?: unknown;
  isSynthetic?: boolean;
  [key: string]: unknown;
}

export interface UserEventPayload extends NormalizedEventPayload {
  content: string;
}

export interface AssistantEventPayload extends NormalizedEventPayload {
  content: string;
}

export interface ToolUseEventPayload extends NormalizedEventPayload {
  content: string;
  tool_name: string;
  tool_input: unknown;
}

export interface ToolResultEventPayload extends NormalizedEventPayload {
  content: string;
}

export interface PermissionEventPayload extends NormalizedEventPayload {
  content: string;
  request_id: string;
  request: {
    subtype: string;
    tool_name: string;
    tool_input: unknown;
  };
}
