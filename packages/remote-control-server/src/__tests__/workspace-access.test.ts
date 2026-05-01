import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { initDb } from "../db";
import { storeReset, storeCreateSession } from "../store";
import {
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  archiveWorkspace,
  getWorkspacePath,
  getSessionState,
  upsertSessionState,
  addRepoToWorkspace,
  getPrimaryRepo,
  listWorkspaceRepos,
  type WorkspaceCreateOpts,
} from "../services/workspace-access";

describe("workspace-access", () => {
  beforeAll(() => {
    initDb();
  });

  beforeEach(() => {
    storeReset();
  });

  async function createWorkspaceForTest(sessionId: string, workspacePath: string): Promise<string> {
    const created = storeCreateSession({ idPrefix: sessionId });
    const ws = await createWorkspace(created.id, {
      sourceRoot: "/src/root",
      strategy: "worktree",
      workspacePath,
    });
    return ws.id;
  }

  describe("getWorkspace", () => {
    test("returns null when no workspace exists", async () => {
      const result = await getWorkspace("nonexistent-session");
      expect(result).toBeNull();
    });
  });

  describe("createWorkspace", () => {
    test("creates a workspace and returns it", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-abc" });
      const opts: WorkspaceCreateOpts = {
        sourceRoot: "/src/root",
        strategy: "worktree",
        workspacePath: "/workspace/123",
      };
      const ws = await createWorkspace(id, opts);
      expect(ws.sessionId).toBe(id);
      expect(ws.sourceRoot).toBe("/src/root");
      expect(ws.workspacePath).toBe("/workspace/123");
      expect(ws.strategy).toBe("worktree");
      expect(ws.cleanupPolicy).toBe("keep");
    });

    test("creates workspace with all optional fields", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-def" });
      const opts: WorkspaceCreateOpts = {
        sourceRoot: "/src/root",
        strategy: "copy",
        workspacePath: "/workspace/456",
        repoRoot: "/repo/root",
        baseRef: "main",
        branch: "feature-x",
        cleanupPolicy: "delete-on-close",
        lifecyclePolicy: "delete_on_close",
        materializationStrategy: "copy",
        parentWorkspaceId: "parent-ws",
      };
      const ws = await createWorkspace(id, opts);
      expect(ws.environmentId).toBeNull(); // env-1 does not exist in test DB
      expect(ws.repoRoot).toBe("/repo/root");
      expect(ws.baseRef).toBe("main");
      expect(ws.branch).toBe("feature-x");
      expect(ws.lifecyclePolicy).toBe("delete_on_close");
      expect(ws.materializationStrategy).toBe("copy");
      expect(ws.parentWorkspaceId).toBe("parent-ws");
    });
  });

  describe("getWorkspace (after create)", () => {
    test("returns the created workspace", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-xyz" });
      const opts: WorkspaceCreateOpts = {
        sourceRoot: "/src/root",
        strategy: "worktree",
        workspacePath: "/workspace/789",
      };
      await createWorkspace(id, opts);
      const ws = await getWorkspace(id);
      expect(ws).not.toBeNull();
      expect(ws!.workspacePath).toBe("/workspace/789");
    });
  });

  describe("updateWorkspace", () => {
    test("updates workspace fields", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-upd" });
      const created = await createWorkspace(id, {
        sourceRoot: "/src/root",
        strategy: "worktree",
        workspacePath: "/workspace/upd",
      });
      const updated = await updateWorkspace(created.id, {
        branch: "new-branch",
        workspacePath: "/workspace/new-path",
      });
      expect(updated.branch).toBe("new-branch");
      expect(updated.workspacePath).toBe("/workspace/new-path");
    });

    test("throws when workspace not found", async () => {
      await expect(updateWorkspace("nonexistent-id", { branch: "x" })).rejects.toThrow(
        "Workspace not found",
      );
    });
  });

  describe("archiveWorkspace", () => {
    test("sets lifecycle_policy to delete_on_close", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-arch" });
      const created = await createWorkspace(id, {
        sourceRoot: "/src/root",
        strategy: "worktree",
        workspacePath: "/workspace/arch",
      });
      await archiveWorkspace(created.id);
      const ws = await getWorkspace(id);
      expect(ws!.lifecyclePolicy).toBe("delete_on_close");
    });

    test("throws when workspace not found", async () => {
      await expect(archiveWorkspace("nonexistent-id")).rejects.toThrow("Workspace not found");
    });
  });

  describe("getWorkspacePath", () => {
    test("returns null when no workspace exists", async () => {
      const result = await getWorkspacePath("nonexistent");
      expect(result).toBeNull();
    });

    test("returns workspace path after creation", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-path" });
      await createWorkspace(id, {
        sourceRoot: "/src/root",
        strategy: "worktree",
        workspacePath: "/workspace/path-test",
      });
      const path = await getWorkspacePath(id);
      expect(path).toBe("/workspace/path-test");
    });
  });

  describe("getSessionState", () => {
    test("returns null when no session state exists", async () => {
      const result = await getSessionState("nonexistent-session");
      expect(result).toBeNull();
    });
  });

  describe("upsertSessionState", () => {
    test("creates session state with provided fields", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-st" });
      const state = await upsertSessionState(id, {
        model: "claude-sonnet",
        permissionMode: "clipboard",
        thinkingEffort: "high",
        selectedRepos: ["/repo/a", "/repo/b"],
        commandProfile: "default",
      });
      expect(state.sessionId).toBe(id);
      expect(state.model).toBe("claude-sonnet");
      expect(state.permissionMode).toBe("clipboard");
      expect(state.thinkingEffort).toBe("high");
      expect(state.selectedRepos).toEqual(["/repo/a", "/repo/b"]);
      expect(state.commandProfile).toBe("default");
    });

    test("updates only specified fields", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-upd-st" });
      await upsertSessionState(id, { model: "claude-opus" });
      const updated = await upsertSessionState(id, { permissionMode: "all" });
      expect(updated.model).toBe("claude-opus");
      expect(updated.permissionMode).toBe("all");
    });
  });

  describe("addRepoToWorkspace", () => {
    test("adds repo to workspace membership", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-repo" });
      const ws = await createWorkspace(id, {
        sourceRoot: "/src/root",
        strategy: "worktree",
        workspacePath: "/workspace/repo-test",
      });
      await addRepoToWorkspace(ws.id, "/repo/added");
      const repos = await listWorkspaceRepos(ws.id);
      expect(repos).toHaveLength(1);
      expect(repos[0].repoRoot).toBe("/repo/added");
    });

test("does not duplicate existing repo", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-repo-dup" });
      const ws = await createWorkspace(id, {
        sourceRoot: "/src/root",
        strategy: "worktree",
        workspacePath: "/workspace/repo-dup",
      });
      await addRepoToWorkspace(ws.id, "/repo/dup");
      await addRepoToWorkspace(ws.id, "/repo/dup");
      const repos = await listWorkspaceRepos(ws.id);
      expect(repos).toHaveLength(1);
    });
  });

  describe("getPrimaryRepo", () => {
    test("returns null when no repos exist", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-no-repo" });
      const ws = await createWorkspace(id, {
        sourceRoot: "/src/root",
        strategy: "worktree",
        workspacePath: "/workspace/no-repo",
      });
      const result = await getPrimaryRepo(ws.id);
      expect(result).toBeNull();
    });

    test("returns first added repo as primary", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-primary" });
      const ws = await createWorkspace(id, {
        sourceRoot: "/src/root",
        strategy: "worktree",
        workspacePath: "/workspace/primary-test",
      });
      await addRepoToWorkspace(ws.id, "/repo/first");
      await addRepoToWorkspace(ws.id, "/repo/second");
      const primary = await getPrimaryRepo(ws.id);
      expect(primary).toBe("/repo/first");
    });
  });

  describe("listWorkspaceRepos", () => {
    test("returns empty list when no repos exist", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-empty-repos" });
      const ws = await createWorkspace(id, {
        sourceRoot: "/src/root",
        strategy: "worktree",
        workspacePath: "/workspace/empty-repos",
      });
      const repos = await listWorkspaceRepos(ws.id);
      expect(repos).toHaveLength(0);
    });

    test("returns all repos ordered by added_at", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-list-repos" });
      const ws = await createWorkspace(id, {
        sourceRoot: "/src/root",
        strategy: "worktree",
        workspacePath: "/workspace/list-repos",
      });
      await addRepoToWorkspace(ws.id, "/repo/a");
      await addRepoToWorkspace(ws.id, "/repo/b");
      await addRepoToWorkspace(ws.id, "/repo/c");
      const repos = await listWorkspaceRepos(ws.id);
      expect(repos).toHaveLength(3);
      expect(repos[0].repoRoot).toBe("/repo/a");
      expect(repos[1].repoRoot).toBe("/repo/b");
      expect(repos[2].repoRoot).toBe("/repo/c");
    });
  });

  describe("getPrimaryRepo", () => {
    test("returns null when no repos exist", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-no-repo" });
      const ws = await createWorkspace(id, {
        sourceRoot: "/src/root",
        strategy: "worktree",
        workspacePath: "/workspace/no-repo",
      });
      const result = await getPrimaryRepo(ws.id);
      expect(result).toBeNull();
    });

    test("returns first added repo as primary", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-primary" });
      const ws = await createWorkspace(id, {
        sourceRoot: "/src/root",
        strategy: "worktree",
        workspacePath: "/workspace/primary-test",
      });
      await addRepoToWorkspace(ws.id, "/repo/first");
      await addRepoToWorkspace(ws.id, "/repo/second");
      const primary = await getPrimaryRepo(ws.id);
      expect(primary).toBe("/repo/first");
    });
  });

  describe("listWorkspaceRepos", () => {
    test("returns empty list when no repos exist", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-empty-repos" });
      const ws = await createWorkspace(id, {
        sourceRoot: "/src/root",
        strategy: "worktree",
        workspacePath: "/workspace/empty-repos",
      });
      const repos = await listWorkspaceRepos(ws.id);
      expect(repos).toHaveLength(0);
    });

    test("returns all repos ordered by added_at", async () => {
      const { id } = storeCreateSession({ idPrefix: "session-list-repos" });
      const ws = await createWorkspace(id, {
        sourceRoot: "/src/root",
        strategy: "worktree",
        workspacePath: "/workspace/list-repos",
      });
      await addRepoToWorkspace(ws.id, "/repo/a");
      await addRepoToWorkspace(ws.id, "/repo/b");
      await addRepoToWorkspace(ws.id, "/repo/c");
      const repos = await listWorkspaceRepos(ws.id);
      expect(repos).toHaveLength(3);
      expect(repos[0].repoRoot).toBe("/repo/a");
      expect(repos[1].repoRoot).toBe("/repo/b");
      expect(repos[2].repoRoot).toBe("/repo/c");
    });
  });
});
