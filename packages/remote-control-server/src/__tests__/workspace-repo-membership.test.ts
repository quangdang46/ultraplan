import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { initDb, runMigrations } from "../db";
import { storeReset, storeCreateSession, storeCreateEnvironment } from "../store";
import {
  addRepoToWorkspace,
  removeRepoFromWorkspace,
  listReposForWorkspace,
  getWorkspaceByRepo,
  repoBelongsToWorkspace,
} from "../services/workspace-repo-membership";
import { getOrCreateWorkspaceForSession } from "../services/workspace-repo";

describe("workspace-repo-membership", () => {
  beforeAll(async () => {
    initDb();
    await runMigrations();
  });

  beforeEach(() => {
    storeReset();
  });

  describe("addRepoToWorkspace", () => {
    test("adds a repo to workspace membership", () => {
      const env = storeCreateEnvironment({ secret: "env-1" });
      const session = storeCreateSession({ environmentId: env.id });
      const workspace = getOrCreateWorkspaceForSession(session.id, env.id);

      const added = addRepoToWorkspace(workspace.id, "/repo/one");
      expect(added).toBe(true);
    });

    test("is idempotent on duplicate add", () => {
      const env = storeCreateEnvironment({ secret: "env-2" });
      const session = storeCreateSession({ environmentId: env.id });
      const workspace = getOrCreateWorkspaceForSession(session.id, env.id);

      const first = addRepoToWorkspace(workspace.id, "/repo/dup");
      const second = addRepoToWorkspace(workspace.id, "/repo/dup");
      expect(first).toBe(true);
      expect(second).toBe(false);
    });

    test("throws for non-existent workspace", () => {
      expect(() => addRepoToWorkspace("nonexistent-ws", "/repo/test")).toThrow();
    });
  });

  describe("removeRepoFromWorkspace", () => {
    test("removes an existing repo from workspace", () => {
      const env = storeCreateEnvironment({ secret: "env-3" });
      const session = storeCreateSession({ environmentId: env.id });
      const workspace = getOrCreateWorkspaceForSession(session.id, env.id);

      addRepoToWorkspace(workspace.id, "/repo/remove-me");
      const removed = removeRepoFromWorkspace(workspace.id, "/repo/remove-me");
      expect(removed).toBe(true);
    });

    test("is no-op for repo not in workspace", () => {
      const env = storeCreateEnvironment({ secret: "env-4" });
      const session = storeCreateSession({ environmentId: env.id });
      const workspace = getOrCreateWorkspaceForSession(session.id, env.id);

      const result = removeRepoFromWorkspace(workspace.id, "/repo/never-existed");
      expect(result).toBe(false);
    });
  });

  describe("listReposForWorkspace", () => {
    test("returns empty array for workspace with no repos", () => {
      const env = storeCreateEnvironment({ secret: "env-5" });
      const session = storeCreateSession({ environmentId: env.id });
      const workspace = getOrCreateWorkspaceForSession(session.id, env.id);

      const repos = listReposForWorkspace(workspace.id);
      expect(repos).toHaveLength(0);
    });

    test("returns all repos for workspace in added order", () => {
      const env = storeCreateEnvironment({ secret: "env-6" });
      const session = storeCreateSession({ environmentId: env.id });
      const workspace = getOrCreateWorkspaceForSession(session.id, env.id);

      addRepoToWorkspace(workspace.id, "/repo/a");
      addRepoToWorkspace(workspace.id, "/repo/b");
      addRepoToWorkspace(workspace.id, "/repo/c");

      const repos = listReposForWorkspace(workspace.id);
      expect(repos).toHaveLength(3);
      expect(repos[0].repoRoot).toBe("/repo/a");
      expect(repos[1].repoRoot).toBe("/repo/b");
      expect(repos[2].repoRoot).toBe("/repo/c");
    });

    test("returns empty array for non-existent workspace", () => {
      const repos = listReposForWorkspace("nonexistent-ws");
      expect(repos).toHaveLength(0);
    });
  });

  describe("getWorkspaceByRepo", () => {
    test("returns workspace id for repo that belongs to a workspace", () => {
      const env = storeCreateEnvironment({ secret: "env-7" });
      const session = storeCreateSession({ environmentId: env.id });
      const workspace = getOrCreateWorkspaceForSession(session.id, env.id);

      addRepoToWorkspace(workspace.id, "/repo/find-me");
      const found = getWorkspaceByRepo("/repo/find-me");
      expect(found).toBe(workspace.id);
    });

    test("returns null for repo not in any workspace", () => {
      const result = getWorkspaceByRepo("/repo/never-registered");
      expect(result).toBeNull();
    });
  });

  describe("repoBelongsToWorkspace", () => {
    test("returns true when repo belongs to workspace", () => {
      const env = storeCreateEnvironment({ secret: "env-8" });
      const session = storeCreateSession({ environmentId: env.id });
      const workspace = getOrCreateWorkspaceForSession(session.id, env.id);

      addRepoToWorkspace(workspace.id, "/repo/belongs");
      const belongs = repoBelongsToWorkspace(workspace.id, "/repo/belongs");
      expect(belongs).toBe(true);
    });

    test("returns false when repo does not belong to workspace", () => {
      const env = storeCreateEnvironment({ secret: "env-9" });
      const session = storeCreateSession({ environmentId: env.id });
      const workspace = getOrCreateWorkspaceForSession(session.id, env.id);

      const belongs = repoBelongsToWorkspace(workspace.id, "/repo/not-a-member");
      expect(belongs).toBe(false);
    });

    test("returns false when workspace does not exist", () => {
      const belongs = repoBelongsToWorkspace("nonexistent-ws", "/repo/any");
      expect(belongs).toBe(false);
    });
  });
});