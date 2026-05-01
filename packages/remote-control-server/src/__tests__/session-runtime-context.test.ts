import { beforeEach, describe, expect, test } from "bun:test";
import {
  storeBindSession,
  storeCreateEnvironment,
  storeCreateSession,
  storeIsSessionOwner,
  storeReset,
  storeUpdateSession,
  storeUpsertSessionWorker,
} from "../store";
import {
  getSessionSelectedRepos,
  getSessionRuntimeState,
  getSessionWorkspace,
  resolveOwnedWebSessionRuntimeContext,
  setSessionSelectedRepos,
  upsertSessionRuntimeState,
  upsertSessionWorkspace,
} from "../services/session-runtime-context";
import { toWebSessionId } from "../services/session";

describe("session runtime context", () => {
  beforeEach(() => {
    storeReset();
  });

  test("upserts workspace against an existing session and inherits environment id", () => {
    const env = storeCreateEnvironment({ secret: "env-secret" });
    const session = storeCreateSession({ environmentId: env.id });

    const workspace = upsertSessionWorkspace(session.id, {
      sourceRoot: "/repo",
      repoRoot: "/repo",
      strategy: "worktree",
      workspacePath: "/repo/.workspace/worktrees/session-1",
    });

    expect(workspace.sessionId).toBe(session.id);
    expect(workspace.environmentId).toBe(env.id);
    expect(getSessionWorkspace(session.id)?.workspacePath).toBe(
      "/repo/.workspace/worktrees/session-1",
    );
  });

  test("normalizes repo membership and seeds permission mode from the session", () => {
    const session = storeCreateSession({ permissionMode: "acceptEdits" });

    const state = upsertSessionRuntimeState(session.id, {
      model: "claude-opus-4-5",
      selectedRepos: [" repo-a ", "repo-a", "", "repo-b"],
    });

    expect(state.permissionMode).toBe("acceptEdits");
    expect(state.selectedRepos).toEqual(["repo-a", "repo-b"]);

    const updated = setSessionSelectedRepos(session.id, ["repo-c", "repo-c", "repo-d"]);
    expect(updated.selectedRepos).toEqual(["repo-c", "repo-d"]);
    expect(getSessionSelectedRepos(session.id)).toEqual(["repo-c", "repo-d"]);
    expect(getSessionRuntimeState(session.id)?.model).toBe("claude-opus-4-5");
  });

  test("resolves owned runtime context with workspace, state, worker, and automation state", () => {
    const session = storeCreateSession({
      idPrefix: "cse_",
      permissionMode: "default",
    });
    storeBindSession(session.id, "user-1");

    upsertSessionWorkspace(session.id, {
      sourceRoot: "/repo",
      repoRoot: "/repo",
      strategy: "worktree",
      workspacePath: "/repo/.workspace/worktrees/cse-1",
    });
    upsertSessionRuntimeState(session.id, {
      selectedRepos: ["repo-a", "repo-b"],
      commandProfile: "safe-shell",
    });
    storeUpsertSessionWorker(session.id, {
      externalMetadata: {
        automation_state: {
          enabled: true,
          phase: "standby",
          next_tick_at: 42,
          sleep_until: null,
        },
      },
    });

    const resolved = resolveOwnedWebSessionRuntimeContext(
      toWebSessionId(session.id),
      "user-1",
      { allowClosed: true },
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      throw new Error("Expected runtime context");
    }

    expect(resolved.context.sessionId).toBe(session.id);
    expect(resolved.context.webSessionId).toBe(toWebSessionId(session.id));
    expect(resolved.context.workspace?.sourceRoot).toBe("/repo");
    expect(resolved.context.selectedRepos).toEqual(["repo-a", "repo-b"]);
    expect(resolved.context.effectivePermissionMode).toBe("default");
    expect(resolved.context.automationState).toEqual({
      enabled: true,
      phase: "standby",
      next_tick_at: 42,
      sleep_until: null,
    });
  });

  test("auto-binds orphaned sessions during owned resolution", () => {
    const session = storeCreateSession({});

    const resolved = resolveOwnedWebSessionRuntimeContext(session.id, "user-1", {
      allowClosed: true,
    });

    expect(resolved.ok).toBe(true);
    expect(storeIsSessionOwner(session.id, "user-1")).toBe(true);
  });

  test("returns a session_closed error unless closed sessions are explicitly allowed", () => {
    const session = storeCreateSession({});
    storeBindSession(session.id, "user-1");
    storeUpdateSession(session.id, { status: "archived" });

    const blocked = resolveOwnedWebSessionRuntimeContext(session.id, "user-1");
    expect(blocked).toEqual({
      ok: false,
      error: {
        status: 409,
        type: "session_closed",
        message: "Session is archived",
      },
    });

    const allowed = resolveOwnedWebSessionRuntimeContext(session.id, "user-1", {
      allowClosed: true,
    });
    expect(allowed.ok).toBe(true);
  });

  test("can require workspace and session state explicitly", () => {
    const session = storeCreateSession({});
    storeBindSession(session.id, "user-1");

    const missingWorkspace = resolveOwnedWebSessionRuntimeContext(
      session.id,
      "user-1",
      { allowClosed: true, requireWorkspace: true },
    );
    expect(missingWorkspace).toEqual({
      ok: false,
      error: {
        status: 409,
        type: "missing_workspace",
        message: "Session workspace is not initialized",
      },
    });

    upsertSessionWorkspace(session.id, {
      sourceRoot: "/repo",
      strategy: "same-dir",
      workspacePath: "/repo",
    });

    const missingState = resolveOwnedWebSessionRuntimeContext(
      session.id,
      "user-1",
      { allowClosed: true, requireWorkspace: true, requireSessionState: true },
    );
    expect(missingState).toEqual({
      ok: false,
      error: {
        status: 409,
        type: "missing_state",
        message: "Session state is not initialized",
      },
    });
  });
});
