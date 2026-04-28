import { describe, expect, test } from "vitest";

import {
  shouldAdoptPendingSessionRoute,
  shouldHydrateRouteSession,
  shouldPreserveLiveSession,
} from "./sessionRuntime";

describe("shouldPreserveLiveSession", () => {
  test("preserves live state for the same session while streaming", () => {
    expect(shouldPreserveLiveSession("session-1", "session-1", true)).toBe(true);
  });

  test("does not preserve once streaming has stopped", () => {
    expect(shouldPreserveLiveSession("session-1", "session-1", false)).toBe(false);
  });

  test("does not preserve when the route session differs", () => {
    expect(shouldPreserveLiveSession("session-2", "session-1", true)).toBe(false);
  });

  test("does not preserve when there is no route session yet", () => {
    expect(shouldPreserveLiveSession(null, "session-1", true)).toBe(false);
  });
});

describe("shouldAdoptPendingSessionRoute", () => {
  test("adopts a new live session when route sync is pending", () => {
    expect(shouldAdoptPendingSessionRoute(null, "session-1", true)).toBe(true);
  });

  test("does not adopt when route sync is not pending", () => {
    expect(shouldAdoptPendingSessionRoute(null, "session-1", false)).toBe(false);
  });

  test("does not adopt when the route already matches the live session", () => {
    expect(shouldAdoptPendingSessionRoute("session-1", "session-1", true)).toBe(false);
  });
});

describe("shouldHydrateRouteSession", () => {
  test("hydrates when opening a different session than the live one", () => {
    expect(shouldHydrateRouteSession("session-2", "session-1", true)).toBe(true);
  });

  test("hydrates when the same session has no live messages yet", () => {
    expect(shouldHydrateRouteSession("session-1", "session-1", false)).toBe(true);
  });

  test("does not hydrate over an already populated live session", () => {
    expect(shouldHydrateRouteSession("session-1", "session-1", true)).toBe(false);
  });

  test("does not hydrate without a route session", () => {
    expect(shouldHydrateRouteSession(null, "session-1", true)).toBe(false);
  });
});
