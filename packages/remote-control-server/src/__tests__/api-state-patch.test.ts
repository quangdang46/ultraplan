import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import apiRoutes from "../routes/api/index";
import {
  storeBindSession,
  storeCreateSession,
  storeReset,
  storeUpsertWorkspace,
} from "../store";
import { removeEventBus, getAllEventBuses } from "../transport/event-bus";
import { subprocessManager } from "../services/subprocess-manager";
import { upsertSessionRuntimeState } from "../services/session-runtime-context";

function createApp() {
  const app = new Hono();
  app.route("/api", apiRoutes);
  return app;
}

describe("PATCH /api/state — live runtime updates", () => {
  const ownerUuid = "user-state-patch-test";
  let root: string;

  beforeEach(async () => {
    storeReset();
    for (const [key] of getAllEventBuses()) {
      removeEventBus(key);
    }
    root = await mkdtemp(join(tmpdir(), "rcs-api-state-patch-"));
  });

  afterEach(async () => {
    for (const [key] of getAllEventBuses()) {
      removeEventBus(key);
    }
    await rm(root, { recursive: true, force: true });
  });

  test("forwards set_model to running worker via requestControl", async () => {
    const session = storeCreateSession({ title: "State Patch Test", source: "web", cwd: root });
    storeBindSession(session.id, ownerUuid);
    storeUpsertWorkspace(session.id, { sourceRoot: root, strategy: "copy", workspacePath: root });

    const originalRequestControl = subprocessManager.requestControl.bind(subprocessManager);
    const originalIsRunning = subprocessManager.isRunning.bind(subprocessManager);
    const requestControlMock = mock(async (_sid: string, req: Record<string, unknown>) => ({}));

    // Simulate a running worker by overriding isRunning + requestControl
    (subprocessManager as unknown as { isRunning: typeof subprocessManager.isRunning }).isRunning = () => true;
    (subprocessManager as unknown as { requestControl: typeof subprocessManager.requestControl }).requestControl = requestControlMock;

    try {
      const res = await createApp().request("/api/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-UUID": ownerUuid },
        body: JSON.stringify({ sessionId: session.id, model: "claude-opus-4-6" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.model).toBe("claude-opus-4-6");
      expect(requestControlMock).toHaveBeenCalledWith(session.id, {
        subtype: "set_model",
        model: "claude-opus-4-6",
      });
    } finally {
      (subprocessManager as unknown as { isRunning: typeof subprocessManager.isRunning }).isRunning = originalIsRunning;
      (subprocessManager as unknown as { requestControl: typeof subprocessManager.requestControl }).requestControl = originalRequestControl;
    }
  });

  test("forwards set_permission_mode to running worker via requestControl", async () => {
    const session = storeCreateSession({ title: "State Patch Perm Test", source: "web", cwd: root });
    storeBindSession(session.id, ownerUuid);
    storeUpsertWorkspace(session.id, { sourceRoot: root, strategy: "copy", workspacePath: root });

    const originalRequestControl = subprocessManager.requestControl.bind(subprocessManager);
    const originalIsRunning = subprocessManager.isRunning.bind(subprocessManager);
    const requestControlMock = mock(async (_sid: string, req: Record<string, unknown>) => ({}));

    (subprocessManager as unknown as { isRunning: typeof subprocessManager.isRunning }).isRunning = () => true;
    (subprocessManager as unknown as { requestControl: typeof subprocessManager.requestControl }).requestControl = requestControlMock;

    try {
      const res = await createApp().request("/api/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-UUID": ownerUuid },
        body: JSON.stringify({ sessionId: session.id, permissionMode: "bypassPermissions" }),
      });

      expect(res.status).toBe(200);
      expect(requestControlMock).toHaveBeenCalledWith(session.id, {
        subtype: "set_permission_mode",
        mode: "bypassPermissions",
      });
    } finally {
      (subprocessManager as unknown as { isRunning: typeof subprocessManager.isRunning }).isRunning = originalIsRunning;
      (subprocessManager as unknown as { requestControl: typeof subprocessManager.requestControl }).requestControl = originalRequestControl;
    }
  });

  test("forwards set_max_thinking_tokens to running worker for high effort", async () => {
    const session = storeCreateSession({ title: "State Patch Effort Test", source: "web", cwd: root });
    storeBindSession(session.id, ownerUuid);
    storeUpsertWorkspace(session.id, { sourceRoot: root, strategy: "copy", workspacePath: root });

    const originalRequestControl = subprocessManager.requestControl.bind(subprocessManager);
    const originalIsRunning = subprocessManager.isRunning.bind(subprocessManager);
    const requestControlMock = mock(async (_sid: string, req: Record<string, unknown>) => ({}));

    (subprocessManager as unknown as { isRunning: typeof subprocessManager.isRunning }).isRunning = () => true;
    (subprocessManager as unknown as { requestControl: typeof subprocessManager.requestControl }).requestControl = requestControlMock;

    try {
      const res = await createApp().request("/api/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-UUID": ownerUuid },
        body: JSON.stringify({ sessionId: session.id, thinkingEffort: "high" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.thinkingEffort).toBe("high");
      expect(requestControlMock).toHaveBeenCalledWith(session.id, {
        subtype: "set_max_thinking_tokens",
        max_thinking_tokens: 32_000,
      });
    } finally {
      (subprocessManager as unknown as { isRunning: typeof subprocessManager.isRunning }).isRunning = originalIsRunning;
      (subprocessManager as unknown as { requestControl: typeof subprocessManager.requestControl }).requestControl = originalRequestControl;
    }
  });

  test("maps effort level low → 0 (disable thinking), medium → 10000, max → 128000", async () => {
    const session = storeCreateSession({ title: "State Patch Effort Levels Test", source: "web", cwd: root });
    storeBindSession(session.id, ownerUuid);
    storeUpsertWorkspace(session.id, { sourceRoot: root, strategy: "copy", workspacePath: root });

    const originalRequestControl = subprocessManager.requestControl.bind(subprocessManager);
    const originalIsRunning = subprocessManager.isRunning.bind(subprocessManager);
    const requestControlMock = mock(async (_sid: string, req: Record<string, unknown>) => ({}));

    (subprocessManager as unknown as { isRunning: typeof subprocessManager.isRunning }).isRunning = () => true;
    (subprocessManager as unknown as { requestControl: typeof subprocessManager.requestControl }).requestControl = requestControlMock;

    try {
      // low effort → 0 (disabled)
      let res = await createApp().request("/api/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-UUID": ownerUuid },
        body: JSON.stringify({ sessionId: session.id, thinkingEffort: "low" }),
      });
      expect(res.status).toBe(200);
      expect(requestControlMock).toHaveBeenLastCalledWith(session.id, {
        subtype: "set_max_thinking_tokens",
        max_thinking_tokens: 0,
      });

      // medium effort → 10000
      res = await createApp().request("/api/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-UUID": ownerUuid },
        body: JSON.stringify({ sessionId: session.id, thinkingEffort: "medium" }),
      });
      expect(res.status).toBe(200);
      expect(requestControlMock).toHaveBeenLastCalledWith(session.id, {
        subtype: "set_max_thinking_tokens",
        max_thinking_tokens: 10_000,
      });

      // max effort → 128000
      res = await createApp().request("/api/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-UUID": ownerUuid },
        body: JSON.stringify({ sessionId: session.id, thinkingEffort: "max" }),
      });
      expect(res.status).toBe(200);
      expect(requestControlMock).toHaveBeenLastCalledWith(session.id, {
        subtype: "set_max_thinking_tokens",
        max_thinking_tokens: 128_000,
      });
    } finally {
      (subprocessManager as unknown as { isRunning: typeof subprocessManager.isRunning }).isRunning = originalIsRunning;
      (subprocessManager as unknown as { requestControl: typeof subprocessManager.requestControl }).requestControl = originalRequestControl;
    }
  });

  test("sends all three control requests (model + permissionMode + effort) in one call", async () => {
    const session = storeCreateSession({ title: "State Patch Combined Test", source: "web", cwd: root });
    storeBindSession(session.id, ownerUuid);
    storeUpsertWorkspace(session.id, { sourceRoot: root, strategy: "copy", workspacePath: root });

    const originalRequestControl = subprocessManager.requestControl.bind(subprocessManager);
    const originalIsRunning = subprocessManager.isRunning.bind(subprocessManager);
    const requestControlMock = mock(async (_sid: string, req: Record<string, unknown>) => ({}));

    (subprocessManager as unknown as { isRunning: typeof subprocessManager.isRunning }).isRunning = () => true;
    (subprocessManager as unknown as { requestControl: typeof subprocessManager.requestControl }).requestControl = requestControlMock;

    try {
      const res = await createApp().request("/api/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-UUID": ownerUuid },
        body: JSON.stringify({
          sessionId: session.id,
          model: "claude-haiku-4-5-20251001",
          permissionMode: "acceptEdits",
          thinkingEffort: "high",
        }),
      });

      expect(res.status).toBe(200);
      expect(requestControlMock).toHaveBeenCalledTimes(3);
      expect(requestControlMock).toHaveBeenCalledWith(session.id, {
        subtype: "set_model",
        model: "claude-haiku-4-5-20251001",
      });
      expect(requestControlMock).toHaveBeenCalledWith(session.id, {
        subtype: "set_permission_mode",
        mode: "acceptEdits",
      });
      expect(requestControlMock).toHaveBeenCalledWith(session.id, {
        subtype: "set_max_thinking_tokens",
        max_thinking_tokens: 32_000,
      });
    } finally {
      (subprocessManager as unknown as { isRunning: typeof subprocessManager.isRunning }).isRunning = originalIsRunning;
      (subprocessManager as unknown as { requestControl: typeof subprocessManager.requestControl }).requestControl = originalRequestControl;
    }
  });

  test("does not call requestControl when no worker is running (only persists)", async () => {
    const session = storeCreateSession({ title: "State Patch No Worker Test", source: "web", cwd: root });
    storeBindSession(session.id, ownerUuid);
    storeUpsertWorkspace(session.id, { sourceRoot: root, strategy: "copy", workspacePath: root });

    // Persist a thinkingEffort so the patch still does something
    upsertSessionRuntimeState(session.id, { thinkingEffort: "low" });

    const originalRequestControl = subprocessManager.requestControl.bind(subprocessManager);
    const originalIsRunning = subprocessManager.isRunning.bind(subprocessManager);
    const requestControlMock = mock(async (_sid: string, req: Record<string, unknown>) => ({}));

    // Worker is NOT running
    (subprocessManager as unknown as { isRunning: typeof subprocessManager.isRunning }).isRunning = () => false;
    (subprocessManager as unknown as { requestControl: typeof subprocessManager.requestControl }).requestControl = requestControlMock;

    try {
      const res = await createApp().request("/api/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-UUID": ownerUuid },
        body: JSON.stringify({ sessionId: session.id, thinkingEffort: "high" }),
      });

      expect(res.status).toBe(200);
      expect(requestControlMock).not.toHaveBeenCalled();
      // State should still be persisted for the next worker spawn
      const body = await res.json();
      expect(body.thinkingEffort).toBe("high");
    } finally {
      (subprocessManager as unknown as { isRunning: typeof subprocessManager.isRunning }).isRunning = originalIsRunning;
      (subprocessManager as unknown as { requestControl: typeof subprocessManager.requestControl }).requestControl = originalRequestControl;
    }
  });
});
