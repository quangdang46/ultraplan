import { beforeEach, describe, expect, test } from "bun:test";

import { storeReset } from "../store";
import { createSession } from "../services/session";
import { updateSessionState } from "../services/session-state-repo";
import {
  buildSubprocessArgs,
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
    });

    expect(resolveSubprocessLaunchOptions(session.id)).toEqual({
      model: "claude-opus-4-6",
      permissionMode: "plan",
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
      },
    );

    expect(args).toContain("--model");
    expect(args).toContain("claude-sonnet-4-6");
    expect(args).toContain("--permission-mode");
    expect(args).toContain("plan");
  });
});
