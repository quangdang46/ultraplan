import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { initDb } from "../db";
import {
  storeReset,
  storeCreateUser,
  storeGetUser,
  storeCreateToken,
  storeGetUserByToken,
  storeDeleteToken,
  storeCreateEnvironment,
  storeGetEnvironment,
  storeUpdateEnvironment,
  storeListActiveEnvironments,
  storeListActiveEnvironmentsByUsername,
  storeCreateSession,
  storeGetSession,
  storeUpdateSession,
  storeListSessions,
  storeListSessionsByUsername,
  storeListSessionsByEnvironment,
  storeDeleteSession,
  storeGetWorkspace,
  storeGetWorkspaceBySession,
  storeUpsertWorkspace,
  storeGetSessionState,
  storeUpsertSessionState,
  storeGetSessionWorker,
  storeUpsertSessionWorker,
  storeBindSession,
  storeIsSessionOwner,
  storeListSessionsByOwnerUuid,
  storeCreateWorkItem,
  storeGetWorkItem,
  storeGetPendingWorkItem,
  storeUpdateWorkItem,
} from "../store";

describe("store", () => {
  beforeAll(() => {
    initDb();
  });

  beforeEach(() => {
    storeReset();
  });

  // ---------- User ----------

  describe("storeCreateUser", () => {
    test("creates a new user", () => {
      const user = storeCreateUser("alice");
      expect(user.username).toBe("alice");
      expect(user.createdAt).toBeInstanceOf(Date);
    });

    test("returns existing user on duplicate create", () => {
      const first = storeCreateUser("bob");
      const second = storeCreateUser("bob");
      expect(first).toEqual(second);
    });
  });

  describe("storeGetUser", () => {
    test("returns undefined for non-existent user", () => {
      expect(storeGetUser("nobody")).toBeUndefined();
    });

    test("returns created user", () => {
      storeCreateUser("charlie");
      const user = storeGetUser("charlie");
      expect(user?.username).toBe("charlie");
    });
  });

  // ---------- Token ----------

  describe("storeCreateToken / storeGetUserByToken", () => {
    test("creates and resolves token", () => {
      storeCreateUser("dave");
      storeCreateToken("dave", "tk_123");
      const entry = storeGetUserByToken("tk_123");
      expect(entry?.username).toBe("dave");
      expect(entry?.createdAt).toBeInstanceOf(Date);
    });

    test("returns undefined for unknown token", () => {
      expect(storeGetUserByToken("nonexistent")).toBeUndefined();
    });
  });

  describe("storeDeleteToken", () => {
    test("deletes an existing token", () => {
      storeCreateUser("eve");
      storeCreateToken("eve", "tk_del");
      expect(storeDeleteToken("tk_del")).toBe(true);
      expect(storeGetUserByToken("tk_del")).toBeUndefined();
    });

    test("returns false for non-existent token", () => {
      expect(storeDeleteToken("nope")).toBe(false);
    });
  });

  // ---------- Environment ----------

  describe("storeCreateEnvironment", () => {
    test("creates environment with defaults", () => {
      const env = storeCreateEnvironment({ secret: "s1" });
      expect(env.id).toMatch(/^env_/);
      expect(env.secret).toBe("s1");
      expect(env.status).toBe("active");
      expect(env.machineName).toBeNull();
      expect(env.maxSessions).toBe(1);
      expect(env.workerType).toBe("claude_code");
      expect(env.lastPollAt).toBeInstanceOf(Date);
    });

    test("creates environment with all options", () => {
      const env = storeCreateEnvironment({
        secret: "s2",
        machineName: "mac1",
        directory: "/home/user",
        branch: "main",
        gitRepoUrl: "https://github.com/test/repo",
        maxSessions: 5,
        workerType: "custom",
        bridgeId: "bridge1",
        username: "alice",
      });
      expect(env.machineName).toBe("mac1");
      expect(env.directory).toBe("/home/user");
      expect(env.branch).toBe("main");
      expect(env.gitRepoUrl).toBe("https://github.com/test/repo");
      expect(env.maxSessions).toBe(5);
      expect(env.workerType).toBe("custom");
      expect(env.bridgeId).toBe("bridge1");
      expect(env.username).toBe("alice");
    });
  });

  describe("storeGetEnvironment", () => {
    test("returns undefined for non-existent env", () => {
      expect(storeGetEnvironment("env_no")).toBeUndefined();
    });

    test("returns created environment", () => {
      const env = storeCreateEnvironment({ secret: "s" });
      expect(storeGetEnvironment(env.id)).toEqual(env);
    });
  });

  describe("storeUpdateEnvironment", () => {
    test("updates existing environment", () => {
      const env = storeCreateEnvironment({ secret: "s" });
      const result = storeUpdateEnvironment(env.id, { status: "disconnected" });
      expect(result).toBe(true);
      const updated = storeGetEnvironment(env.id);
      expect(updated?.status).toBe("disconnected");
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(env.updatedAt.getTime());
    });

    test("returns false for non-existent environment", () => {
      expect(storeUpdateEnvironment("env_no", { status: "active" })).toBe(false);
    });
  });

  describe("storeListActiveEnvironments", () => {
    test("returns only active environments", () => {
      const env1 = storeCreateEnvironment({ secret: "s1" });
      const env2 = storeCreateEnvironment({ secret: "s2" });
      storeUpdateEnvironment(env1.id, { status: "deregistered" });
      const active = storeListActiveEnvironments();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(env2.id);
    });
  });

  describe("storeListActiveEnvironmentsByUsername", () => {
    test("filters by username", () => {
      storeCreateEnvironment({ secret: "s1", username: "alice" });
      storeCreateEnvironment({ secret: "s2", username: "bob" });
      const aliceEnvs = storeListActiveEnvironmentsByUsername("alice");
      expect(aliceEnvs).toHaveLength(1);
      expect(aliceEnvs[0].username).toBe("alice");
    });
  });

  // ---------- Session ----------

  describe("storeCreateSession", () => {
    test("creates session with defaults", () => {
      const session = storeCreateSession({});
      expect(session.id).toMatch(/^session_/);
      expect(session.status).toBe("idle");
      expect(session.source).toBe("remote-control");
      expect(session.environmentId).toBeNull();
      expect(session.workerEpoch).toBe(0);
    });

    test("creates session with options", () => {
      const env = storeCreateEnvironment({ secret: "s" });
      const session = storeCreateSession({
        environmentId: env.id,
        title: "Test Session",
        source: "cli",
        permissionMode: "auto",
        username: "alice",
      });
      expect(session.environmentId).toBe(env.id);
      expect(session.title).toBe("Test Session");
      expect(session.source).toBe("cli");
      expect(session.permissionMode).toBe("auto");
      expect(session.username).toBe("alice");
    });

    test("creates session with custom idPrefix", () => {
      const session = storeCreateSession({ idPrefix: "cse_" });
      expect(session.id).toMatch(/^cse_/);
    });
  });

  describe("storeGetSession", () => {
    test("returns undefined for non-existent session", () => {
      expect(storeGetSession("nope")).toBeUndefined();
    });
  });

  describe("storeUpdateSession", () => {
    test("updates existing session", () => {
      const session = storeCreateSession({});
      const result = storeUpdateSession(session.id, { title: "Updated", status: "active" });
      expect(result).toBe(true);
      const updated = storeGetSession(session.id);
      expect(updated?.title).toBe("Updated");
      expect(updated?.status).toBe("active");
    });

    test("returns false for non-existent session", () => {
      expect(storeUpdateSession("nope", { title: "x" })).toBe(false);
    });

    test("increments workerEpoch", () => {
      const session = storeCreateSession({});
      storeUpdateSession(session.id, { workerEpoch: 1 });
      expect(storeGetSession(session.id)?.workerEpoch).toBe(1);
    });

    test("supports explicit updatedAt overrides and touch-only updates", () => {
      const session = storeCreateSession({});
      const forcedUpdatedAt = new Date("2024-01-02T03:04:05.000Z");

      expect(storeUpdateSession(session.id, { updatedAt: forcedUpdatedAt })).toBe(
        true,
      );
      expect(storeGetSession(session.id)?.updatedAt.toISOString()).toBe(
        forcedUpdatedAt.toISOString(),
      );
    });
  });

  describe("storeListSessions", () => {
    test("returns all sessions", () => {
      storeCreateSession({});
      storeCreateSession({});
      expect(storeListSessions()).toHaveLength(2);
    });
  });

  describe("storeListSessionsByUsername", () => {
    test("filters by username", () => {
      storeCreateSession({ username: "alice" });
      storeCreateSession({ username: "bob" });
      expect(storeListSessionsByUsername("alice")).toHaveLength(1);
    });
  });

  describe("storeListSessionsByEnvironment", () => {
    test("filters by environment", () => {
      const env = storeCreateEnvironment({ secret: "s" });
      storeCreateSession({ environmentId: env.id });
      storeCreateSession({});
      expect(storeListSessionsByEnvironment(env.id)).toHaveLength(1);
    });
  });

  describe("storeDeleteSession", () => {
    test("deletes existing session", () => {
      const session = storeCreateSession({});
      expect(storeDeleteSession(session.id)).toBe(true);
      expect(storeGetSession(session.id)).toBeUndefined();
    });

    test("returns false for non-existent session", () => {
      expect(storeDeleteSession("nope")).toBe(false);
    });
  });

  // ---------- Workspace ----------

  describe("storeUpsertWorkspace / storeGetWorkspace", () => {
    test("creates and resolves a workspace for a session", () => {
      const session = storeCreateSession({});
      const workspace = storeUpsertWorkspace(session.id, {
        sourceRoot: "/repo",
        repoRoot: "/repo",
        baseRef: "main",
        branch: "feature/test",
        strategy: "worktree",
        workspacePath: "/repo/.workspace/worktrees/session-1",
        cleanupPolicy: "delete-if-clean",
      });

      expect(workspace.id).toMatch(/^workspace_/);
      expect(workspace.sessionId).toBe(session.id);
      expect(workspace.strategy).toBe("worktree");
      expect(workspace.workspacePath).toBe("/repo/.workspace/worktrees/session-1");
      expect(workspace.cleanupPolicy).toBe("delete-if-clean");
      expect(storeGetWorkspace(workspace.id)).toEqual(workspace);
      expect(storeGetWorkspaceBySession(session.id)).toEqual(workspace);
    });

    test("updates an existing workspace without losing prior fields", () => {
      const env = storeCreateEnvironment({ secret: "env-secret" });
      const session = storeCreateSession({ environmentId: env.id });

      const created = storeUpsertWorkspace(session.id, {
        environmentId: env.id,
        sourceRoot: "/repo",
        repoRoot: "/repo",
        strategy: "worktree",
        workspacePath: "/repo/.workspace/worktrees/session-1",
      });
      const updated = storeUpsertWorkspace(session.id, {
        branch: "feature/updated",
        cleanupPolicy: "delete-on-close",
      });

      expect(updated.id).toBe(created.id);
      expect(updated.environmentId).toBe(env.id);
      expect(updated.sourceRoot).toBe("/repo");
      expect(updated.branch).toBe("feature/updated");
      expect(updated.cleanupPolicy).toBe("delete-on-close");
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    });

    test("removes workspace rows when the session is deleted", () => {
      const session = storeCreateSession({});
      const workspace = storeUpsertWorkspace(session.id, {
        sourceRoot: "/repo",
        strategy: "same-dir",
        workspacePath: "/repo",
      });

      expect(storeDeleteSession(session.id)).toBe(true);
      expect(storeGetWorkspace(workspace.id)).toBeUndefined();
      expect(storeGetWorkspaceBySession(session.id)).toBeUndefined();
    });
  });

  // ---------- Session State ----------

  describe("storeUpsertSessionState / storeGetSessionState", () => {
    test("creates durable per-session runtime state", () => {
      const session = storeCreateSession({});
      const state = storeUpsertSessionState(session.id, {
        model: "claude-opus-4-5",
        permissionMode: "plan",
        thinkingEffort: "high",
        selectedRepos: ["repo-a", "repo-b"],
        commandProfile: "safe-shell",
      });

      expect(state.sessionId).toBe(session.id);
      expect(state.model).toBe("claude-opus-4-5");
      expect(state.permissionMode).toBe("plan");
      expect(state.thinkingEffort).toBe("high");
      expect(state.selectedRepos).toEqual(["repo-a", "repo-b"]);
      expect(state.commandProfile).toBe("safe-shell");
      expect(storeGetSessionState(session.id)).toEqual(state);
    });

    test("partially updates session state and preserves unspecified values", () => {
      const session = storeCreateSession({});
      const created = storeUpsertSessionState(session.id, {
        model: "claude-sonnet-4-6",
        permissionMode: "default",
        thinkingEffort: "medium",
        selectedRepos: ["repo-a"],
      });
      const updated = storeUpsertSessionState(session.id, {
        permissionMode: "acceptEdits",
        commandProfile: "workspace-profile",
      });

      expect(updated.model).toBe("claude-sonnet-4-6");
      expect(updated.permissionMode).toBe("acceptEdits");
      expect(updated.thinkingEffort).toBe("medium");
      expect(updated.selectedRepos).toEqual(["repo-a"]);
      expect(updated.commandProfile).toBe("workspace-profile");
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    });

    test("removes session state rows when the session is deleted", () => {
      const session = storeCreateSession({});
      storeUpsertSessionState(session.id, {
        model: "claude-sonnet-4-6",
      });

      expect(storeDeleteSession(session.id)).toBe(true);
      expect(storeGetSessionState(session.id)).toBeUndefined();
    });
  });

  describe("storeUpsertSessionWorker / storeGetSessionWorker", () => {
    test("creates durable worker state for an existing session", () => {
      const session = storeCreateSession({});
      const worker = storeUpsertSessionWorker(session.id, {
        workerStatus: "running",
        externalMetadata: { permission_mode: "default" },
      });

      expect(worker.sessionId).toBe(session.id);
      expect(worker.workerStatus).toBe("running");
      expect(worker.externalMetadata).toEqual({ permission_mode: "default" });
      expect(storeGetSessionWorker(session.id)).toEqual(worker);
    });

    test("skips inserts when the session no longer exists", () => {
      const worker = storeUpsertSessionWorker("missing-session", {
        workerStatus: "interrupted",
      });

      expect(worker.sessionId).toBe("missing-session");
      expect(worker.workerStatus).toBe("interrupted");
      expect(storeGetSessionWorker("missing-session")).toBeUndefined();
    });
  });

  // ---------- Session Ownership ----------

  describe("storeBindSession / storeIsSessionOwner", () => {
    test("binds and checks ownership", () => {
      const session = storeCreateSession({});
      storeBindSession(session.id, "uuid-1");
      expect(storeIsSessionOwner(session.id, "uuid-1")).toBe(true);
      expect(storeIsSessionOwner(session.id, "uuid-2")).toBe(false);
    });

    test("unbound session has no owner", () => {
      const session = storeCreateSession({});
      expect(storeIsSessionOwner(session.id, "uuid-1")).toBe(false);
    });

    test("multiple owners per session", () => {
      const session = storeCreateSession({});
      storeBindSession(session.id, "uuid-1");
      storeBindSession(session.id, "uuid-2");
      expect(storeIsSessionOwner(session.id, "uuid-1")).toBe(true);
      expect(storeIsSessionOwner(session.id, "uuid-2")).toBe(true);
    });
  });

  describe("storeListSessionsByOwnerUuid", () => {
    test("returns sessions owned by uuid", () => {
      const s1 = storeCreateSession({});
      const s2 = storeCreateSession({});
      storeBindSession(s1.id, "uuid-1");
      storeBindSession(s2.id, "uuid-1");
      const owned = storeListSessionsByOwnerUuid("uuid-1");
      expect(owned).toHaveLength(2);
    });

    test("returns empty for unknown uuid", () => {
      expect(storeListSessionsByOwnerUuid("nope")).toHaveLength(0);
    });

    test("excludes deleted sessions", () => {
      const s1 = storeCreateSession({});
      storeBindSession(s1.id, "uuid-1");
      storeDeleteSession(s1.id);
      expect(storeListSessionsByOwnerUuid("uuid-1")).toHaveLength(0);
    });
  });

  // ---------- Work Items ----------

  describe("storeCreateWorkItem", () => {
    test("creates work item with defaults", () => {
      const env = storeCreateEnvironment({ secret: "s" });
      const session = storeCreateSession({ environmentId: env.id });
      const item = storeCreateWorkItem({
        environmentId: env.id,
        sessionId: session.id,
        secret: "sec1",
      });
      expect(item.id).toMatch(/^work_/);
      expect(item.environmentId).toBe(env.id);
      expect(item.sessionId).toBe(session.id);
      expect(item.state).toBe("pending");
      expect(item.secret).toBe("sec1");
    });
  });

  describe("storeGetWorkItem", () => {
    test("returns undefined for non-existent", () => {
      expect(storeGetWorkItem("nope")).toBeUndefined();
    });

    test("returns created work item", () => {
      const env = storeCreateEnvironment({ secret: "s" });
      const session = storeCreateSession({ environmentId: env.id });
      const item = storeCreateWorkItem({ environmentId: env.id, sessionId: session.id, secret: "s" });
      expect(storeGetWorkItem(item.id)).toEqual(item);
    });
  });

  describe("storeGetPendingWorkItem", () => {
    test("returns pending work for environment", () => {
      const env = storeCreateEnvironment({ secret: "s" });
      const session = storeCreateSession({ environmentId: env.id });
      const item = storeCreateWorkItem({ environmentId: env.id, sessionId: session.id, secret: "s" });
      const found = storeGetPendingWorkItem(env.id);
      expect(found?.id).toBe(item.id);
    });

    test("returns undefined when no pending work", () => {
      const env = storeCreateEnvironment({ secret: "s" });
      const session = storeCreateSession({ environmentId: env.id });
      storeCreateWorkItem({ environmentId: env.id, sessionId: session.id, secret: "s" });
      expect(storeGetPendingWorkItem("env2")).toBeUndefined();
    });

    test("skips non-pending items", () => {
      const env = storeCreateEnvironment({ secret: "s" });
      const session = storeCreateSession({ environmentId: env.id });
      const item = storeCreateWorkItem({ environmentId: env.id, sessionId: session.id, secret: "s" });
      storeUpdateWorkItem(item.id, { state: "dispatched" });
      expect(storeGetPendingWorkItem(env.id)).toBeUndefined();
    });
  });

  describe("storeUpdateWorkItem", () => {
    test("updates existing work item", () => {
      const env = storeCreateEnvironment({ secret: "s" });
      const session = storeCreateSession({ environmentId: env.id });
      const item = storeCreateWorkItem({ environmentId: env.id, sessionId: session.id, secret: "s" });
      expect(storeUpdateWorkItem(item.id, { state: "acked" })).toBe(true);
      expect(storeGetWorkItem(item.id)?.state).toBe("acked");
    });

    test("returns false for non-existent", () => {
      expect(storeUpdateWorkItem("nope", { state: "acked" })).toBe(false);
    });
  });

  // ---------- storeReset ----------

  describe("storeReset", () => {
    test("clears all data", () => {
      storeCreateUser("alice");
      const env = storeCreateEnvironment({ secret: "s" });
      const session = storeCreateSession({ environmentId: env.id });
      storeUpsertWorkspace(session.id, {
        sourceRoot: "/repo",
        strategy: "same-dir",
        workspacePath: "/repo",
      });
      storeUpsertSessionState(session.id, {
        model: "claude-sonnet-4-6",
      });
      storeCreateWorkItem({ environmentId: env.id, sessionId: session.id, secret: "s" });

      storeReset();

      expect(storeGetUser("alice")).toBeUndefined();
      expect(storeListActiveEnvironments()).toHaveLength(0);
      expect(storeListSessions()).toHaveLength(0);
      expect(storeGetWorkspaceBySession(session.id)).toBeUndefined();
      expect(storeGetSessionState(session.id)).toBeUndefined();
      expect(storeGetPendingWorkItem(env.id)).toBeUndefined();
    });
  });
});
