import { spawnSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { gitExe } from "../../../../src/utils/git.js";
import { resolveManagedSessionPaths } from "../config";
import { log } from "../logger";
import {
  storeGetSession,
  storeGetWorkspaceBySession,
  storeUpsertWorkspace,
  type MaterializationStrategy,
  type WorkspaceCleanupPolicy,
  type WorkspaceRecord,
  type WorkspaceStrategy,
} from "../store";
import { materializeWorkspace } from "./materialize";
import { addRepoToWorkspace } from "./workspace-repo-membership";

type GitContext = {
  repoRoot: string | null;
  branch: string | null;
  headRef: string | null;
};

export interface EnsureSessionWorkspaceOptions {
  cwd?: string | null;
  defaultCwd?: string;
  forceIsolation?: boolean;
}

export interface EnsureSessionWorkspaceResult {
  workspace: WorkspaceRecord;
  effectiveCwd: string;
  materialized: boolean;
}

function resolveManagedPaths(
  sessionId: string,
  materializationStrategy: "worktree" | "workdir",
) {
  return resolveManagedSessionPaths(sessionId, materializationStrategy, {
    workspaceRoot: process.env.RCS_WORKSPACE_ROOT || "",
  });
}

function runGit(args: string[], cwd: string): string | null {
  const result = spawnSync(gitExe(), args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
    },
  });

  if (result.status !== 0) {
    return null;
  }

  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  return stdout.length > 0 ? stdout : null;
}

async function resolveSourceRoot(
  cwd: string | null | undefined,
  defaultCwd = process.cwd(),
): Promise<string> {
  const candidate = resolve(cwd?.trim() || defaultCwd);
  try {
    return await realpath(candidate);
  } catch {
    return candidate;
  }
}

function detectGitContext(sourceRoot: string): GitContext {
  const repoRoot = runGit(["rev-parse", "--show-toplevel"], sourceRoot);
  if (!repoRoot) {
    return { repoRoot: null, branch: null, headRef: null };
  }

  const rawBranch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], sourceRoot);
  const branch = rawBranch && rawBranch !== "HEAD" ? rawBranch : null;
  const headRef = runGit(["rev-parse", "HEAD"], sourceRoot);

  return { repoRoot, branch, headRef };
}

function sanitizeBranchSegment(value: string): string {
  const sanitized = value
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/.]+|[-/.]+$/g, "");
  return sanitized.length > 0 ? sanitized : "session";
}

function deriveManagedBranchName(sessionId: string, branch: string | null): string {
  const suffix = sessionId.replace(/^.*_/, "").slice(-8) || sessionId.slice(-8);
  const base = sanitizeBranchSegment(branch ?? "session");
  return `${base}-rcs-${suffix}`;
}

async function materializeManagedWorkspace(input: {
  sourceRoot: string;
  repoRoot: string | null;
  workspacePath: string;
  materializationStrategy: MaterializationStrategy;
  branch: string | null;
  baseRef: string | null;
}): Promise<void> {
  const result = await materializeWorkspace({
    sourceRoot: input.sourceRoot,
    workspacePath: input.workspacePath,
    materializationStrategy: input.materializationStrategy,
    branch: input.branch,
    baseRef: input.baseRef,
    repoRoot: input.repoRoot ?? undefined,
  });

  if (!result.success) {
    throw new Error(result.error ?? "Failed to materialize workspace");
  }
}

async function provisionIsolatedWorkspace(
  sessionId: string,
  sourceRoot: string,
): Promise<{
  sourceRoot: string;
  repoRoot: string | null;
  branch: string | null;
  baseRef: string | null;
  strategy: WorkspaceStrategy;
  materializationStrategy: MaterializationStrategy;
  workspacePath: string;
  cleanupPolicy: WorkspaceCleanupPolicy;
  materialized: boolean;
}> {
  const git = detectGitContext(sourceRoot);

  if (git.repoRoot) {
    const managedBranch = deriveManagedBranchName(sessionId, git.branch);
    const paths = resolveManagedPaths(sessionId, "worktree");

    try {
      await materializeManagedWorkspace({
        sourceRoot: git.repoRoot,
        repoRoot: git.repoRoot,
        workspacePath: paths.workspacePath,
        materializationStrategy: "git_worktree",
        branch: managedBranch,
        baseRef: git.headRef,
      });

      return {
        sourceRoot: git.repoRoot,
        repoRoot: git.repoRoot,
        branch: managedBranch,
        baseRef: git.headRef,
        strategy: "worktree",
        materializationStrategy: "git_worktree",
        workspacePath: paths.workspacePath,
        cleanupPolicy: "delete-on-close",
        materialized: true,
      };
    } catch (error) {
      log(
        `[session-workspace] git worktree provisioning failed for session=${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }; falling back to copy`,
      );

      const fallbackPaths = resolveManagedPaths(sessionId, "workdir");
      await materializeManagedWorkspace({
        sourceRoot: git.repoRoot,
        repoRoot: git.repoRoot,
        workspacePath: fallbackPaths.workspacePath,
        materializationStrategy: "copy",
        branch: git.branch,
        baseRef: git.headRef,
      });

      return {
        sourceRoot: git.repoRoot,
        repoRoot: git.repoRoot,
        branch: git.branch,
        baseRef: git.headRef,
        strategy: "copy",
        materializationStrategy: "copy",
        workspacePath: fallbackPaths.workspacePath,
        cleanupPolicy: "delete-on-close",
        materialized: true,
      };
    }
  }

  const paths = resolveManagedPaths(sessionId, "workdir");
  await materializeManagedWorkspace({
    sourceRoot,
    repoRoot: null,
    workspacePath: paths.workspacePath,
    materializationStrategy: "copy",
    branch: null,
    baseRef: null,
  });

  return {
    sourceRoot,
    repoRoot: null,
    branch: null,
    baseRef: null,
    strategy: "copy",
    materializationStrategy: "copy",
    workspacePath: paths.workspacePath,
    cleanupPolicy: "delete-on-close",
    materialized: true,
  };
}

export async function ensureSessionWorkspace(
  sessionId: string,
  options: EnsureSessionWorkspaceOptions = {},
): Promise<EnsureSessionWorkspaceResult> {
  const session = storeGetSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const sourceRoot = await resolveSourceRoot(options.cwd, options.defaultCwd);
  const existing = storeGetWorkspaceBySession(sessionId);

  if (
    existing &&
    existing.strategy !== "same-dir" &&
    existing.workspacePath.length > 0 &&
    !options.forceIsolation
  ) {
    return {
      workspace: existing,
      effectiveCwd: existing.workspacePath,
      materialized: false,
    };
  }

  const provisioned = await provisionIsolatedWorkspace(sessionId, sourceRoot);

  const workspace = storeUpsertWorkspace(sessionId, {
    environmentId: session.environmentId,
    sourceRoot: provisioned.sourceRoot,
    repoRoot: provisioned.repoRoot,
    baseRef: provisioned.baseRef,
    branch: provisioned.branch,
    strategy: provisioned.strategy,
    workspacePath: provisioned.workspacePath,
    cleanupPolicy: provisioned.cleanupPolicy,
    lifecyclePolicy: "delete_on_close",
    materializationStrategy: provisioned.materializationStrategy,
  });

  if (workspace.repoRoot) {
    addRepoToWorkspace(workspace.id, workspace.repoRoot);
  }

  log(
    `[session-workspace] ensured workspace session=${sessionId} strategy=${workspace.strategy} workspacePath=${workspace.workspacePath} sourceRoot=${workspace.sourceRoot}`,
  );

  return {
    workspace,
    effectiveCwd: workspace.workspacePath || sourceRoot,
    materialized: provisioned.materialized,
  };
}
