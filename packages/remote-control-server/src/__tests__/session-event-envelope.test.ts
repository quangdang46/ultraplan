import { describe, expect, test } from "bun:test";
import {
  buildCanonicalSessionEvent,
  type CanonicalSessionEventType,
  type SessionEventKind,
} from "../types/messages";

describe("buildCanonicalSessionEvent", () => {
  test("locks canonical envelope fields for persisted and streamed user events", () => {
    const createdAt = Date.UTC(2026, 4, 1, 12, 0, 0);
    const event = buildCanonicalSessionEvent({
      id: "evt-user-1",
      sessionId: "sess-1",
      type: "user",
      payload: { uuid: "msg-user-1", content: "hello" },
      direction: "inbound",
      seqNum: 7,
      createdAt,
    });

    expect(event.seq).toBe(7);
    expect(event.seqNum).toBe(7);
    expect(event.sessionId).toBe("sess-1");
    expect(event.turnId).toBe("msg-user-1");
    expect(event.messageId).toBe("msg-user-1");
    expect(event.timestamp).toBe("2026-05-01T12:00:00.000Z");
    expect(event.canonicalType).toBe("user.message");
    expect(event.kind).toBe("user");
  });

  test("covers assistant, thinking, content, permissions, session state, and errors", () => {
    const cases = [
      {
        type: "assistant" as const,
        payload: { uuid: "msg-assistant-1", content: "reply" },
        canonicalType: "assistant.message" as CanonicalSessionEventType,
        kind: "assistant" as SessionEventKind,
      },
      {
        type: "thinking_delta" as const,
        payload: { delta: { thinking: "reasoning" } },
        canonicalType: "thinking.delta" as CanonicalSessionEventType,
        kind: "thinking" as SessionEventKind,
      },
      {
        type: "content_delta" as const,
        payload: { delta: { text: "chunk" } },
        canonicalType: "content.delta" as CanonicalSessionEventType,
        kind: "content" as SessionEventKind,
      },
      {
        type: "permission_request" as const,
        payload: { request_id: "perm-1", request: { subtype: "tool_permission" } },
        canonicalType: "permission.requested" as CanonicalSessionEventType,
        kind: "permission" as SessionEventKind,
      },
      {
        type: "session_ended" as const,
        payload: { reason: "completed" },
        canonicalType: "session.state" as CanonicalSessionEventType,
        kind: "session" as SessionEventKind,
      },
      {
        type: "error" as const,
        payload: { code: "E_FAIL", message: "boom" },
        canonicalType: "error" as CanonicalSessionEventType,
        kind: "error" as SessionEventKind,
      },
    ];

    for (const [index, entry] of cases.entries()) {
      const event = buildCanonicalSessionEvent({
        id: `evt-${index + 1}`,
        sessionId: "sess-coverage",
        type: entry.type,
        payload: entry.payload,
        direction: "outbound",
        seqNum: index + 1,
        createdAt: Date.UTC(2026, 4, 1, 12, 0, index),
      });

      expect(event.canonicalType).toBe(entry.canonicalType);
      expect(event.kind).toBe(entry.kind);
    }
  });

  test("uses request and tool identifiers as turn fallbacks when a message id is not applicable", () => {
    const permissionEvent = buildCanonicalSessionEvent({
      id: "evt-perm",
      sessionId: "sess-2",
      type: "permission_request",
      payload: { request_id: "perm-2" },
      direction: "outbound",
      seqNum: 1,
      createdAt: Date.UTC(2026, 4, 1, 12, 1, 0),
    });
    const toolEvent = buildCanonicalSessionEvent({
      id: "evt-tool",
      sessionId: "sess-2",
      type: "tool_result",
      payload: { toolCallId: "tool-2", result: "ok" },
      direction: "outbound",
      seqNum: 2,
      createdAt: Date.UTC(2026, 4, 1, 12, 1, 1),
    });

    expect(permissionEvent.messageId).toBeNull();
    expect(permissionEvent.turnId).toBe("perm-2");
    expect(toolEvent.messageId).toBeNull();
    expect(toolEvent.turnId).toBe("tool-2");
  });
});
