import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { initDb } from "../db";
import { storeReset, storeCreateSession, storeCreateEnvironment } from "../store";
import {
  getWorkspaceEnvironment,
  getOrCreateWorkspaceForSession,
  listWorkspacesForEnvironment,
  resolveWorkspacePath,
  workspaceHasMaterialization,
} from "../services/workspace-repo";
import {
  getSessionState,
  updateSessionState,
  getSessionModel,
  setSessionModel,
  getSessionPermissionMode,
  setSessionPermissionMode,
  type SessionStatePatch,
} from "../services/session-state-repo";

describe("workspace-repo", () => {
  beforeAll(() => {
    initDb();
  });

  beforeEach(() => {
    storeReset();
  });

  describe("getWorkspaceEnvironment", () => {
    test("returns null for non-existent workspace", () => {
      const result = getWorkspaceEnvironment("nonexistent-ws");
      expect(result).toBeNull();
    });

    test("returns null when workspace has no environment", () => {
      const session = storeCreateSession({});
      const workspace = getOrCreateWorkspaceForSession(session.id);
      expect(getWorkspaceEnvironment(workspace.id)).toBeNull();
    });

    test("returns environment record when workspace is bound to one", () => {
      const env = storeCreateEnvironment({ secret: "env-secret-1" });
      const session = storeCreateSession({ environmentId: env.id });
      const workspace = getOrCreateWorkspaceForSession(session.id, env.id);
      const result = getWorkspaceEnvironment(workspace.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(env.id);
      expect(result?.secret).toBe("env-secret-1");
    });
  });

  describe("getOrCreateWorkspaceForSession", () => {
    test("creates new workspace when none exists", () => {
      const session = storeCreateSession({});
      const ws = getOrCreateWorkspaceForSession(session.id);
      expect(ws).not.toBeNull();
      expect(ws.sessionId).toBe(session.id);
      expect(ws.strategy).toBe("same-dir");
      expect(ws.workspacePath).toBe("");
    });

    test("returns existing workspace when already materialized", () => {
      const env = storeCreateEnvironment({ secret: "env-secret-2" });
      const session = storeCreateSession({ environmentId: env.id });
      const first = getOrCreateWorkspaceForSession(session.id, env.id);
      const second = getOrCreateWorkspaceForSession(session.id, env.id);
      expect(second.id).toBe(first.id);
    });

    test("creates workspace with provided envId", () => {
      const env = storeCreateEnvironment({ secret: "env-secret-3" });
      const session = storeCreateSession({});
      const ws = getOrCreateWorkspaceForSession(session.id, env.id);
      expect(ws.environmentId).toBe(env.id);
    });

    test("workspace path is empty on initial provisioning", () => {
      const session = storeCreateSession({});
      const ws = getOrCreateWorkspaceForSession(session.id);
      expect(ws.workspacePath).toBe("");
    });
  });

  describe("listWorkspacesForEnvironment", () => {
    test("returns empty array for non-existent environment", () => {
      const result = listWorkspacesForEnvironment("nonexistent-env");
      expect(result).toHaveLength(0);
    });

    test("returns empty array when environment has no workspaces", () => {
      const env = storeCreateEnvironment({ secret: "env-no-ws" });
      const result = listWorkspacesForEnvironment(env.id);
      expect(result).toHaveLength(0);
    });

    test("returns all workspaces for an environment", () => {
      const env = storeCreateEnvironment({ secret: "env-multi-ws" });
      const s1 = storeCreateSession({ environmentId: env.id });
      const s2 = storeCreateSession({ environmentId: env.id });
      getOrCreateWorkspaceForSession(s1.id, env.id);
      getOrCreateWorkspaceForSession(s2.id, env.id);
      const workspaces = listWorkspacesForEnvironment(env.id);
      expect(workspaces).toHaveLength(2);
    });

    test("returns workspaces ordered by created_at asc", () => {
      const env = storeCreateEnvironment({ secret: "env-ordered" });
      const s1 = storeCreateSession({ environmentId: env.id });
      const s2 = storeCreateSession({ environmentId: env.id });
      const ws1 = getOrCreateWorkspaceForSession(s1.id, env.id);
      const ws2 = getOrCreateWorkspaceForSession(s2.id, env.id);
      const workspaces = listWorkspacesForEnvironment(env.id);
      expect(workspaces[0].id).toBe(ws1.id);
      expect(workspaces[1].id).toBe(ws2.id);
    });
  });

  describe("resolveWorkspacePath", () => {
    test("returns null for non-existent workspace", () => {
      const result = resolveWorkspacePath("nonexistent-ws");
      expect(result).toBeNull();
    });

    test("returns null when workspacePath is empty", () => {
      const session = storeCreateSession({});
      const ws = getOrCreateWorkspaceForSession(session.id);
      expect(resolveWorkspacePath(ws.id)).toBeNull();
    });

    test("returns workspacePath when set", () => {
      const env = storeCreateEnvironment({ secret: "env-path" });
      const session = storeCreateSession({ environmentId: env.id });
      const ws = getOrCreateWorkspaceForSession(session.id, env.id);
      // Manually set workspacePath to simulate materialization
      const { storeUpsertWorkspace } = require("../store");
      const updated = storeUpsertWorkspace(session.id, {
        workspacePath: "/absolute/path/to/workspace",
        strategy: "worktree",
        sourceRoot: "/repo",
      });
      expect(resolveWorkspacePath(updated.id)).toBe("/absolute/path/to/workspace");
    });
  });

  describe("workspaceHasMaterialization", () => {
    test("returns false for non-existent workspace", () => {
      const result = workspaceHasMaterialization("nonexistent-ws");
      expect(result).toBe(false);
    });

    test("returns false when workspacePath is empty", () => {
      const session = storeCreateSession({});
      const ws = getOrCreateWorkspaceForSession(session.id);
      expect(workspaceHasMaterialization(ws.id)).toBe(false);
    });

    test("returns true when workspacePath is non-empty", () => {
      const env = storeCreateEnvironment({ secret: "env-mat" });
      const session = storeCreateSession({ environmentId: env.id });
      const ws = getOrCreateWorkspaceForSession(session.id, env.id);
      const { storeUpsertWorkspace } = require("../store");
      const updated = storeUpsertWorkspace(session.id, {
        workspacePath: "/repo/.workspace/worktrees/session-1",
        strategy: "worktree",
        sourceRoot: "/repo",
      });
      expect(workspaceHasMaterialization(updated.id)).toBe(true);
    });

    test("placeholder same-dir with path is considered materialized", () => {
      const env = storeCreateEnvironment({ secret: "env-samedir" });
      const session = storeCreateSession({ environmentId: env.id });
      const ws = getOrCreateWorkspaceForSession(session.id, env.id);
      const { storeUpsertWorkspace } = require("../store");
      const updated = storeUpsertWorkspace(session.id, {
        workspacePath: "/repo",
        strategy: "same-dir",
        sourceRoot: "/repo",
      });
      expect(workspaceHasMaterialization(updated.id)).toBe(true);
    });
  });
});

describe("session-state-repo", () => {
  beforeAll(() => {
    initDb();
  });

  beforeEach(() => {
    storeReset();
  });

  describe("getSessionState", () => {
    test("returns null for non-existent session", () => {
      const result = getSessionState("nonexistent-session");
      expect(result).toBeNull();
    });

    test("returns null when session has no state", () => {
      const session = storeCreateSession({});
      const result = getSessionState(session.id);
      expect(result).toBeNull();
    });

    test("returns session state when it exists", () => {
      const session = storeCreateSession({});
      const patch: SessionStatePatch = {
        model: "claude-opus-4-5",
        permissionMode: "plan",
        thinkingEffort: "high",
      };
      updateSessionState(session.id, patch);
      const state = getSessionState(session.id);
      expect(state).not.toBeNull();
      expect(state?.model).toBe("claude-opus-4-5");
      expect(state?.permissionMode).toBe("plan");
      expect(state?.thinkingEffort).toBe("high");
    });
  });

  describe("updateSessionState", () => {
    test("creates session state with provided fields", () => {
      const session = storeCreateSession({});
      const state = updateSessionState(session.id, {
        model: "claude-sonnet",
        permissionMode: "clipboard",
        thinkingEffort: "medium",
        selectedRepos: ["/repo/a", "/repo/b"],
        commandProfile: "default",
      });
      expect(state.sessionId).toBe(session.id);
      expect(state.model).toBe("claude-sonnet");
      expect(state.permissionMode).toBe("clipboard");
      expect(state.thinkingEffort).toBe("medium");
      expect(state.selectedRepos).toEqual(["/repo/a", "/repo/b"]);
      expect(state.commandProfile).toBe("default");
    });

    test("updates only specified fields and preserves others", () => {
      const session = storeCreateSession({});
      const created = updateSessionState(session.id, {
        model: "claude-sonnet-4-6",
        permissionMode: "default",
      });
      const updated = updateSessionState(session.id, {
        permissionMode: "acceptEdits",
        commandProfile: "workspace-profile",
      });
      expect(updated.model).toBe("claude-sonnet-4-6");
      expect(updated.permissionMode).toBe("acceptEdits");
      expect(updated.commandProfile).toBe("workspace-profile");
      expect(updated.thinkingEffort).toBeNull();
    });

    test("can set fields to null explicitly", () => {
      const session = storeCreateSession({});
      updateSessionState(session.id, { model: "claude-opus" });
      const cleared = updateSessionState(session.id, { model: null });
      expect(cleared.model).toBeNull();
    });
  });

  describe("getSessionModel", () => {
    test("returns null for non-existent session", () => {
      const result = getSessionModel("nonexistent-session");
      expect(result).toBeNull();
    });

    test("returns null when session has no state", () => {
      const session = storeCreateSession({});
      expect(getSessionModel(session.id)).toBeNull();
    });

    test("returns model from session state", () => {
      const session = storeCreateSession({});
      updateSessionState(session.id, { model: "claude-opus-4-5" });
      expect(getSessionModel(session.id)).toBe("claude-opus-4-5");
    });
  });

  describe("setSessionModel", () => {
    test("creates session state with model when none exists", () => {
      const session = storeCreateSession({});
      const model = setSessionModel(session.id, "claude-sonnet-4-6");
      expect(model).toBe("claude-sonnet-4-6");
      const state = getSessionState(session.id);
      expect(state?.model).toBe("claude-sonnet-4-6");
    });

    test("updates model in existing session state", () => {
      const session = storeCreateSession({});
      setSessionModel(session.id, "claude-opus");
      const updated = setSessionModel(session.id, "claude-haiku");
      expect(updated).toBe("claude-haiku");
    });

    test("can set model to null", () => {
      const session = storeCreateSession({});
      setSessionModel(session.id, "claude-sonnet");
      const cleared = setSessionModel(session.id, null);
      expect(cleared).toBeNull();
    });
  });

  describe("getSessionPermissionMode", () => {
    test("returns null for non-existent session", () => {
      const result = getSessionPermissionMode("nonexistent-session");
      expect(result).toBeNull();
    });

    test("returns null when session has no state", () => {
      const session = storeCreateSession({});
      expect(getSessionPermissionMode(session.id)).toBeNull();
    });

    test("returns permissionMode from session state", () => {
      const session = storeCreateSession({});
      updateSessionState(session.id, { permissionMode: "plan" });
      expect(getSessionPermissionMode(session.id)).toBe("plan");
    });
  });

  describe("setSessionPermissionMode", () => {
    test("creates session state with permissionMode when none exists", () => {
      const session = storeCreateSession({});
      const mode = setSessionPermissionMode(session.id, "acceptEdits");
      expect(mode).toBe("acceptEdits");
      const state = getSessionState(session.id);
      expect(state?.permissionMode).toBe("acceptEdits");
    });

    test("updates permissionMode in existing session state", () => {
      const session = storeCreateSession({});
      setSessionPermissionMode(session.id, "default");
      const updated = setSessionPermissionMode(session.id, "clipboard");
      expect(updated).toBe("clipboard");
    });

    test("can set permissionMode to null", () => {
      const session = storeCreateSession({});
      setSessionPermissionMode(session.id, "plan");
      const cleared = setSessionPermissionMode(session.id, null);
      expect(cleared).toBeNull();
    });
  });
});