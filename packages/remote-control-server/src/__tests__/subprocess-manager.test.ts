import { beforeEach, describe, expect, test } from "bun:test";

import { storeReset } from "../store";
import { createSession } from "../services/session";
import { updateSessionState } from "../services/session-state-repo";
import {
  buildSubprocessArgs,
  extractControlResponseEnvelope,
  resolveSubprocessLaunchOptions,
  toCliSessionId,
} from "../services/subprocess-manager";

describe("subprocess-manager session id mapping", () => {
  beforeEach(() => {
    storeReset();
  });

  test("converts web session ids into stable CLI UUIDs", () => {
    expect(
      toCliSessionId("session_0123456789abcdef0123456789abcdef"),
    ).toBe("01234567-89ab-cdef-0123-456789abcdef");
  });

  test("converts code session ids into stable CLI UUIDs", () => {
    expect(
      toCliSessionId("cse_0123456789abcdef0123456789abcdef"),
    ).toBe("01234567-89ab-cdef-0123-456789abcdef");
  });

  test("accepts existing UUIDs", () => {
    expect(
      toCliSessionId("01234567-89AB-CDEF-0123-456789ABCDEF"),
    ).toBe("01234567-89ab-cdef-0123-456789abcdef");
  });

  test("rejects unsupported ids", () => {
    expect(() => toCliSessionId("session_not_a_uuid")).toThrow(
      "Unsupported session ID format",
    );
  });

  test("resolves launch options from session runtime state first", () => {
    const session = createSession({ permission_mode: "default" });
    updateSessionState(session.id, {
      model: "claude-opus-4-6",
      permissionMode: "plan",
      thinkingEffort: "high",
    });

    expect(resolveSubprocessLaunchOptions(session.id)).toEqual({
      model: "claude-opus-4-6",
      permissionMode: "plan",
      thinkingEffort: "high",
    });
  });

  test("falls back to session permission mode when runtime state is absent", () => {
    const session = createSession({ permission_mode: "acceptEdits" });

    expect(resolveSubprocessLaunchOptions(session.id)).toEqual({
      permissionMode: "acceptEdits",
    });
  });

  test("builds CLI args with model and permission mode overrides", () => {
    const args = buildSubprocessArgs(
      "session_0123456789abcdef0123456789abcdef",
      false,
      {
        model: "claude-sonnet-4-6",
        permissionMode: "plan",
        thinkingEffort: "high",
      },
    );

    expect(args).toContain("--model");
    expect(args).toContain("claude-sonnet-4-6");
    expect(args).toContain("--effort");
    expect(args).toContain("high");
    expect(args).toContain("--permission-mode");
    expect(args).toContain("plan");
    expect(args).toContain("--permission-prompt-tool");
    expect(args).toContain("stdio");
  });

  test("builds resume CLI args with a rewind boundary", () => {
    const args = buildSubprocessArgs(
      "session_0123456789abcdef0123456789abcdef",
      true,
      {},
      "assistant-msg-123",
    );

    expect(args).toContain("--resume");
    expect(args).toContain("01234567-89ab-cdef-0123-456789abcdef");
    expect(args).toContain("--resume-session-at");
    expect(args).toContain("assistant-msg-123");
  });

  test("extracts nested success control responses emitted by the CLI", () => {
    expect(
      extractControlResponseEnvelope({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: "req-rewind-1",
          response: {
            canRewind: true,
            filesChanged: ["src/demo.ts"],
          },
        },
      }),
    ).toEqual({
      requestId: "req-rewind-1",
      subtype: "success",
      response: {
        canRewind: true,
        filesChanged: ["src/demo.ts"],
      },
    });
  });

  test("extracts nested error control responses emitted by the CLI", () => {
    expect(
      extractControlResponseEnvelope({
        type: "control_response",
        response: {
          subtype: "error",
          request_id: "req-rewind-2",
          error: "No file checkpoint found for this message.",
        },
      }),
    ).toEqual({
      requestId: "req-rewind-2",
      subtype: "error",
      error: "No file checkpoint found for this message.",
    });
  });
});
