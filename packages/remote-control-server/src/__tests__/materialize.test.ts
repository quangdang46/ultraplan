import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  materializeWorkspace,
  dematerializeWorkspace,
  toStoreMaterializationStrategy,
  fromStoreMaterializationStrategy,
} from "../services/materialize";

describe("materializeWorkspace", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "rcs-materialize-test-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  describe("git_worktree strategy", () => {
    test("creates a git worktree at the specified path", async () => {
      const repoRoot = join(tempRoot, "repo");
      const workspacePath = join(tempRoot, "worktrees", "test-workspace");

      await Bun.$`mkdir -p ${repoRoot}`.quiet();
      await Bun.$`cd ${repoRoot} && git init`.quiet();
      await Bun.$`cd ${repoRoot} && git config user.email test@test.com`.quiet();
      await Bun.$`cd ${repoRoot} && git config user.name Test`.quiet();
      await Bun.$`cd ${repoRoot} && touch README.md && git add . && git commit -m init`.quiet();

      const result = await materializeWorkspace({
        sourceRoot: repoRoot,
        workspacePath,
        materializationStrategy: "git_worktree",
        repoRoot,
      });

      expect(result.success).toBe(true);
      expect(result.workspacePath).toBe(workspacePath);
      expect(result.materializationStrategy).toBe("git_worktree");

      const gitFile = await readFile(join(workspacePath, ".git"), "utf-8");
      expect(gitFile.trim()).toStartWith("gitdir:");
    });

    test("returns success if worktree already exists", async () => {
      const repoRoot = join(tempRoot, "repo");
      const workspacePath = join(tempRoot, "worktrees", "test-workspace");

      await Bun.$`mkdir -p ${repoRoot}`.quiet();
      await Bun.$`cd ${repoRoot} && git init`.quiet();
      await Bun.$`cd ${repoRoot} && git config user.email test@test.com`.quiet();
      await Bun.$`cd ${repoRoot} && git config user.name Test`.quiet();
      await Bun.$`cd ${repoRoot} && touch README.md && git add . && git commit -m init`.quiet();

      await materializeWorkspace({
        sourceRoot: repoRoot,
        workspacePath,
        materializationStrategy: "git_worktree",
        repoRoot,
      });

      const result = await materializeWorkspace({
        sourceRoot: repoRoot,
        workspacePath,
        materializationStrategy: "git_worktree",
        repoRoot,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("copy strategy", () => {
    test("copies source to destination", async () => {
      const sourceRoot = join(tempRoot, "source");
      const workspacePath = join(tempRoot, "copied-workspace");

      await Bun.$`mkdir -p ${sourceRoot}/src`.quiet();
      await Bun.$`echo hello > ${sourceRoot}/src/index.ts`.quiet();
      await Bun.$`echo world > ${sourceRoot}/README.md`.quiet();

      const result = await materializeWorkspace({
        sourceRoot,
        workspacePath,
        materializationStrategy: "copy",
      });

      expect(result.success).toBe(true);
      expect(result.workspacePath).toBe(workspacePath);
      expect(result.materializationStrategy).toBe("copy");

      const indexContent = await readFile(join(workspacePath, "src/index.ts"), "utf-8");
      expect(indexContent.trim()).toBe("hello");
    });

    test("returns error if source does not exist", async () => {
      const workspacePath = join(tempRoot, "should-not-exist");

      const result = await materializeWorkspace({
        sourceRoot: join(tempRoot, "nonexistent"),
        workspacePath,
        materializationStrategy: "copy",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("does not exist");
    });

    test("returns success if destination already exists", async () => {
      const sourceRoot = join(tempRoot, "source");
      const workspacePath = join(tempRoot, "already-exists");

      await Bun.$`mkdir -p ${sourceRoot}`.quiet();
      await Bun.$`mkdir -p ${workspacePath}`.quiet();

      const result = await materializeWorkspace({
        sourceRoot,
        workspacePath,
        materializationStrategy: "copy",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("temp_clone strategy", () => {
    test("clones repo to destination", async () => {
      const repoRoot = join(tempRoot, "repo");
      const workspacePath = join(tempRoot, "cloned-workspace");

      await Bun.$`mkdir -p ${repoRoot}`.quiet();
      await Bun.$`cd ${repoRoot} && git init`.quiet();
      await Bun.$`cd ${repoRoot} && git config user.email test@test.com`.quiet();
      await Bun.$`cd ${repoRoot} && git config user.name Test`.quiet();
      await Bun.$`cd ${repoRoot} && touch README.md && git add . && git commit -m init`.quiet();

      const result = await materializeWorkspace({
        sourceRoot: repoRoot,
        workspacePath,
        materializationStrategy: "temp_clone",
      });

      expect(result.success).toBe(true);
      expect(result.workspacePath).toBe(workspacePath);
      expect(result.materializationStrategy).toBe("temp_clone");

      const gitDir = await stat(join(workspacePath, ".git"));
      expect(gitDir.isDirectory()).toBe(true);
    });

    test("returns error on git clone failure", async () => {
      const workspacePath = join(tempRoot, "should-fail");

      const result = await materializeWorkspace({
        sourceRoot: join(tempRoot, "nonexistent-repo"),
        workspacePath,
        materializationStrategy: "temp_clone",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("failed");
    });
  });
});

describe("dematerializeWorkspace", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "rcs-dematerialize-test-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  describe("git_worktree strategy", () => {
    test("removes worktree and directory", async () => {
      const repoRoot = join(tempRoot, "repo");
      const workspacePath = join(tempRoot, "worktrees", "test-workspace");

      await Bun.$`mkdir -p ${repoRoot}`.quiet();
      await Bun.$`cd ${repoRoot} && git init`.quiet();
      await Bun.$`cd ${repoRoot} && git config user.email test@test.com`.quiet();
      await Bun.$`cd ${repoRoot} && git config user.name Test`.quiet();
      await Bun.$`cd ${repoRoot} && touch README.md && git add . && git commit -m init`.quiet();

      await materializeWorkspace({
        sourceRoot: repoRoot,
        workspacePath,
        materializationStrategy: "git_worktree",
        repoRoot,
      });

      const result = await dematerializeWorkspace(workspacePath, "git_worktree", repoRoot);

      expect(result.success).toBe(true);
      await expect(stat(workspacePath)).rejects.toThrow();
    });

    test("removes directory even if git worktree remove fails", async () => {
      const repoRoot = join(tempRoot, "repo");
      const workspacePath = join(tempRoot, "worktrees", "test-workspace");

      await Bun.$`mkdir -p ${repoRoot}`.quiet();
      await Bun.$`cd ${repoRoot} && git init`.quiet();
      await Bun.$`cd ${repoRoot} && git config user.email test@test.com`.quiet();
      await Bun.$`cd ${repoRoot} && git config user.name Test`.quiet();
      await Bun.$`cd ${repoRoot} && touch README.md && git add . && git commit -m init`.quiet();

      await materializeWorkspace({
        sourceRoot: repoRoot,
        workspacePath,
        materializationStrategy: "git_worktree",
        repoRoot,
      });

      const result = await dematerializeWorkspace(workspacePath, "git_worktree", join(tempRoot, "wrong-repo"));

      expect(result.success).toBe(true);
      await expect(stat(workspacePath)).rejects.toThrow();
    });

    test("returns error if repoRoot not provided", async () => {
      const workspacePath = join(tempRoot, "some-path");

      const result = await dematerializeWorkspace(workspacePath, "git_worktree", undefined);

      expect(result.success).toBe(false);
      expect(result.error).toContain("repoRoot required");
    });
  });

  describe("copy strategy", () => {
    test("removes copied directory", async () => {
      const workspacePath = join(tempRoot, "copied");

      await Bun.$`mkdir -p ${workspacePath}`.quiet();
      await Bun.$`echo content > ${workspacePath}/file.txt`.quiet();

      const result = await dematerializeWorkspace(workspacePath, "copy");

      expect(result.success).toBe(true);
      await expect(stat(workspacePath)).rejects.toThrow();
    });
  });

  describe("temp_clone strategy", () => {
    test("removes cloned directory", async () => {
      const repoRoot = join(tempRoot, "repo");
      const workspacePath = join(tempRoot, "cloned");

      await Bun.$`mkdir -p ${repoRoot}`.quiet();
      await Bun.$`cd ${repoRoot} && git init`.quiet();
      await Bun.$`cd ${repoRoot} && git config user.email test@test.com`.quiet();
      await Bun.$`cd ${repoRoot} && git config user.name Test`.quiet();
      await Bun.$`cd ${repoRoot} && touch README.md && git add . && git commit -m init`.quiet();

      await materializeWorkspace({
        sourceRoot: repoRoot,
        workspacePath,
        materializationStrategy: "temp_clone",
      });

      const result = await dematerializeWorkspace(workspacePath, "temp_clone");

      expect(result.success).toBe(true);
      await expect(stat(workspacePath)).rejects.toThrow();
    });
  });
});

describe("toStoreMaterializationStrategy", () => {
  test("converts worktree to git_worktree", () => {
    expect(toStoreMaterializationStrategy("worktree")).toBe("git_worktree");
  });

  test("converts workdir to copy", () => {
    expect(toStoreMaterializationStrategy("workdir")).toBe("copy");
  });
});

describe("fromStoreMaterializationStrategy", () => {
  test("converts git_worktree to worktree", () => {
    expect(fromStoreMaterializationStrategy("git_worktree")).toBe("worktree");
  });

  test("converts copy to workdir", () => {
    expect(fromStoreMaterializationStrategy("copy")).toBe("workdir");
  });

  test("returns null for temp_clone (no path-layer equivalent)", () => {
    expect(fromStoreMaterializationStrategy("temp_clone")).toBeNull();
  });
});
