/**
 * Workspace Materialization Module
 *
 * Implements filesystem operations for workspace materialization strategies:
 * - git_worktree: git worktree add <path> <branch>
 * - copy: cp -r source to destination
 * - temp_clone: git clone --depth 1 to temporary location
 */

import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { execFileNoThrowWithCwd } from "../../../../src/utils/execFileNoThrow.js";
import { gitExe } from "../../../../src/utils/git.js";
import { log } from "../logger.js";

// Env vars to prevent git/SSH from prompting for credentials
const GIT_NO_PROMPT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
};

/**
 * Result of a materialization operation.
 */
export type MaterializeResult = {
  success: boolean;
  workspacePath: string;
  materializationStrategy: string;
  error?: string;
};

/**
 * Result of a dematerialization operation.
 */
export type DematerializeResult = {
  success: boolean;
  workspacePath: string;
  error?: string;
};

/**
 * Options for materializing a workspace.
 */
export type MaterializeOptions = {
  /** Source root path to materialize from */
  sourceRoot: string;
  /** Destination workspace path */
  workspacePath: string;
  /** Materialization strategy */
  materializationStrategy: "git_worktree" | "copy" | "temp_clone";
  /** Git branch (for git_worktree) */
  branch?: string | null;
  /** Git base ref (for git_worktree) */
  baseRef?: string | null;
  /** Repo root (for git_worktree, defaults to sourceRoot) */
  repoRoot?: string | null;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Materialize a workspace to disk based on the materialization strategy.
 *
 * @param opts - Materialization options
 * @returns MaterializeResult with success status and workspace path
 */
export async function materializeWorkspace(
  opts: MaterializeOptions,
): Promise<MaterializeResult> {
  const { workspacePath, materializationStrategy, sourceRoot } = opts;

  log(
    `[materialize] materializing workspace: strategy=${materializationStrategy} source=${sourceRoot} dest=${workspacePath}`,
  );

  try {
    // Ensure destination parent directory exists
    await mkdir(resolve(workspacePath, ".."), { recursive: true });

    switch (materializationStrategy) {
      case "git_worktree":
        return await materializeAsGitWorktree(opts);
      case "copy":
        return await materializeAsCopy(opts);
      case "temp_clone":
        return await materializeAsTempClone(opts);
      default:
        return {
          success: false,
          workspacePath,
          materializationStrategy,
          error: `Unknown materialization strategy: ${materializationStrategy}`,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`[materialize] materialization failed: ${message}`);
    return {
      success: false,
      workspacePath,
      materializationStrategy,
      error: message,
    };
  }
}

/**
 * Dematerialize (cleanup) a workspace from disk.
 *
 * @param workspacePath - Path to the workspace to remove
 * @param materializationStrategy - Strategy used when materializing
 * @param repoRoot - Repo root (for git_worktree cleanup)
 * @returns DematerializeResult with success status
 */
export async function dematerializeWorkspace(
  workspacePath: string,
  materializationStrategy: "git_worktree" | "copy" | "temp_clone",
  repoRoot?: string,
): Promise<DematerializeResult> {
  log(
    `[materialize] dematerializing workspace: strategy=${materializationStrategy} path=${workspacePath}`,
  );

  try {
    switch (materializationStrategy) {
      case "git_worktree":
        return await dematerializeGitWorktree(workspacePath, repoRoot);
      case "copy":
        return await dematerializeCopy(workspacePath);
      case "temp_clone":
        return await dematerializeTempClone(workspacePath);
      default:
        return {
          success: false,
          workspacePath,
          error: `Unknown materialization strategy: ${materializationStrategy}`,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`[materialize] dematerialization failed: ${message}`);
    return {
      success: false,
      workspacePath,
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// git_worktree materialization
// ---------------------------------------------------------------------------

async function materializeAsGitWorktree(
  opts: MaterializeOptions,
): Promise<MaterializeResult> {
  const { workspacePath, sourceRoot, branch, baseRef, repoRoot } = opts;
  const effectiveRepoRoot = repoRoot ?? sourceRoot;

  // Check if already materialized (fast path)
  if (await isGitWorktree(workspacePath)) {
    log(`[materialize] worktree already exists at ${workspacePath}`);
    return { success: true, workspacePath, materializationStrategy: "git_worktree" };
  }

  // Resolve branch name - use provided branch or generate one
  const worktreeBranch = branch ?? `worktree-${randomUUID().replace(/-/g, "").slice(0, 8)}`;

  // Determine base ref for the worktree
  let baseRefToUse: string;
  if (baseRef) {
    baseRefToUse = baseRef;
  } else if (branch) {
    // If we have a branch name, use origin/<branch> if it exists
    baseRefToUse = `origin/${branch}`;
  } else {
    // Fall back to HEAD
    baseRefToUse = "HEAD";
  }

  // Create parent directory if needed
  await mkdir(resolve(workspacePath, ".."), { recursive: true });

  // Run: git worktree add -B <branch> <path> <baseRef>
  const args = [
    "worktree",
    "add",
    "-B",
    worktreeBranch,
    workspacePath,
    baseRefToUse,
  ];

  log(`[materialize] running: git ${args.join(" ")}`);
  const result = await execFileNoThrowWithCwd(gitExe(), args, {
    cwd: effectiveRepoRoot,
    env: { ...process.env, ...GIT_NO_PROMPT_ENV },
    stdin: "ignore",
  });

  if (result.code !== 0) {
    return {
      success: false,
      workspacePath,
      materializationStrategy: "git_worktree",
      error: `git worktree add failed: ${result.stderr || result.error}`,
    };
  }

  log(`[materialize] created git worktree at ${workspacePath}`);
  return { success: true, workspacePath, materializationStrategy: "git_worktree" };
}

async function dematerializeGitWorktree(
  workspacePath: string,
  repoRoot?: string,
): Promise<DematerializeResult> {
  if (!repoRoot) {
    return {
      success: false,
      workspacePath,
      error: "repoRoot required for git_worktree dematerialization",
    };
  }

  // Check if it's actually a worktree
  if (!(await isGitWorktree(workspacePath))) {
    log(`[materialize] ${workspacePath} is not a git worktree, removing directory directly`);
    await rm(workspacePath, { recursive: true, force: true });
    return { success: true, workspacePath };
  }

  // Run: git worktree remove --force <path>
  const result = await execFileNoThrowWithCwd(
    gitExe(),
    ["worktree", "remove", "--force", workspacePath],
    { cwd: repoRoot, env: { ...process.env, ...GIT_NO_PROMPT_ENV }, stdin: "ignore" },
  );

  if (result.code !== 0) {
    // Fall back to removing the directory
    log(`[materialize] git worktree remove failed: ${result.stderr}, removing directory`);
    await rm(workspacePath, { recursive: true, force: true });
  }

  return { success: true, workspacePath };
}

/**
 * Check if a path is a valid git worktree by looking for the .git file
 * with a gitdir: pointer.
 */
async function isGitWorktree(path: string): Promise<boolean> {
  try {
    const gitFile = await import("node:fs/promises").then((m) =>
      m.readFile(join(path, ".git"), "utf-8"),
    );
    return gitFile.trim().startsWith("gitdir:");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// copy materialization
// ---------------------------------------------------------------------------

async function materializeAsCopy(opts: MaterializeOptions): Promise<MaterializeResult> {
  const { workspacePath, sourceRoot } = opts;

  // Check if source exists
  try {
    await stat(sourceRoot);
  } catch {
    return {
      success: false,
      workspacePath,
      materializationStrategy: "copy",
      error: `Source path does not exist: ${sourceRoot}`,
    };
  }

  // Check if destination already exists
  try {
    await stat(workspacePath);
    log(`[materialize] copy destination already exists at ${workspacePath}`);
    return { success: true, workspacePath, materializationStrategy: "copy" };
  } catch {
    // Destination doesn't exist, proceed with copy
  }

  // Run: cp -r <source> <dest>
  await cp(sourceRoot, workspacePath, { recursive: true });

  log(`[materialize] copied ${sourceRoot} to ${workspacePath}`);
  return { success: true, workspacePath, materializationStrategy: "copy" };
}

async function dematerializeCopy(workspacePath: string): Promise<DematerializeResult> {
  try {
    await rm(workspacePath, { recursive: true, force: true });
    log(`[materialize] removed copy at ${workspacePath}`);
    return { success: true, workspacePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, workspacePath, error: message };
  }
}

// ---------------------------------------------------------------------------
// temp_clone materialization
// ---------------------------------------------------------------------------

async function materializeAsTempClone(
  opts: MaterializeOptions,
): Promise<MaterializeResult> {
  const { workspacePath, sourceRoot, branch, baseRef } = opts;

  // Determine ref to clone
  const refToClone = branch ?? baseRef ?? "HEAD";

  // Clone with depth 1 (shallow clone)
  const args = [
    "clone",
    "--depth",
    "1",
  ];

  // Add ref flag if not cloning HEAD
  if (refToClone !== "HEAD") {
    args.push("--branch", refToClone);
  }

  // Add the source and destination
  args.push(sourceRoot, workspacePath);

  log(`[materialize] running: git ${args.join(" ")}`);
  const result = await execFileNoThrowWithCwd(gitExe(), args, {
    env: { ...process.env, ...GIT_NO_PROMPT_ENV },
    stdin: "ignore",
  });

  if (result.code !== 0) {
    return {
      success: false,
      workspacePath,
      materializationStrategy: "temp_clone",
      error: `git clone failed: ${result.stderr || result.error}`,
    };
  }

  log(`[materialize] created temp clone at ${workspacePath}`);
  return { success: true, workspacePath, materializationStrategy: "temp_clone" };
}

async function dematerializeTempClone(
  workspacePath: string,
): Promise<DematerializeResult> {
  try {
    await rm(workspacePath, { recursive: true, force: true });
    log(`[materialize] removed temp clone at ${workspacePath}`);
    return { success: true, workspacePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, workspacePath, error: message };
  }
}

// ---------------------------------------------------------------------------
// Type alignment helpers
// ---------------------------------------------------------------------------

/**
 * Convert from workspace-paths WorkspaceMaterializationStrategy to store MaterializationStrategy.
 *
 * workspace-paths uses: "worktree" | "workdir"
 * store uses: "git_worktree" | "copy" | "temp_clone"
 *
 * The mapping is:
 * - "worktree" -> "git_worktree"
 * - "workdir" -> "copy" (workdir is a full copy, same as copy strategy)
 */
export type WorkspaceMaterializationStrategy = "worktree" | "workdir";

export function toStoreMaterializationStrategy(
  strategy: WorkspaceMaterializationStrategy,
): "git_worktree" | "copy" {
  switch (strategy) {
    case "worktree":
      return "git_worktree";
    case "workdir":
      return "copy";
  }
}

export function fromStoreMaterializationStrategy(
  strategy: "git_worktree" | "copy" | "temp_clone",
): WorkspaceMaterializationStrategy | null {
  switch (strategy) {
    case "git_worktree":
      return "worktree";
    case "copy":
      return "workdir";
    case "temp_clone":
      // temp_clone has no equivalent in workspace-paths
      return null;
  }
}
