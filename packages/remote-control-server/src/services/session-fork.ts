import { exists } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";

import { log } from "../logger";
import {
  storeGetSession,
  storeGetWorkspaceBySession,
  storeGetSessionState,
  storeUpsertWorkspace,
  storeUpsertSessionState,
  storeUpdateSession,
  storeCreateSession,
  type MaterializationStrategy,
} from "../store";
import { materializeWorkspace } from "./materialize";
import { clonePersistedSessionEvents } from "./transport";

export interface ForkOptions {
  newSessionTitle?: string;
  forkWorkspace?: boolean;
  strategy?: MaterializationStrategy;
}

export interface ForkWorkspaceResult {
  success: boolean;
  newWorkspacePath: string;
  branch: string | null;
  error?: string;
}

export async function forkSessionWorkspace(
  sourceSessionId: string,
  targetSessionId: string,
): Promise<ForkWorkspaceResult> {
  log(`[session-fork] forking workspace from session=${sourceSessionId} to session=${targetSessionId}`);

  const sourceWorkspace = storeGetWorkspaceBySession(sourceSessionId);
  if (!sourceWorkspace) {
    return {
      success: false,
      newWorkspacePath: "",
      branch: null,
      error: "Source workspace not found",
    };
  }

  if (!sourceWorkspace.materializationStrategy) {
    return {
      success: false,
      newWorkspacePath: "",
      branch: null,
      error: "Source workspace has no materialization strategy",
    };
  }

  const strategy = sourceWorkspace.materializationStrategy;
  const sourcePath = sourceWorkspace.workspacePath;
  const sourceRoot = sourceWorkspace.sourceRoot;

  const newWorkspacePath = await deriveForkPath(sourcePath, targetSessionId);

  await mkdir(resolve(newWorkspacePath, ".."), { recursive: true });

  log(`[session-fork] forking with strategy=${strategy} from=${sourcePath} to=${newWorkspacePath}`);

  if (strategy === "git_worktree") {
    const repoRoot = sourceWorkspace.repoRoot ?? sourceRoot;
    if (!(await exists(repoRoot))) {
      return {
        success: false,
        newWorkspacePath,
        branch: null,
        error: `Repo root does not exist: ${repoRoot}`,
      };
    }

    const branch = sourceWorkspace.branch
      ? `${sourceWorkspace.branch}-fork-${targetSessionId.slice(-8)}`
      : `fork-${randomUUID().replace(/-/g, "").slice(0, 8)}`;

    const materializeResult = await materializeWorkspace({
      sourceRoot: sourceRoot,
      workspacePath: newWorkspacePath,
      materializationStrategy: "git_worktree",
      branch,
      baseRef: sourceWorkspace.baseRef,
      repoRoot,
    });

    if (!materializeResult.success) {
      return {
        success: false,
        newWorkspacePath,
        branch: null,
        error: materializeResult.error ?? "Git worktree fork failed",
      };
    }

    return {
      success: true,
      newWorkspacePath,
      branch,
    };
  } else if (strategy === "copy") {
    if (!(await exists(sourcePath))) {
      return {
        success: false,
        newWorkspacePath,
        branch: null,
        error: `Source path does not exist: ${sourcePath}`,
      };
    }

    const { cp } = await import("node:fs/promises");
    await cp(sourcePath, newWorkspacePath, { recursive: true });
    return {
      success: true,
      newWorkspacePath,
      branch: sourceWorkspace.branch,
    };
  } else if (strategy === "temp_clone") {
    if (!(await exists(sourceRoot))) {
      return {
        success: false,
        newWorkspacePath,
        branch: null,
        error: `Source root does not exist: ${sourceRoot}`,
      };
    }

    const materializeResult = await materializeWorkspace({
      sourceRoot,
      workspacePath: newWorkspacePath,
      materializationStrategy: "temp_clone",
      branch: sourceWorkspace.branch,
      baseRef: sourceWorkspace.baseRef,
    });

    if (!materializeResult.success) {
      return {
        success: false,
        newWorkspacePath,
        branch: null,
        error: materializeResult.error ?? "Temp clone fork failed",
      };
    }

    return {
      success: true,
      newWorkspacePath,
      branch: sourceWorkspace.branch,
    };
  }

  log(`[session-fork] workspace forked successfully to ${newWorkspacePath}`);
  return {
    success: true,
    newWorkspacePath,
    branch: sourceWorkspace.branch,
  };
}

async function deriveForkPath(originalPath: string, newSessionId: string): Promise<string> {
  const parsed = parse(originalPath);
  const dirname = parsed.dir;
  const basename = parsed.name;
  const ext = parsed.ext;
  const forkSuffix = `fork-${newSessionId.slice(-8)}`;
  return join(dirname, `${basename}${ext}-${forkSuffix}`);
}

function parse(path: string): { dir: string; name: string; ext: string } {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const base = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const lastDot = base.indexOf(".");
  if (lastDot <= 0) {
    return { dir: path.slice(0, lastSlash >= 0 ? lastSlash : 0), name: base, ext: "" };
  }
  return {
    dir: path.slice(0, lastSlash >= 0 ? lastSlash : 0),
    name: base.slice(0, lastDot),
    ext: base.slice(lastDot),
  };
}

export async function forkSession(
  sessionId: string,
  options: ForkOptions = {},
): Promise<{ success: boolean; newSessionId?: string; error?: string }> {
  log(`[session-fork] forking session=${sessionId} options=${JSON.stringify(options)}`);

  const sourceSession = storeGetSession(sessionId);
  if (!sourceSession) {
    return { success: false, error: "Source session not found" };
  }

  const newSession = storeCreateSession({
    environmentId: sourceSession.environmentId,
    title: options.newSessionTitle ?? `Fork of ${sourceSession.title ?? sessionId}`,
    source: sourceSession.source,
    permissionMode: sourceSession.permissionMode,
    username: sourceSession.username,
  });

  log(`[session-fork] created new session=${newSession.id}`);

  const sourceWorkspace = storeGetWorkspaceBySession(sessionId);
  if (sourceWorkspace && options.forkWorkspace !== false) {
    const forkStrategy = options.strategy ?? sourceWorkspace.materializationStrategy ?? "copy";

    let newWorkspacePath = "";
    let forkSuccess = false;
    let forkedBranchName = sourceWorkspace.branch;

    if (forkStrategy) {
      const forkResult = await forkSessionWorkspace(sessionId, newSession.id);
      if (forkResult.success) {
        newWorkspacePath = forkResult.newWorkspacePath;
        forkSuccess = true;
        forkedBranchName = forkResult.branch ?? sourceWorkspace.branch;
      } else {
        log(`[session-fork] workspace fork failed: ${forkResult.error}, creating workspace record anyway`);
        newWorkspacePath = `${sourceWorkspace.workspacePath}-fork-${newSession.id.slice(-8)}`;
      }
    }

    storeUpsertWorkspace(newSession.id, {
      environmentId: sourceWorkspace.environmentId,
      sourceRoot: sourceWorkspace.sourceRoot,
      repoRoot: sourceWorkspace.repoRoot,
      baseRef: sourceWorkspace.baseRef,
      branch: forkedBranchName,
      strategy: sourceWorkspace.strategy,
      workspacePath: newWorkspacePath || `${sourceWorkspace.workspacePath}-fork-${newSession.id.slice(-8)}`,
      cleanupPolicy: sourceWorkspace.cleanupPolicy,
      lifecyclePolicy: sourceWorkspace.lifecyclePolicy,
      materializationStrategy: forkStrategy,
      parentWorkspaceId: forkSuccess ? sourceWorkspace.id : null,
    });

    log(`[session-fork] workspace forked to ${newWorkspacePath}`);
  }

  const sourceSessionState = storeGetSessionState(sessionId);
  if (sourceSessionState) {
    storeUpsertSessionState(newSession.id, {
      model: sourceSessionState.model,
      permissionMode: sourceSessionState.permissionMode,
      thinkingEffort: sourceSessionState.thinkingEffort,
      selectedRepos: [...sourceSessionState.selectedRepos],
      commandProfile: sourceSessionState.commandProfile,
    });
    log(`[session-fork] session state copied`);
  }

  const copiedEvents = clonePersistedSessionEvents(sessionId, newSession.id);
  log(`[session-fork] cloned ${copiedEvents} persisted events`);

  storeUpdateSession(newSession.id, { status: "idle" });

  log(`[session-fork] session forked successfully to ${newSession.id}`);

  return { success: true, newSessionId: newSession.id };
}
