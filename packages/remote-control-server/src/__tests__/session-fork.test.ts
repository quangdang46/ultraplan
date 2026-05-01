import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDb } from "../db";
import {
  storeReset,
  storeCreateSession,
  storeUpsertWorkspace,
  storeUpsertSessionState,
  storeGetSession,
  storeGetWorkspaceBySession,
  storeGetSessionState,
} from "../store";
import { forkSession, forkSessionWorkspace } from "../services/session-fork";

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

describe("session-fork", () => {
  let tempRoot: string;
  let gitRepoPath: string;

  beforeEach(async () => {
    initDb();
    storeReset();
    tempRoot = await mkdtemp(join(tmpdir(), "rcs-fork-test-"));
    gitRepoPath = join(tempRoot, "repo");
    await mkdir(gitRepoPath, { recursive: true });
    await Bun.$`cd ${gitRepoPath} && git init`.quiet();
    await Bun.$`cd ${gitRepoPath} && git config user.email test@test.com`.quiet();
    await Bun.$`cd ${gitRepoPath} && git config user.name Test`.quiet();
    await writeFile(join(gitRepoPath, "README.md"), "test content");
    await Bun.$`cd ${gitRepoPath} && git add . && git commit -m init`.quiet();
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  describe("forkSession", () => {
    test("returns error for non-existent source session", async () => {
      const result = await forkSession("non-existent");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Source session not found");
    });

    test("creates a new session with forked workspace", async () => {
      const sourceSession = storeCreateSession({ title: "Original Session" });
      storeUpsertWorkspace(sourceSession.id, {
        sourceRoot: gitRepoPath,
        repoRoot: gitRepoPath,
        strategy: "copy",
        workspacePath: join(tempRoot, "original-workspace"),
        cleanupPolicy: "keep",
        materializationStrategy: "copy",
      });
      storeUpsertSessionState(sourceSession.id, {
        model: "claude-opus-4-5",
        permissionMode: "plan",
        selectedRepos: ["repo-a"],
      });

      const result = await forkSession(sourceSession.id);
      expect(result.success).toBe(true);
      expect(result.newSessionId).toBeDefined();

      const newSession = storeGetSession(result.newSessionId!);
      expect(newSession).not.toBeNull();
      expect(newSession?.title).toBe("Fork of Original Session");
      expect(newSession?.status).toBe("idle");

      const newWorkspace = storeGetWorkspaceBySession(result.newSessionId!);
      expect(newWorkspace).not.toBeNull();

      const newSessionState = storeGetSessionState(result.newSessionId!);
      expect(newSessionState).not.toBeNull();
      expect(newSessionState?.model).toBe("claude-opus-4-5");
      expect(newSessionState?.selectedRepos).toEqual(["repo-a"]);
    });

    test("fork with custom title", async () => {
      const sourceSession = storeCreateSession({});
      storeUpsertWorkspace(sourceSession.id, {
        sourceRoot: gitRepoPath,
        strategy: "copy",
        workspacePath: join(tempRoot, "original"),
        cleanupPolicy: "keep",
        materializationStrategy: "copy",
      });

      const result = await forkSession(sourceSession.id, { newSessionTitle: "My Custom Fork" });
      expect(result.success).toBe(true);

      const newSession = storeGetSession(result.newSessionId!);
      expect(newSession?.title).toBe("My Custom Fork");
    });

    test("does not fork workspace when forkWorkspace is false", async () => {
      const sourceSession = storeCreateSession({});
      storeUpsertWorkspace(sourceSession.id, {
        sourceRoot: gitRepoPath,
        strategy: "copy",
        workspacePath: join(tempRoot, "original"),
        cleanupPolicy: "keep",
        materializationStrategy: "copy",
      });

      const result = await forkSession(sourceSession.id, { forkWorkspace: false });
      expect(result.success).toBe(true);

      const newWorkspace = storeGetWorkspaceBySession(result.newSessionId!);
      expect(newWorkspace?.workspacePath).toBe("");
    });
  });

  describe("forkSessionWorkspace", () => {
    test("returns error for non-existent source workspace", async () => {
      const targetSession = storeCreateSession({});
      const result = await forkSessionWorkspace("non-existent", targetSession.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Source workspace not found");
    });

    test("forks copy workspace successfully", async () => {
      const sourceSession = storeCreateSession({});
      const sourcePath = join(tempRoot, "source-copy-workspace");
      await mkdir(sourcePath, { recursive: true });
      await writeFile(join(sourcePath, "test.txt"), "hello");

      storeUpsertWorkspace(sourceSession.id, {
        sourceRoot: sourcePath,
        strategy: "copy",
        workspacePath: sourcePath,
        cleanupPolicy: "keep",
        materializationStrategy: "copy",
      });

      const targetSession = storeCreateSession({});
      const result = await forkSessionWorkspace(sourceSession.id, targetSession.id);

      expect(result.success).toBe(true);
      expect(result.newWorkspacePath).toContain("fork-");

      const content = await readFile(join(result.newWorkspacePath, "test.txt"), "utf-8");
      expect(content).toBe("hello");
    });

    test("forks temp_clone workspace successfully", async () => {
      const sourceSession = storeCreateSession({});
      const sourcePath = join(tempRoot, "source-clone-workspace");

      storeUpsertWorkspace(sourceSession.id, {
        sourceRoot: gitRepoPath,
        strategy: "temp-clone",
        workspacePath: sourcePath,
        cleanupPolicy: "keep",
        materializationStrategy: "temp_clone",
      });

      const targetSession = storeCreateSession({});
      const result = await forkSessionWorkspace(sourceSession.id, targetSession.id);

      expect(result.success).toBe(true);
      expect(result.newWorkspacePath).toContain("fork-");

      const readmeExists = await stat(join(result.newWorkspacePath, "README.md"));
      expect(readmeExists.isFile()).toBe(true);
    });
  });
});