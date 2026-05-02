import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import apiRoutes from "../routes/api/index";
import {
  storeAddPendingPermission,
  storeBindSession,
  storeCreateSession,
  storeListPendingPermissions,
  storeListSessionsByOwnerUuid,
  storeReset,
  storeUpsertWorkspace,
} from "../store";
import { removeEventBus, getAllEventBuses } from "../transport/event-bus";
import { loadPersistedEvents, publishSessionEvent } from "../services/transport";
import { subprocessManager } from "../services/subprocess-manager";

function createApp() {
  const app = new Hono();
  app.route("/api", apiRoutes);
  return app;
}

describe("api chat stream", () => {
  beforeEach(() => {
    storeReset();
    for (const [key] of getAllEventBuses()) {
      removeEventBus(key);
    }
  });

  afterEach(() => {
    for (const [key] of getAllEventBuses()) {
      removeEventBus(key);
    }
  });

  test("POST /api/chat/stream keeps streaming until content and message_end arrive", async () => {
    const ownerUuid = "user-stream-test";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-chat-stream-"));
    const session = storeCreateSession({
      title: "Stream Test",
      source: "web",
      cwd: root,
    });
    storeBindSession(session.id, ownerUuid);
    storeUpsertWorkspace(session.id, {
      sourceRoot: root,
      strategy: "copy",
      workspacePath: root,
    });

    const originalGetOrSpawn = subprocessManager.getOrSpawn.bind(subprocessManager);
    const originalEnqueueMessage = subprocessManager.enqueueMessage.bind(subprocessManager);

    const getOrSpawnMock = mock(async () => ({}) as any);
    const enqueueMessageMock = mock((sessionId: string) => {
      setTimeout(() => {
        publishSessionEvent(
          sessionId,
          "content_delta",
          { delta: { type: "text_delta", text: "STREAM_OK" } },
          "outbound",
        );
        publishSessionEvent(
          sessionId,
          "message_end",
          { id: "msg_stream_ok" },
          "outbound",
        );
      }, 25);
    });

    (subprocessManager as unknown as {
      getOrSpawn: typeof subprocessManager.getOrSpawn;
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).getOrSpawn = getOrSpawnMock;
    (subprocessManager as unknown as {
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).enqueueMessage = enqueueMessageMock;

    const server = Bun.serve({
      port: 0,
      fetch: createApp().fetch,
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-UUID": ownerUuid,
        },
        body: JSON.stringify({
          sessionId: session.id,
          message: "stream please",
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const bodyText = await Promise.race<string>([
        response.text(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timed out waiting for streamed response")), 2000),
        ),
      ]);

      expect(getOrSpawnMock).toHaveBeenCalled();
      expect(enqueueMessageMock).toHaveBeenCalledWith(
        session.id,
        expect.stringContaining("\"stream please\""),
      );
      expect(bodyText).toContain("\"type\":\"content_delta\"");
      expect(bodyText).toContain("STREAM_OK");
      expect(bodyText).toContain("\"type\":\"message_end\"");
    } finally {
      (subprocessManager as unknown as {
        getOrSpawn: typeof subprocessManager.getOrSpawn;
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).getOrSpawn = originalGetOrSpawn;
      (subprocessManager as unknown as {
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).enqueueMessage = originalEnqueueMessage;
      await server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  });

  test("POST /api/chat/stream forwards stable user message ids to persistence and the subprocess", async () => {
    const ownerUuid = "user-stream-message-id";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-chat-stream-id-"));
    const session = storeCreateSession({
      title: "Stream Message Id Test",
      source: "web",
      cwd: root,
    });
    storeBindSession(session.id, ownerUuid);
    storeUpsertWorkspace(session.id, {
      sourceRoot: root,
      strategy: "copy",
      workspacePath: root,
    });

    const originalGetOrSpawn = subprocessManager.getOrSpawn.bind(subprocessManager);
    const originalEnqueueMessage = subprocessManager.enqueueMessage.bind(subprocessManager);
    const getOrSpawnMock = mock(async () => ({}) as any);
    const enqueueMessageMock = mock((sessionId: string) => {
      setTimeout(() => {
        publishSessionEvent(
          sessionId,
          "message_end",
          { id: "msg_stream_id" },
          "outbound",
        );
      }, 5);
    });

    (subprocessManager as unknown as {
      getOrSpawn: typeof subprocessManager.getOrSpawn;
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).getOrSpawn = getOrSpawnMock;
    (subprocessManager as unknown as {
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).enqueueMessage = enqueueMessageMock;

    const server = Bun.serve({
      port: 0,
      fetch: createApp().fetch,
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-UUID": ownerUuid,
        },
        body: JSON.stringify({
          sessionId: session.id,
          message: "keep this id",
          userMessageId: "11111111-1111-1111-1111-111111111111",
        }),
      });

      expect(response.status).toBe(200);
      await response.text();

      expect(enqueueMessageMock).toHaveBeenCalledWith(
        session.id,
        JSON.stringify({
          type: "user",
          uuid: "11111111-1111-1111-1111-111111111111",
          message: {
            role: "user",
            content: "keep this id",
          },
        }),
      );

      const persistedUserEvent = loadPersistedEvents(session.id, 0).find(
        (event) => event.type === "user" && event.direction === "inbound",
      );
      expect((persistedUserEvent?.payload as Record<string, unknown>)?.uuid).toBe(
        "11111111-1111-1111-1111-111111111111",
      );
    } finally {
      (subprocessManager as unknown as {
        getOrSpawn: typeof subprocessManager.getOrSpawn;
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).getOrSpawn = originalGetOrSpawn;
      (subprocessManager as unknown as {
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).enqueueMessage = originalEnqueueMessage;
      await server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("api chat control", () => {
  beforeEach(() => {
    storeReset();
    for (const [key] of getAllEventBuses()) {
      removeEventBus(key);
    }
  });

  afterEach(() => {
    for (const [key] of getAllEventBuses()) {
      removeEventBus(key);
    }
  });

  test("POST /api/chat/control forwards SDK-compatible allow payloads to the subprocess", async () => {
    const ownerUuid = "user-control-test";
    const session = storeCreateSession({
      title: "Control Test",
      source: "web",
    });
    storeBindSession(session.id, ownerUuid);
    storeAddPendingPermission(session.id, "req-edit-1", {
      request_id: "req-edit-1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Edit",
        input: {
          file_path: "/tmp/demo.txt",
          old_string: "before",
          new_string: "after",
        },
      },
    });

    const originalSendControl = subprocessManager.sendControl.bind(subprocessManager);
    const sendControlMock = mock((_sessionId: string, _controlPayload: string) => {});
    (subprocessManager as unknown as {
      sendControl: typeof subprocessManager.sendControl;
    }).sendControl = sendControlMock;

    try {
      const response = await createApp().request("/api/chat/control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UUID": ownerUuid,
        },
        body: JSON.stringify({
          sessionId: session.id,
          request_id: "req-edit-1",
          approved: true,
          updatedInput: {
            old_string: "before",
            new_string: "after (edited)",
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });
      expect(sendControlMock).toHaveBeenCalledTimes(1);
      expect(sendControlMock).toHaveBeenCalledWith(
        session.id,
        JSON.stringify({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: "req-edit-1",
            response: {
              behavior: "allow",
              updatedInput: {
                old_string: "before",
                new_string: "after (edited)",
              },
            },
          },
        }),
      );
      expect(storeListPendingPermissions(session.id)).toHaveLength(0);
    } finally {
      (subprocessManager as unknown as {
        sendControl: typeof subprocessManager.sendControl;
      }).sendControl = originalSendControl;
    }
  });

  test("POST /api/chat/control sends empty updatedInput when approval keeps the original tool input", async () => {
    const ownerUuid = "user-control-empty-input";
    const session = storeCreateSession({
      title: "Control Empty Input Test",
      source: "web",
    });
    storeBindSession(session.id, ownerUuid);

    const originalSendControl = subprocessManager.sendControl.bind(subprocessManager);
    const sendControlMock = mock((_sessionId: string, _controlPayload: string) => {});
    (subprocessManager as unknown as {
      sendControl: typeof subprocessManager.sendControl;
    }).sendControl = sendControlMock;

    try {
      const response = await createApp().request("/api/chat/control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UUID": ownerUuid,
        },
        body: JSON.stringify({
          sessionId: session.id,
          request_id: "req-edit-empty",
          approved: true,
        }),
      });

      expect(response.status).toBe(200);
      expect(sendControlMock).toHaveBeenCalledWith(
        session.id,
        JSON.stringify({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: "req-edit-empty",
            response: {
              behavior: "allow",
              updatedInput: {},
            },
          },
        }),
      );
    } finally {
      (subprocessManager as unknown as {
        sendControl: typeof subprocessManager.sendControl;
      }).sendControl = originalSendControl;
    }
  });
});

describe("api command execute", () => {
  beforeEach(() => {
    storeReset();
    for (const [key] of getAllEventBuses()) {
      removeEventBus(key);
    }
  });

  afterEach(() => {
    for (const [key] of getAllEventBuses()) {
      removeEventBus(key);
    }
  });

  test("POST /api/command/execute enqueues slash commands into the active session runtime", async () => {
    const ownerUuid = "user-command-test";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-"));
    const session = storeCreateSession({
      title: "Command Test",
      source: "web",
      cwd: root,
    });
    storeBindSession(session.id, ownerUuid);
    storeUpsertWorkspace(session.id, {
      sourceRoot: root,
      strategy: "copy",
      workspacePath: root,
    });

    const originalGetOrSpawn = subprocessManager.getOrSpawn.bind(subprocessManager);
    const originalEnqueueMessage = subprocessManager.enqueueMessage.bind(subprocessManager);
    const getOrSpawnMock = mock(async () => ({}) as any);
    const enqueueMessageMock = mock((_sessionId: string, _payload: string) => {});

    (subprocessManager as unknown as {
      getOrSpawn: typeof subprocessManager.getOrSpawn;
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).getOrSpawn = getOrSpawnMock;
    (subprocessManager as unknown as {
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).enqueueMessage = enqueueMessageMock;

    try {
      const response = await createApp().request("/api/command/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UUID": ownerUuid,
        },
        body: JSON.stringify({
          command: "/compact",
          sessionId: session.id,
          userMessageId: "22222222-2222-2222-2222-222222222222",
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        delegated: true,
        executionMode: "web-native",
        webNative: true,
        sessionId: session.id,
      });
      expect(getOrSpawnMock).toHaveBeenCalledWith(session.id, root);
      expect(enqueueMessageMock).toHaveBeenCalledWith(
        session.id,
        JSON.stringify({
          type: "user",
          uuid: "22222222-2222-2222-2222-222222222222",
          message: {
            role: "user",
            content: "/compact",
          },
        }),
      );
    } finally {
      (subprocessManager as unknown as {
        getOrSpawn: typeof subprocessManager.getOrSpawn;
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).getOrSpawn = originalGetOrSpawn;
      (subprocessManager as unknown as {
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).enqueueMessage = originalEnqueueMessage;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("POST /api/sessions/:id/rewind restarts the session as blank when rewinding the first turn", async () => {
    const ownerUuid = "user-rewind-test";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-rewind-"));
    const session = storeCreateSession({
      title: "Rewind Test",
      source: "web",
      cwd: root,
    });
    storeBindSession(session.id, ownerUuid);
    storeUpsertWorkspace(session.id, {
      sourceRoot: root,
      strategy: "copy",
      workspacePath: root,
    });
    publishSessionEvent(
      session.id,
      "user",
      {
        content: "edit files",
        uuid: "33333333-3333-3333-3333-333333333333",
      },
      "inbound",
    );

    const originalGetOrSpawn = subprocessManager.getOrSpawn.bind(subprocessManager);
    const originalRequestControl = subprocessManager.requestControl.bind(subprocessManager);
    const originalStop = subprocessManager.stop.bind(subprocessManager);
    const getOrSpawnMock = mock(async () => ({}) as any);
    const stopMock = mock(async () => {});
    const requestControlMock = mock(
      async (_sessionId: string, request: Record<string, unknown>) => {
        if (request.dry_run === true) {
          return {
            canRewind: true,
            filesChanged: ["src/demo.ts"],
            insertions: 4,
            deletions: 1,
          };
        }
        return { canRewind: true };
      },
    );

    (subprocessManager as unknown as {
      getOrSpawn: typeof subprocessManager.getOrSpawn;
      requestControl: typeof subprocessManager.requestControl;
      stop: typeof subprocessManager.stop;
    }).getOrSpawn = getOrSpawnMock;
    (subprocessManager as unknown as {
      requestControl: typeof subprocessManager.requestControl;
    }).requestControl = requestControlMock;
    (subprocessManager as unknown as {
      stop: typeof subprocessManager.stop;
    }).stop = stopMock;

    try {
      const response = await createApp().request(`/api/sessions/${session.id}/rewind`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UUID": ownerUuid,
        },
        body: "{}",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        userMessageId: "33333333-3333-3333-3333-333333333333",
        filesChanged: ["src/demo.ts"],
        insertions: 4,
        deletions: 1,
      });
      expect(getOrSpawnMock).toHaveBeenCalledWith(session.id, root, true);
      expect(requestControlMock).toHaveBeenNthCalledWith(1, session.id, {
        subtype: "rewind_files",
        user_message_id: "33333333-3333-3333-3333-333333333333",
        dry_run: true,
      });
      expect(requestControlMock).toHaveBeenNthCalledWith(2, session.id, {
        subtype: "rewind_files",
        user_message_id: "33333333-3333-3333-3333-333333333333",
      });
      expect(stopMock).toHaveBeenCalledWith(session.id, {
        suppressExitEvents: true,
      });
      expect(getOrSpawnMock).toHaveBeenNthCalledWith(2, session.id, root, false, undefined);
      expect(loadPersistedEvents(session.id, 0)).toEqual([]);
    } finally {
      (subprocessManager as unknown as {
        getOrSpawn: typeof subprocessManager.getOrSpawn;
        requestControl: typeof subprocessManager.requestControl;
        stop: typeof subprocessManager.stop;
      }).getOrSpawn = originalGetOrSpawn;
      (subprocessManager as unknown as {
        requestControl: typeof subprocessManager.requestControl;
      }).requestControl = originalRequestControl;
      (subprocessManager as unknown as {
        stop: typeof subprocessManager.stop;
      }).stop = originalStop;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("POST /api/command/execute rewinds files and restarts the session at the prior assistant boundary", async () => {
    const ownerUuid = "user-command-rewind";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-rewind-"));
    const session = storeCreateSession({
      title: "Command Rewind Test",
      source: "web",
      cwd: root,
    });
    storeBindSession(session.id, ownerUuid);
    storeUpsertWorkspace(session.id, {
      sourceRoot: root,
      strategy: "copy",
      workspacePath: root,
    });
    publishSessionEvent(
      session.id,
      "user",
      {
        content: "before rewind",
        uuid: "44444444-4444-4444-4444-444444444440",
      },
      "inbound",
    );
    publishSessionEvent(
      session.id,
      "message_end",
      {
        id: "assistant-prev-4444",
      },
      "outbound",
    );
    publishSessionEvent(
      session.id,
      "user",
      {
        content: "edit files",
        uuid: "44444444-4444-4444-4444-444444444444",
      },
      "inbound",
    );

    const originalGetOrSpawn = subprocessManager.getOrSpawn.bind(subprocessManager);
    const originalRequestControl = subprocessManager.requestControl.bind(subprocessManager);
    const originalStop = subprocessManager.stop.bind(subprocessManager);
    const getOrSpawnMock = mock(async () => ({}) as any);
    const stopMock = mock(async () => {});
    const requestControlMock = mock(
      async (_sessionId: string, request: Record<string, unknown>) => {
        if (request.dry_run === true) {
          return {
            canRewind: true,
            filesChanged: ["src/demo.ts"],
            insertions: 2,
            deletions: 5,
          };
        }
        return { canRewind: true };
      },
    );

    (subprocessManager as unknown as {
      getOrSpawn: typeof subprocessManager.getOrSpawn;
      requestControl: typeof subprocessManager.requestControl;
      stop: typeof subprocessManager.stop;
    }).getOrSpawn = getOrSpawnMock;
    (subprocessManager as unknown as {
      requestControl: typeof subprocessManager.requestControl;
    }).requestControl = requestControlMock;
    (subprocessManager as unknown as {
      stop: typeof subprocessManager.stop;
    }).stop = stopMock;

    try {
      const response = await createApp().request("/api/command/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UUID": ownerUuid,
        },
        body: JSON.stringify({
          command: "/rewind",
          sessionId: session.id,
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        delegated: false,
        executionMode: "prompt",
        webNative: true,
        sessionId: session.id,
        refreshHistory: true,
        userMessageId: "44444444-4444-4444-4444-444444444444",
        filesChanged: ["src/demo.ts"],
        insertions: 2,
        deletions: 5,
      });
      expect(getOrSpawnMock).toHaveBeenCalledWith(session.id, root, true);
      expect(requestControlMock).toHaveBeenNthCalledWith(1, session.id, {
        subtype: "rewind_files",
        user_message_id: "44444444-4444-4444-4444-444444444444",
        dry_run: true,
      });
      expect(requestControlMock).toHaveBeenNthCalledWith(2, session.id, {
        subtype: "rewind_files",
        user_message_id: "44444444-4444-4444-4444-444444444444",
      });
      expect(stopMock).toHaveBeenCalledWith(session.id, {
        suppressExitEvents: true,
      });
      expect(getOrSpawnMock).toHaveBeenNthCalledWith(
        2,
        session.id,
        root,
        true,
        "assistant-prev-4444",
      );
      expect(
        loadPersistedEvents(session.id, 0).map((event) => ({
          type: event.type,
          seqNum: event.seqNum,
          payload: event.payload,
        })),
      ).toEqual([
        {
          type: "user",
          seqNum: 1,
          payload: expect.objectContaining({
            content: "before rewind",
            uuid: "44444444-4444-4444-4444-444444444440",
          }),
        },
        {
          type: "message_end",
          seqNum: 2,
          payload: expect.objectContaining({
            id: "assistant-prev-4444",
          }),
        },
      ]);
    } finally {
      (subprocessManager as unknown as {
        getOrSpawn: typeof subprocessManager.getOrSpawn;
        requestControl: typeof subprocessManager.requestControl;
        stop: typeof subprocessManager.stop;
      }).getOrSpawn = originalGetOrSpawn;
      (subprocessManager as unknown as {
        requestControl: typeof subprocessManager.requestControl;
      }).requestControl = originalRequestControl;
      (subprocessManager as unknown as {
        stop: typeof subprocessManager.stop;
      }).stop = originalStop;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("POST /api/command/execute rejects /rewind without an active session", async () => {
    const ownerUuid = "user-command-rewind-no-session";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-rewind-no-session-"));

    try {
      const response = await createApp().request(
        `/api/command/execute?cwd=${encodeURIComponent(root)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-UUID": ownerUuid,
          },
          body: JSON.stringify({
            command: "/rewind",
          }),
        },
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "/rewind requires an active session",
      });
      expect(storeListSessionsByOwnerUuid(ownerUuid)).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("POST /api/command/execute serves /cost from backend-native command logic", async () => {
    const ownerUuid = "user-command-cost";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-cost-"));
    const session = storeCreateSession({
      title: "Command Cost Test",
      source: "web",
      cwd: root,
    });
    storeBindSession(session.id, ownerUuid);
    storeUpsertWorkspace(session.id, {
      sourceRoot: root,
      strategy: "copy",
      workspacePath: root,
    });

    publishSessionEvent(
      session.id,
      "message_end",
      {
        id: "msg_prior",
        usage: {
          inputTokens: 128,
          outputTokens: 64,
        },
      },
      "outbound",
    );

    const originalGetOrSpawn = subprocessManager.getOrSpawn.bind(subprocessManager);
    const originalEnqueueMessage = subprocessManager.enqueueMessage.bind(subprocessManager);
    const getOrSpawnMock = mock(async () => ({}) as any);
    const enqueueMessageMock = mock((_sessionId: string, _payload: string) => {});

    (subprocessManager as unknown as {
      getOrSpawn: typeof subprocessManager.getOrSpawn;
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).getOrSpawn = getOrSpawnMock;
    (subprocessManager as unknown as {
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).enqueueMessage = enqueueMessageMock;

    try {
      const response = await createApp().request("/api/command/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UUID": ownerUuid,
        },
        body: JSON.stringify({
          command: "/cost",
          sessionId: session.id,
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        delegated: true,
        executionMode: "web-native",
        webNative: true,
        sessionId: session.id,
      });
      expect(getOrSpawnMock).not.toHaveBeenCalled();
      expect(enqueueMessageMock).not.toHaveBeenCalled();

      const historyResponse = await createApp().request(`/api/sessions/${session.id}/messages`, {
        headers: {
          "X-UUID": ownerUuid,
        },
      });

      expect(historyResponse.status).toBe(200);
      expect(await historyResponse.json()).toEqual({
        messages: [
          {
            role: "user",
            content: "/cost",
            timestamp: expect.any(String),
          },
          {
            role: "assistant",
            content: expect.stringContaining("Total cost:"),
            timestamp: expect.any(String),
            blocks: [
              {
                type: "text",
                text: expect.stringContaining("Usage:                 128 input, 64 output"),
              },
            ],
          },
        ],
        lastSeqNum: expect.any(Number),
      });
    } finally {
      (subprocessManager as unknown as {
        getOrSpawn: typeof subprocessManager.getOrSpawn;
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).getOrSpawn = originalGetOrSpawn;
      (subprocessManager as unknown as {
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).enqueueMessage = originalEnqueueMessage;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("POST /api/command/execute serves /clear from backend-native command logic and clears rehydrated history", async () => {
    const ownerUuid = "user-command-clear";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-clear-"));
    const session = storeCreateSession({
      title: "Clear Command Test",
      source: "web",
      cwd: root,
    });
    storeBindSession(session.id, ownerUuid);
    storeUpsertWorkspace(session.id, {
      sourceRoot: root,
      strategy: "copy",
      workspacePath: root,
    });

    publishSessionEvent(session.id, "user", { content: "before clear" }, "inbound");
    publishSessionEvent(
      session.id,
      "content_delta",
      { delta: { type: "text_delta", text: "old reply" } },
      "outbound",
    );
    publishSessionEvent(session.id, "message_end", { id: "msg_before_clear" }, "outbound");

    const originalGetOrSpawn = subprocessManager.getOrSpawn.bind(subprocessManager);
    const originalEnqueueMessage = subprocessManager.enqueueMessage.bind(subprocessManager);

    (subprocessManager as unknown as {
      getOrSpawn: typeof subprocessManager.getOrSpawn;
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).getOrSpawn = (() => {
      throw new Error("subprocess should not be started for /clear");
    }) as typeof subprocessManager.getOrSpawn;
    (subprocessManager as unknown as {
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).enqueueMessage = (() => {
      throw new Error("subprocess enqueue should not run for /clear");
    }) as typeof subprocessManager.enqueueMessage;

    try {
      const response = await createApp().request("/api/command/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UUID": ownerUuid,
        },
        body: JSON.stringify({
          sessionId: session.id,
          command: "/clear",
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        success: true,
        delegated: false,
        executionMode: "web-native",
        webNative: true,
        sessionId: session.id,
        clearConversation: true,
      });

      const historyResponse = await createApp().request(`/api/sessions/${session.id}/messages`, {
        headers: {
          "X-UUID": ownerUuid,
        },
      });

      expect(historyResponse.status).toBe(200);
      expect(await historyResponse.json()).toEqual({
        messages: [],
        lastSeqNum: 5,
      });
    } finally {
      (subprocessManager as unknown as {
        getOrSpawn: typeof subprocessManager.getOrSpawn;
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).getOrSpawn = originalGetOrSpawn;
      (subprocessManager as unknown as {
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).enqueueMessage = originalEnqueueMessage;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("POST /api/command/execute creates a session for no-session /cost execution", async () => {
    const ownerUuid = "user-command-cost-new-session";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-cost-new-"));

    const response = await createApp().request("/api/command/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-UUID": ownerUuid,
      },
      body: JSON.stringify({
        command: "/cost",
        cwd: root,
      }),
    });

    try {
      expect(response.status).toBe(200);
      const payload = await response.json() as {
        success: boolean;
        delegated: boolean;
        executionMode: string;
        webNative: boolean;
        sessionId: string;
      };
      expect(payload.success).toBe(true);
      expect(payload.delegated).toBe(true);
      expect(payload.executionMode).toBe("web-native");
      expect(payload.webNative).toBe(true);
      expect(payload.sessionId).toMatch(/^session_/);

      const historyResponse = await createApp().request(`/api/sessions/${payload.sessionId}/messages`, {
        headers: {
          "X-UUID": ownerUuid,
        },
      });

      expect(historyResponse.status).toBe(200);
      expect(await historyResponse.json()).toEqual({
        messages: [
          {
            role: "user",
            content: "/cost",
            timestamp: expect.any(String),
          },
          {
            role: "assistant",
            content: expect.stringContaining("Total cost:"),
            timestamp: expect.any(String),
            blocks: [
              {
                type: "text",
                text: expect.stringContaining("Usage:"),
              },
            ],
          },
        ],
        lastSeqNum: expect.any(Number),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("POST /api/command/execute creates a session for no-session delegated slash commands", async () => {
    const ownerUuid = "user-command-compact-new-session";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-compact-new-"));

    const originalGetOrSpawn = subprocessManager.getOrSpawn.bind(subprocessManager);
    const originalEnqueueMessage = subprocessManager.enqueueMessage.bind(subprocessManager);
    const getOrSpawnMock = mock(async () => ({}) as any);
    const enqueueMessageMock = mock((_sessionId: string, _payload: string) => {});

    (subprocessManager as unknown as {
      getOrSpawn: typeof subprocessManager.getOrSpawn;
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).getOrSpawn = getOrSpawnMock;
    (subprocessManager as unknown as {
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).enqueueMessage = enqueueMessageMock;

    try {
      const response = await createApp().request("/api/command/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UUID": ownerUuid,
        },
        body: JSON.stringify({
          command: "/compact",
          cwd: root,
        }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json() as {
        success: boolean;
        delegated: boolean;
        executionMode: string;
        webNative: boolean;
        sessionId: string;
      };
      expect(payload.success).toBe(true);
      expect(payload.delegated).toBe(true);
      expect(payload.executionMode).toBe("web-native");
      expect(payload.webNative).toBe(true);
      expect(payload.sessionId).toMatch(/^session_/);

      expect(getOrSpawnMock).toHaveBeenCalledWith(
        payload.sessionId,
        expect.stringContaining(payload.sessionId),
      );
      const [, enqueuedCompactPayload] = enqueueMessageMock.mock.calls[0]!;
      expect(JSON.parse(enqueuedCompactPayload as string)).toMatchObject({
        type: "user",
        uuid: expect.any(String),
        message: {
          role: "user",
          content: "/compact",
        },
      });
    } finally {
      (subprocessManager as unknown as {
        getOrSpawn: typeof subprocessManager.getOrSpawn;
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).getOrSpawn = originalGetOrSpawn;
      (subprocessManager as unknown as {
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).enqueueMessage = originalEnqueueMessage;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("POST /api/command/execute clears no-session web state without creating a backend session", async () => {
    const ownerUuid = "user-command-clear-no-session";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-clear-no-session-"));

    try {
      const response = await createApp().request(
        `/api/command/execute?cwd=${encodeURIComponent(root)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-UUID": ownerUuid,
          },
          body: JSON.stringify({
            command: "/clear",
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        delegated: false,
        executionMode: "web-native",
        webNative: true,
        clearConversation: true,
      });
      expect(storeListSessionsByOwnerUuid(ownerUuid)).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("POST /api/command/execute accepts CLI-backed builtin prompt commands outside the static RCS catalog", async () => {
    const ownerUuid = "user-command-statusline-new-session";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-statusline-new-"));

    const originalGetOrSpawn = subprocessManager.getOrSpawn.bind(subprocessManager);
    const originalEnqueueMessage = subprocessManager.enqueueMessage.bind(subprocessManager);
    const getOrSpawnMock = mock(async () => ({}) as any);
    const enqueueMessageMock = mock((_sessionId: string, _payload: string) => {});

    (subprocessManager as unknown as {
      getOrSpawn: typeof subprocessManager.getOrSpawn;
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).getOrSpawn = getOrSpawnMock;
    (subprocessManager as unknown as {
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).enqueueMessage = enqueueMessageMock;

    try {
      const response = await createApp().request("/api/command/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UUID": ownerUuid,
        },
        body: JSON.stringify({
          command: "/statusline",
          cwd: root,
        }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json() as {
        success: boolean;
        delegated: boolean;
        executionMode: string;
        webNative: boolean;
        sessionId: string;
      };
      expect(payload.success).toBe(true);
      expect(payload.delegated).toBe(true);
      expect(payload.executionMode).toBe("prompt");
      expect(payload.webNative).toBe(true);
      expect(payload.sessionId).toMatch(/^session_/);

      expect(getOrSpawnMock).toHaveBeenCalledWith(
        payload.sessionId,
        expect.stringContaining(payload.sessionId),
      );
      const [, enqueuedStatuslinePayload] = enqueueMessageMock.mock.calls[0]!;
      expect(JSON.parse(enqueuedStatuslinePayload as string)).toMatchObject({
        type: "user",
        uuid: expect.any(String),
        message: {
          role: "user",
          content: "/statusline",
        },
      });
    } finally {
      (subprocessManager as unknown as {
        getOrSpawn: typeof subprocessManager.getOrSpawn;
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).getOrSpawn = originalGetOrSpawn;
      (subprocessManager as unknown as {
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).enqueueMessage = originalEnqueueMessage;

      await rm(root, { recursive: true, force: true });
    }
  });

  test("POST /api/command/execute accepts workspace workflow slash commands", async () => {
    const ownerUuid = "user-command-workflow-new-session";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-workflow-new-"));
    await mkdir(join(root, ".claude", "workflows"), { recursive: true });
    await writeFile(join(root, ".claude", "workflows", "release.md"), "# Release workflow\n");

    const originalGetOrSpawn = subprocessManager.getOrSpawn.bind(subprocessManager);
    const originalEnqueueMessage = subprocessManager.enqueueMessage.bind(subprocessManager);
    const getOrSpawnMock = mock(async () => ({}) as any);
    const enqueueMessageMock = mock((_sessionId: string, _payload: string) => {});

    (subprocessManager as unknown as {
      getOrSpawn: typeof subprocessManager.getOrSpawn;
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).getOrSpawn = getOrSpawnMock;
    (subprocessManager as unknown as {
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).enqueueMessage = enqueueMessageMock;

    try {
      const response = await createApp().request("/api/command/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UUID": ownerUuid,
        },
        body: JSON.stringify({
          command: "/release",
          cwd: root,
        }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json() as {
        success: boolean;
        delegated: boolean;
        executionMode: string;
        webNative: boolean;
        sessionId: string;
      };
      expect(payload.success).toBe(true);
      expect(payload.delegated).toBe(true);
      expect(payload.executionMode).toBe("prompt");
      expect(payload.webNative).toBe(true);
      expect(payload.sessionId).toMatch(/^session_/);

      expect(getOrSpawnMock).toHaveBeenCalledWith(
        payload.sessionId,
        expect.stringContaining(payload.sessionId),
      );
      const [, enqueuedReleasePayload] = enqueueMessageMock.mock.calls[0]!;
      expect(JSON.parse(enqueuedReleasePayload as string)).toMatchObject({
        type: "user",
        uuid: expect.any(String),
        message: {
          role: "user",
          content: "/release",
        },
      });
    } finally {
      (subprocessManager as unknown as {
        getOrSpawn: typeof subprocessManager.getOrSpawn;
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).getOrSpawn = originalGetOrSpawn;
      (subprocessManager as unknown as {
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).enqueueMessage = originalEnqueueMessage;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("POST /api/command/execute accepts legacy project markdown commands", async () => {
    const ownerUuid = "user-command-legacy-markdown-new-session";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-legacy-markdown-new-"));
    await mkdir(join(root, ".claude", "commands", "ops"), { recursive: true });
    await writeFile(
      join(root, ".claude", "commands", "ops", "deploy.md"),
      "---\ndescription: Deploy from legacy command\n---\n# Deploy\n",
    );

    const originalGetOrSpawn = subprocessManager.getOrSpawn.bind(subprocessManager);
    const originalEnqueueMessage = subprocessManager.enqueueMessage.bind(subprocessManager);
    const getOrSpawnMock = mock(async () => ({}) as any);
    const enqueueMessageMock = mock((_sessionId: string, _payload: string) => {});

    (subprocessManager as unknown as {
      getOrSpawn: typeof subprocessManager.getOrSpawn;
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).getOrSpawn = getOrSpawnMock;
    (subprocessManager as unknown as {
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).enqueueMessage = enqueueMessageMock;

    try {
      const response = await createApp().request("/api/command/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UUID": ownerUuid,
        },
        body: JSON.stringify({
          command: "/ops:deploy",
          cwd: root,
        }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json() as {
        success: boolean;
        delegated: boolean;
        executionMode: string;
        webNative: boolean;
        sessionId: string;
      };
      expect(payload.success).toBe(true);
      expect(payload.delegated).toBe(true);
      expect(payload.executionMode).toBe("prompt");
      expect(payload.webNative).toBe(true);
      expect(payload.sessionId).toMatch(/^session_/);

      expect(getOrSpawnMock).toHaveBeenCalledWith(
        payload.sessionId,
        expect.stringContaining(payload.sessionId),
      );
      const [, enqueuedLegacyPayload] = enqueueMessageMock.mock.calls[0]!;
      expect(JSON.parse(enqueuedLegacyPayload as string)).toMatchObject({
        type: "user",
        uuid: expect.any(String),
        message: {
          role: "user",
          content: "/ops:deploy",
        },
      });
    } finally {
      (subprocessManager as unknown as {
        getOrSpawn: typeof subprocessManager.getOrSpawn;
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).getOrSpawn = originalGetOrSpawn;
      (subprocessManager as unknown as {
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).enqueueMessage = originalEnqueueMessage;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("POST /api/command/execute serves /files from backend-native session context", async () => {
    const ownerUuid = "user-command-files";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-files-"));
    const filePath = join(root, "README.md");
    const session = storeCreateSession({
      title: "Command Files Test",
      source: "web",
      cwd: root,
    });
    storeBindSession(session.id, ownerUuid);
    storeUpsertWorkspace(session.id, {
      sourceRoot: root,
      strategy: "copy",
      workspacePath: root,
    });

    publishSessionEvent(
      session.id,
      "tool_start",
      {
        id: "toolu_readme",
        name: "Read",
        input: {
          file_path: filePath,
        },
      },
      "outbound",
    );

    const originalGetOrSpawn = subprocessManager.getOrSpawn.bind(subprocessManager);
    const originalEnqueueMessage = subprocessManager.enqueueMessage.bind(subprocessManager);
    const getOrSpawnMock = mock(async () => ({}) as any);
    const enqueueMessageMock = mock((_sessionId: string, _payload: string) => {});

    (subprocessManager as unknown as {
      getOrSpawn: typeof subprocessManager.getOrSpawn;
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).getOrSpawn = getOrSpawnMock;
    (subprocessManager as unknown as {
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).enqueueMessage = enqueueMessageMock;

    try {
      const response = await createApp().request("/api/command/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UUID": ownerUuid,
        },
        body: JSON.stringify({
          command: "/files",
          sessionId: session.id,
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        delegated: true,
        executionMode: "web-native",
        webNative: true,
        sessionId: session.id,
      });
      expect(getOrSpawnMock).not.toHaveBeenCalled();
      expect(enqueueMessageMock).not.toHaveBeenCalled();

      const historyResponse = await createApp().request(`/api/sessions/${session.id}/messages`, {
        headers: {
          "X-UUID": ownerUuid,
        },
      });

      expect(historyResponse.status).toBe(200);
      expect(await historyResponse.json()).toEqual({
        messages: [
          {
            role: "assistant",
            content: "",
            timestamp: expect.any(String),
            blocks: [
              {
                type: "tool_use",
                id: "toolu_readme",
                name: "Read",
                input: { file_path: filePath },
              },
            ],
          },
          {
            role: "user",
            content: "/files",
            timestamp: expect.any(String),
          },
          {
            role: "assistant",
            content: "Files in context:\nREADME.md",
            timestamp: expect.any(String),
            blocks: [
              {
                type: "text",
                text: "Files in context:\nREADME.md",
              },
            ],
          },
        ],
        lastSeqNum: expect.any(Number),
      });
    } finally {
      (subprocessManager as unknown as {
        getOrSpawn: typeof subprocessManager.getOrSpawn;
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).getOrSpawn = originalGetOrSpawn;
      (subprocessManager as unknown as {
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).enqueueMessage = originalEnqueueMessage;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("POST /api/command/execute creates a session for no-session /release-notes execution", async () => {
    const ownerUuid = "user-command-release-notes-new-session";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-release-notes-new-"));
    const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const originalDisableTraffic = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    process.env.CLAUDE_CONFIG_DIR = join(root, ".claude");
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";

    const originalGetOrSpawn = subprocessManager.getOrSpawn.bind(subprocessManager);
    const originalEnqueueMessage = subprocessManager.enqueueMessage.bind(subprocessManager);
    const getOrSpawnMock = mock(async () => ({}) as any);
    const enqueueMessageMock = mock((_sessionId: string, _payload: string) => {});

    (subprocessManager as unknown as {
      getOrSpawn: typeof subprocessManager.getOrSpawn;
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).getOrSpawn = getOrSpawnMock;
    (subprocessManager as unknown as {
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).enqueueMessage = enqueueMessageMock;

    try {
      const response = await createApp().request("/api/command/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UUID": ownerUuid,
        },
        body: JSON.stringify({
          command: "/release-notes",
          cwd: root,
        }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json() as {
        success: boolean;
        delegated: boolean;
        executionMode: string;
        webNative: boolean;
        sessionId: string;
      };
      expect(payload.success).toBe(true);
      expect(payload.delegated).toBe(true);
      expect(payload.executionMode).toBe("web-native");
      expect(payload.webNative).toBe(true);
      expect(payload.sessionId).toMatch(/^session_/);
      expect(getOrSpawnMock).not.toHaveBeenCalled();
      expect(enqueueMessageMock).not.toHaveBeenCalled();

      const historyResponse = await createApp().request(`/api/sessions/${payload.sessionId}/messages`, {
        headers: {
          "X-UUID": ownerUuid,
        },
      });

      expect(historyResponse.status).toBe(200);
      expect(await historyResponse.json()).toEqual({
        messages: [
          {
            role: "user",
            content: "/release-notes",
            timestamp: expect.any(String),
          },
          {
            role: "assistant",
            content: "See the full changelog at: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md",
            timestamp: expect.any(String),
            blocks: [
              {
                type: "text",
                text: "See the full changelog at: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md",
              },
            ],
          },
        ],
        lastSeqNum: expect.any(Number),
      });
    } finally {
      (subprocessManager as unknown as {
        getOrSpawn: typeof subprocessManager.getOrSpawn;
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).getOrSpawn = originalGetOrSpawn;
      (subprocessManager as unknown as {
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).enqueueMessage = originalEnqueueMessage;

      if (originalConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
      }
      if (originalDisableTraffic === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
      } else {
        process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = originalDisableTraffic;
      }

      await rm(root, { recursive: true, force: true });
    }
  });

  test("POST /api/command/execute executes /api as a backend-native alias for /provider", async () => {
    const ownerUuid = "user-command-provider-alias-new-session";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-provider-alias-new-"));
    const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const providerEnvKeys = [
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "CLAUDE_CODE_USE_FOUNDRY",
      "CLAUDE_CODE_USE_OPENAI",
      "CLAUDE_CODE_USE_GEMINI",
      "CLAUDE_CODE_USE_GROK",
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
    ] as const;
    const originalProviderEnv = Object.fromEntries(
      providerEnvKeys.map((key) => [key, process.env[key]]),
    ) as Record<(typeof providerEnvKeys)[number], string | undefined>;
    process.env.CLAUDE_CONFIG_DIR = join(root, ".claude");

    const originalGetOrSpawn = subprocessManager.getOrSpawn.bind(subprocessManager);
    const originalEnqueueMessage = subprocessManager.enqueueMessage.bind(subprocessManager);
    const getOrSpawnMock = mock(async () => {
      throw new Error("subprocess should not be started for /provider");
    });
    const enqueueMessageMock = mock((_sessionId: string, _payload: string) => {
      throw new Error("subprocess enqueue should not run for /provider");
    });

    (subprocessManager as unknown as {
      getOrSpawn: typeof subprocessManager.getOrSpawn;
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).getOrSpawn = getOrSpawnMock;
    (subprocessManager as unknown as {
      enqueueMessage: typeof subprocessManager.enqueueMessage;
    }).enqueueMessage = enqueueMessageMock;

    try {
      const response = await createApp().request("/api/command/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UUID": ownerUuid,
        },
        body: JSON.stringify({
          command: "/api anthropic",
          cwd: root,
        }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json() as {
        success: boolean;
        delegated: boolean;
        executionMode: string;
        webNative: boolean;
        sessionId: string;
      };
      expect(payload.success).toBe(true);
      expect(payload.delegated).toBe(true);
      expect(payload.executionMode).toBe("web-native");
      expect(payload.webNative).toBe(true);
      expect(payload.sessionId).toMatch(/^session_/);
      expect(getOrSpawnMock).not.toHaveBeenCalled();
      expect(enqueueMessageMock).not.toHaveBeenCalled();

      const historyResponse = await createApp().request(`/api/sessions/${payload.sessionId}/messages`, {
        headers: {
          "X-UUID": ownerUuid,
        },
      });

      expect(historyResponse.status).toBe(200);
      expect(await historyResponse.json()).toEqual({
        messages: [
          {
            role: "user",
            content: "/api anthropic",
            timestamp: expect.any(String),
          },
          {
            role: "assistant",
            content: "API provider set to anthropic.",
            timestamp: expect.any(String),
            blocks: [
              {
                type: "text",
                text: "API provider set to anthropic.",
              },
            ],
          },
        ],
        lastSeqNum: expect.any(Number),
      });
    } finally {
      (subprocessManager as unknown as {
        getOrSpawn: typeof subprocessManager.getOrSpawn;
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).getOrSpawn = originalGetOrSpawn;
      (subprocessManager as unknown as {
        enqueueMessage: typeof subprocessManager.enqueueMessage;
      }).enqueueMessage = originalEnqueueMessage;

      if (originalConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
      }
      for (const key of providerEnvKeys) {
        const value = originalProviderEnv[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      await rm(root, { recursive: true, force: true });
    }
  });
});
