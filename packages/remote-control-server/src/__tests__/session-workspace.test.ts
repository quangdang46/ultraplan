import { describe, test, expect, beforeEach } from "bun:test";
import { initDb } from "../db";
import { storeReset, storeCreateSession, storeGetSession } from "../store";
import { getOrCreateWorkspaceForSession } from "../services/workspace-repo";

describe("bd-3fg.2.1.1: session-workspace binding", () => {
  beforeEach(() => {
    initDb();
    storeReset();
  });

  test("createSession with cwd materializes workspace path", () => {
    const session = storeCreateSession({
      title: "Test Session",
      source: "web",
      permissionMode: "default",
      username: "testuser",
      cwd: "/tmp/test-workspace",
    });

    const workspace = getOrCreateWorkspaceForSession(session.id);
    expect(workspace.workspacePath).toBe("/tmp/test-workspace");
    expect(workspace.strategy).toBe("materialized");
  });

  test("createSession without cwd leaves workspace path empty", () => {
    const session = storeCreateSession({
      title: "Test Session",
      source: "web",
      permissionMode: "default",
      username: "testuser",
    });

    const workspace = getOrCreateWorkspaceForSession(session.id);
    expect(workspace.workspacePath).toBe("");
    expect(workspace.strategy).toBe("same-dir");
  });

  test("workspace is bound to session via workspace_id FK", () => {
    const session = storeCreateSession({
      title: "Test Session",
      source: "web",
      permissionMode: "default",
      username: "testuser",
      cwd: "/tmp/test-workspace",
    });

    const record = storeGetSession(session.id);
    expect(record?.workspaceId).toBeDefined();
    expect(record?.workspaceId?.length).toBeGreaterThan(0);
  });

  test("session record has correct workspace_id after creation with cwd", () => {
    const session = storeCreateSession({
      title: "Test Session",
      source: "web",
      permissionMode: "default",
      username: "testuser",
      cwd: "/tmp/test-workspace",
    });

    const retrieved = storeGetSession(session.id);
    expect(retrieved?.workspaceId).toBeDefined();

    const workspace = getOrCreateWorkspaceForSession(session.id);
    expect(workspace.id).toBe(retrieved?.workspaceId);
  });
});
