import { log } from "../logger";
import {
  storeGetWorkspace,
  storeGetWorkspaceBySession,
  storeUpsertWorkspace,
  storeGetSessionState,
  storeUpsertSessionState,
  type WorkspaceRecord,
  type SessionStateRecord,
  type LifecyclePolicy,
  type MaterializationStrategy,
} from "../store";
import { db } from "../db";

export type { WorkspaceRecord, SessionStateRecord, LifecyclePolicy, MaterializationStrategy };

export interface WorkspaceCreateOpts {
  environmentId?: string | null;
  sourceRoot: string;
  repoRoot?: string | null;
  baseRef?: string | null;
  branch?: string | null;
  strategy: string;
  workspacePath: string;
  cleanupPolicy?: import("../store").WorkspaceCleanupPolicy;
  lifecyclePolicy?: LifecyclePolicy;
  materializationStrategy?: MaterializationStrategy;
  parentWorkspaceId?: string | null;
}

export type WorkspacePatch = Partial<Pick<WorkspaceRecord,
  | "environmentId"
  | "sourceRoot"
  | "repoRoot"
  | "baseRef"
  | "branch"
  | "strategy"
  | "workspacePath"
  | "cleanupPolicy"
  | "lifecyclePolicy"
  | "materializationStrategy"
  | "parentWorkspaceId"
>>;

export type SessionStatePatch = Partial<Pick<SessionStateRecord,
  | "model"
  | "permissionMode"
  | "thinkingEffort"
  | "selectedRepos"
  | "commandProfile"
>>;

export interface WorkspaceRepo {
  workspaceId: string;
  repoRoot: string;
  addedAt: Date;
}

// ---------- Core workspace accessors ----------

export async function getWorkspace(sessionId: string): Promise<WorkspaceRecord | null> {
  log(`[workspace-access] getWorkspace sessionId=${sessionId}`);
  return storeGetWorkspaceBySession(sessionId) ?? null;
}

export async function createWorkspace(sessionId: string, opts: WorkspaceCreateOpts): Promise<WorkspaceRecord> {
  log(`[workspace-access] createWorkspace sessionId=${sessionId} workspacePath=${opts.workspacePath}`);
  return storeUpsertWorkspace(sessionId, {
    environmentId: opts.environmentId ?? null,
    sourceRoot: opts.sourceRoot,
    repoRoot: opts.repoRoot ?? null,
    baseRef: opts.baseRef ?? null,
    branch: opts.branch ?? null,
    strategy: opts.strategy as import("../store").WorkspaceStrategy,
    workspacePath: opts.workspacePath,
    cleanupPolicy: opts.cleanupPolicy ?? "keep",
    lifecyclePolicy: opts.lifecyclePolicy ?? null,
    materializationStrategy: opts.materializationStrategy ?? null,
    parentWorkspaceId: opts.parentWorkspaceId ?? null,
  });
}

export async function updateWorkspace(workspaceId: string, patch: WorkspacePatch): Promise<WorkspaceRecord> {
  log(`[workspace-access] updateWorkspace workspaceId=${workspaceId}`);
  const existing = storeGetWorkspace(workspaceId);
  if (!existing) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }
  return storeUpsertWorkspace(existing.sessionId, patch as Parameters<typeof storeUpsertWorkspace>[1]);
}

export async function archiveWorkspace(workspaceId: string): Promise<void> {
  log(`[workspace-access] archiveWorkspace workspaceId=${workspaceId}`);
  const existing = storeGetWorkspace(workspaceId);
  if (!existing) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }
  storeUpsertWorkspace(existing.sessionId, { lifecyclePolicy: "delete_on_close" });
}

export async function getWorkspacePath(sessionId: string): Promise<string | null> {
  log(`[workspace-access] getWorkspacePath sessionId=${sessionId}`);
  const ws = storeGetWorkspaceBySession(sessionId);
  return ws?.workspacePath ?? null;
}

// ---------- Session state accessors ----------

export async function getSessionState(sessionId: string): Promise<SessionStateRecord | null> {
  log(`[workspace-access] getSessionState sessionId=${sessionId}`);
  return storeGetSessionState(sessionId) ?? null;
}

export async function upsertSessionState(
  sessionId: string,
  patch: SessionStatePatch,
): Promise<SessionStateRecord> {
  log(`[workspace-access] upsertSessionState sessionId=${sessionId}`);
  return storeUpsertSessionState(sessionId, {
    model: patch.model,
    permissionMode: patch.permissionMode,
    thinkingEffort: patch.thinkingEffort,
    selectedRepos: patch.selectedRepos,
    commandProfile: patch.commandProfile,
  });
}

// ---------- Repo membership accessors ----------

export async function addRepoToWorkspace(
  workspaceId: string,
  repoPath: string,
  isPrimary = false,
): Promise<void> {
  log(`[workspace-access] addRepoToWorkspace workspaceId=${workspaceId} repoPath=${repoPath} isPrimary=${isPrimary}`);

  if (isPrimary) {
    db.prepare(
      "UPDATE workspace_repo_membership SET repo_root = ? WHERE workspace_id = ?",
    ).run(repoPath, workspaceId);
  }

  db.prepare(`
    INSERT OR IGNORE INTO workspace_repo_membership (workspace_id, repo_root)
    VALUES (?, ?)
  `).run(workspaceId, repoPath);
}

export async function getPrimaryRepo(workspaceId: string): Promise<string | null> {
  log(`[workspace-access] getPrimaryRepo workspaceId=${workspaceId}`);
  const row = db.prepare(
    "SELECT repo_root FROM workspace_repo_membership WHERE workspace_id = ? LIMIT 1",
  ).get(workspaceId) as Record<string, unknown> | undefined;
  return (row?.repo_root as string | null) ?? null;
}

export async function listWorkspaceRepos(workspaceId: string): Promise<WorkspaceRepo[]> {
  log(`[workspace-access] listWorkspaceRepos workspaceId=${workspaceId}`);
  const rows = db.prepare(
    "SELECT workspace_id, repo_root, added_at FROM workspace_repo_membership WHERE workspace_id = ? ORDER BY added_at ASC",
  ).all(workspaceId) as Record<string, unknown>[];
  return rows.map((row) => ({
    workspaceId: row.workspace_id as string,
    repoRoot: row.repo_root as string,
    addedAt: new Date(row.added_at as string),
  }));
}
