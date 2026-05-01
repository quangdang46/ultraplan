import { describe, expect, test } from "bun:test";

import { toCliSessionId } from "../services/subprocess-manager";

describe("subprocess-manager session id mapping", () => {
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
});
