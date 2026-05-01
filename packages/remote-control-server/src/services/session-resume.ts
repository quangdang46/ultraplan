import { exists } from "node:fs/promises";

import { log } from "../logger";
import {
  storeGetSession,
  storeGetWorkspaceBySession,
  storeGetSessionState,
  storeUpdateSession,
  type SessionRecord,
  type WorkspaceRecord,
  type SessionStateRecord,
} from "../store";
import { materializeWorkspace, type MaterializeResult } from "./materialize";

export interface ResumeContext {
  session: SessionRecord;
  workspace: WorkspaceRecord;
  sessionState: SessionStateRecord | null;
  workspacePath: string;
  materializationNeeded: boolean;
  materializationStrategy: "git_worktree" | "copy" | "temp_clone";
  sourceRoot: string;
  repoRoot: string | null;
  branch: string | null;
}

export interface ResumeResult {
  success: boolean;
  sessionId: string;
  workspacePath?: string;
  resumed: boolean;
  error?: string;
}

export async function getResumeContext(
  sessionId: string,
): Promise<ResumeContext | null> {
  log(`[session-resume] getting resume context for session=${sessionId}`);

  const session = storeGetSession(sessionId);
  if (!session) {
    log(`[session-resume] session not found: ${sessionId}`);
    return null;
  }

  const workspace = storeGetWorkspaceBySession(sessionId);
  if (!workspace) {
    log(`[session-resume] workspace not found for session=${sessionId}`);
    return null;
  }

  const sessionState = storeGetSessionState(sessionId) ?? null;

  let materializationNeeded = false;
  let materializationStrategy: "git_worktree" | "copy" | "temp_clone" = "copy";

  if (workspace.materializationStrategy) {
    materializationStrategy = workspace.materializationStrategy;
    if (workspace.workspacePath) {
      const pathExists = await exists(workspace.workspacePath).catch(() => false);
      materializationNeeded = !pathExists;
    } else {
      materializationNeeded = true;
    }
  } else if (!workspace.materializationStrategy) {
    materializationNeeded = true;
    materializationStrategy = "copy";
  }

  log(
    `[session-resume] resume context: session=${sessionId} workspace=${workspace.id} ` +
      `path=${workspace.workspacePath} materializationNeeded=${materializationNeeded} ` +
      `strategy=${materializationStrategy}`,
  );

  return {
    session,
    workspace,
    sessionState,
    workspacePath: workspace.workspacePath,
    materializationNeeded,
    materializationStrategy,
    sourceRoot: workspace.sourceRoot,
    repoRoot: workspace.repoRoot,
    branch: workspace.branch,
  };
}

export async function resumeSession(
  sessionId: string,
  options: { forceRematerialize?: boolean } = {},
): Promise<ResumeResult> {
  log(`[session-resume] resuming session=${sessionId} forceRematerialize=${options.forceRematerialize ?? false}`);

  const context = await getResumeContext(sessionId);
  if (!context) {
    return {
      success: false,
      sessionId,
      resumed: false,
      error: "Session not found",
    };
  }

  const { session, workspace, workspacePath, materializationNeeded, materializationStrategy, sourceRoot, repoRoot, branch } = context;

  storeUpdateSession(sessionId, { status: "running" });

  let materializeResult: MaterializeResult | null = null;
  if (materializationNeeded || options.forceRematerialize) {
    if (!sourceRoot) {
      return {
        success: false,
        sessionId,
        resumed: false,
        error: "Source root is required for materialization",
      };
    }

    log(
      `[session-resume] materializing workspace: strategy=${materializationStrategy} ` +
        `source=${sourceRoot} dest=${workspacePath}`,
    );

    materializeResult = await materializeWorkspace({
      sourceRoot,
      workspacePath,
      materializationStrategy,
      branch: branch ?? null,
      baseRef: workspace.baseRef,
      repoRoot: repoRoot ?? undefined,
    });

    if (!materializeResult.success) {
      log(`[session-resume] materialization failed: ${materializeResult.error}`);
      storeUpdateSession(sessionId, { status: "idle" });
      return {
        success: false,
        sessionId,
        resumed: false,
        error: materializeResult.error ?? "Materialization failed",
      };
    }

    log(`[session-resume] workspace materialized successfully`);
  } else {
    log(`[session-resume] workspace already exists, skipping materialization`);
  }

  log(`[session-resume] session resumed successfully`);

  return {
    success: true,
    sessionId,
    workspacePath,
    resumed: materializationNeeded || options.forceRematerialize === true,
  };
}

export function isSessionResumable(sessionId: string): boolean {
  const session = storeGetSession(sessionId);
  if (!session) {
    return false;
  }

  if (session.status === "archived" || session.status === "inactive") {
    return false;
  }

  const workspace = storeGetWorkspaceBySession(sessionId);
  if (!workspace) {
    return false;
  }

  return true;
}