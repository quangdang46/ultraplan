import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDb } from "../db";
import { ensureSessionWorkspace } from "../services/session-workspace";
import { storeCreateSession, storeGetWorkspaceBySession, storeReset } from "../store";

describe("session-workspace service", () => {
  let tempRoot: string;
  let previousWorkspaceRoot: string | undefined;

  beforeEach(async () => {
    initDb();
    storeReset();
    tempRoot = await mkdtemp(join(tmpdir(), "rcs-session-workspace-"));
    previousWorkspaceRoot = process.env.RCS_WORKSPACE_ROOT;
    process.env.RCS_WORKSPACE_ROOT = join(tempRoot, "managed-state");
  });

  afterEach(async () => {
    if (previousWorkspaceRoot === undefined) {
      delete process.env.RCS_WORKSPACE_ROOT;
    } else {
      process.env.RCS_WORKSPACE_ROOT = previousWorkspaceRoot;
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("materializes a git-backed session as a worktree by default", async () => {
    const repoRoot = join(tempRoot, "repo");
    await mkdir(repoRoot, { recursive: true });
    await Bun.$`cd ${repoRoot} && git init`.quiet();
    await Bun.$`cd ${repoRoot} && git config user.email test@test.com`.quiet();
    await Bun.$`cd ${repoRoot} && git config user.name Test`.quiet();
    await writeFile(join(repoRoot, "README.md"), "test content");
    await Bun.$`cd ${repoRoot} && git add . && git commit -m init`.quiet();

    const session = storeCreateSession({ cwd: repoRoot });
    const ensured = await ensureSessionWorkspace(session.id, {
      cwd: repoRoot,
      forceIsolation: true,
    });

    expect(ensured.workspace.strategy).toBe("worktree");
    expect(ensured.workspace.materializationStrategy).toBe("git_worktree");
    expect(ensured.workspace.repoRoot).toBe(repoRoot);
    expect(ensured.workspace.branch).toContain("-rcs-");

    const gitFile = await stat(join(ensured.workspace.workspacePath, ".git"));
    expect(gitFile.isFile() || gitFile.isDirectory()).toBe(true);
  });

  test("materializes a non-git session as an isolated copied workdir", async () => {
    const sourceRoot = join(tempRoot, "plain");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(join(sourceRoot, "notes.txt"), "hello");

    const session = storeCreateSession({ cwd: sourceRoot });
    const ensured = await ensureSessionWorkspace(session.id, {
      cwd: sourceRoot,
      forceIsolation: true,
    });

    expect(ensured.workspace.strategy).toBe("copy");
    expect(ensured.workspace.materializationStrategy).toBe("copy");
    expect(ensured.workspace.workspacePath).not.toBe(sourceRoot);
    expect(ensured.effectiveCwd).toBe(ensured.workspace.workspacePath);

    const copied = await Bun.file(join(ensured.workspace.workspacePath, "notes.txt")).text();
    expect(copied).toBe("hello");
  });

  test("reuses an existing managed workspace without rematerializing", async () => {
    const sourceRoot = join(tempRoot, "plain");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(join(sourceRoot, "notes.txt"), "hello");

    const session = storeCreateSession({ cwd: sourceRoot });
    const first = await ensureSessionWorkspace(session.id, {
      cwd: sourceRoot,
      forceIsolation: true,
    });
    const workspaceBefore = storeGetWorkspaceBySession(session.id);
    const second = await ensureSessionWorkspace(session.id, { cwd: sourceRoot });

    expect(second.materialized).toBe(false);
    expect(second.workspace.id).toBe(first.workspace.id);
    expect(second.workspace.workspacePath).toBe(first.workspace.workspacePath);
    expect(storeGetWorkspaceBySession(session.id)?.updatedAt.getTime()).toBe(
      workspaceBefore?.updatedAt.getTime(),
    );
  });
});
