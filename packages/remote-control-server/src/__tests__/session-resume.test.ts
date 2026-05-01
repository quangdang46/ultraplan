import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDb } from "../db";
import { storeReset, storeCreateSession, storeUpsertWorkspace, storeUpsertSessionState, storeGetSession } from "../store";
import { getResumeContext, resumeSession, isSessionResumable } from "../services/session-resume";

mock.module("../config", () => ({
  config: {
    port: 3000,
    host: "0.0.0.0",
    apiKeys: ["test-api-key"],
    baseUrl: "http://localhost:3000",
    pollTimeout: 8,
    heartbeatInterval: 20,
    jwtExpiresIn: 3600,
    disconnectTimeout: 300,
    webCorsOrigins: [],
    wsIdleTimeout: 30,
    wsKeepaliveInterval: 20,
  },
  getBaseUrl: () => "http://localhost:3000",
}));

describe("session-resume", () => {
  let tempRoot: string;

  beforeEach(async () => {
    initDb();
    storeReset();
    tempRoot = await mkdtemp(join(tmpdir(), "rcs-resume-test-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  describe("getResumeContext", () => {
    test("returns null for non-existent session", async () => {
      const context = await getResumeContext("non-existent");
      expect(context).toBeNull();
    });

    test("returns context for session with populated workspace", async () => {
      const session = storeCreateSession({});
      storeUpsertWorkspace(session.id, {
        sourceRoot: tempRoot,
        strategy: "copy",
        workspacePath: join(tempRoot, "workspace"),
        cleanupPolicy: "keep",
      });

      const context = await getResumeContext(session.id);
      expect(context).not.toBeNull();
      expect(context!.session.id).toBe(session.id);
      expect(context!.workspacePath).toBe(join(tempRoot, "workspace"));
      expect(context!.materializationStrategy).toBe("copy");
    });

    test("detects materialization is needed when workspace path does not exist", async () => {
      const session = storeCreateSession({});
      storeUpsertWorkspace(session.id, {
        sourceRoot: tempRoot,
        strategy: "copy",
        workspacePath: join(tempRoot, "nonexistent-workspace"),
        cleanupPolicy: "keep",
        materializationStrategy: "copy",
      });

      const context = await getResumeContext(session.id);
      expect(context).not.toBeNull();
      expect(context!.materializationNeeded).toBe(true);
    });

    test("detects materialization is not needed when workspace path exists", async () => {
      const workspacePath = join(tempRoot, "existing-workspace");
      await mkdir(workspacePath, { recursive: true });
      await writeFile(join(workspacePath, "README.md"), "test");

      const session = storeCreateSession({});
      storeUpsertWorkspace(session.id, {
        sourceRoot: tempRoot,
        strategy: "copy",
        workspacePath,
        cleanupPolicy: "keep",
        materializationStrategy: "copy",
      });

      const context = await getResumeContext(session.id);
      expect(context).not.toBeNull();
      expect(context!.materializationNeeded).toBe(false);
    });

    test("includes session state when available", async () => {
      const session = storeCreateSession({});
      storeUpsertWorkspace(session.id, {
        sourceRoot: tempRoot,
        strategy: "copy",
        workspacePath: join(tempRoot, "workspace"),
        cleanupPolicy: "keep",
      });
      storeUpsertSessionState(session.id, {
        model: "claude-opus-4-5",
        permissionMode: "plan",
      });

      const context = await getResumeContext(session.id);
      expect(context).not.toBeNull();
      expect(context!.sessionState).not.toBeNull();
      expect(context!.sessionState!.model).toBe("claude-opus-4-5");
    });
  });

  describe("resumeSession", () => {
    test("returns error for non-existent session", async () => {
      const result = await resumeSession("non-existent");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Session not found");
    });

    test("updates session status to running on successful resume", async () => {
      const sourceDir = join(tempRoot, "source-dir");
      const workspacePath = join(tempRoot, "workspace-to-materialize");
      await mkdir(sourceDir, { recursive: true });
      await writeFile(join(sourceDir, "source.txt"), "content");

      const session = storeCreateSession({});
      storeUpsertWorkspace(session.id, {
        sourceRoot: sourceDir,
        strategy: "copy",
        workspacePath,
        cleanupPolicy: "keep",
        materializationStrategy: "copy",
      });

      const result = await resumeSession(session.id);
      expect(result.success).toBe(true);
      expect(result.sessionId).toBe(session.id);

      const updatedSession = storeGetSession(session.id);
      expect(updatedSession?.status).toBe("running");
    });

    test("returns error when source root is empty for copy strategy", async () => {
      const session = storeCreateSession({});
      storeUpsertWorkspace(session.id, {
        sourceRoot: "",
        strategy: "copy",
        workspacePath: join(tempRoot, "workspace"),
        cleanupPolicy: "keep",
        materializationStrategy: "copy",
      });

      const result = await resumeSession(session.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Source root is required");
    });
  });

  describe("isSessionResumable", () => {
    test("returns false for non-existent session", () => {
      expect(isSessionResumable("non-existent")).toBe(false);
    });

    test("returns false for archived session with workspace", () => {
      const session = storeCreateSession({});
      const { storeUpdateSession } = require("../store");
      storeUpdateSession(session.id, { status: "archived" });

      expect(isSessionResumable(session.id)).toBe(false);
    });

    test("returns true for active session with workspace", () => {
      const session = storeCreateSession({});
      storeUpsertWorkspace(session.id, {
        sourceRoot: tempRoot,
        strategy: "copy",
        workspacePath: join(tempRoot, "workspace"),
        cleanupPolicy: "keep",
      });

      expect(isSessionResumable(session.id)).toBe(true);
    });
  });
});