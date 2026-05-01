/**
 * Workspace repository accessors
 *
 * Provides high-level repository-pattern access to workspace entities
 * with proper null returns for not-found cases.
 */
import { log } from "../logger";
import {
  storeGetWorkspace,
  storeGetWorkspaceBySession,
  storeUpsertWorkspace,
  storeGetEnvironment,
  storeListActiveEnvironments,
  type WorkspaceRecord,
  type EnvironmentRecord,
} from "../store";
import { db } from "../db";

export type { WorkspaceRecord, EnvironmentRecord };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function looksLikeUUID(v: unknown): boolean {
  return typeof v === "string" && v.length === 36 && v.includes("-");
}

// ---------- Workspace environment ----------

/**
 * Get the environment record for a workspace.
 * Returns null if workspace doesn't exist or has no environment_id.
 */
export function getWorkspaceEnvironment(workspaceId: string): EnvironmentRecord | null {
  if (!isNonEmptyString(workspaceId)) {
    log(`[workspace-repo] getWorkspaceEnvironment: invalid workspaceId`);
    return null;
  }
  log(`[workspace-repo] getWorkspaceEnvironment workspaceId=${workspaceId}`);
  const workspace = storeGetWorkspace(workspaceId);
  if (!workspace || !workspace.environmentId) {
    return null;
  }
  const env = storeGetEnvironment(workspace.environmentId);
  return env ?? null;
}

// ---------- Workspace provisioning ----------

/**
 * Get or provision a workspace for a session.
 *
 * - If an existing workspace is found with a materialized path (non-empty workspacePath),
 *   it is returned immediately (no duplicate provisioning).
 * - Otherwise, a new workspace is created using the provided envId or
 *   the session's environment_id.
 *
 * A workspace is considered "materialized" when it has a non-empty workspacePath
 * and a concrete strategy.
 */
export function getOrCreateWorkspaceForSession(
  sessionId: string,
  envId?: string | null,
): WorkspaceRecord {
  if (!isNonEmptyString(sessionId)) {
    log(`[workspace-repo] getOrCreateWorkspaceForSession: invalid sessionId`);
    throw new Error(`Invalid sessionId: must be a non-empty string`);
  }
  log(`[workspace-repo] getOrCreateWorkspaceForSession sessionId=${sessionId} envId=${envId ?? "undefined"}`);

  const existing = storeGetWorkspaceBySession(sessionId);
  if (existing && existing.workspacePath && existing.workspacePath.length > 0) {
    log(`[workspace-repo] existing materialized workspace id=${existing.id}`);
    return existing;
  }

  // Provision a new workspace using the provided envId or fall back to session's env
  const workspaceEnvId = envId ?? existing?.environmentId ?? null;

  const created = storeUpsertWorkspace(sessionId, {
    environmentId: workspaceEnvId,
    sourceRoot: existing?.sourceRoot ?? "",
    repoRoot: existing?.repoRoot ?? null,
    baseRef: existing?.baseRef ?? null,
    branch: existing?.branch ?? null,
    strategy: existing?.strategy ?? "same-dir",
    workspacePath: existing?.workspacePath ?? "",
    cleanupPolicy: existing?.cleanupPolicy ?? "keep",
  });

  log(`[workspace-repo] provisioned workspace id=${created.id} for sessionId=${sessionId}`);
  return created;
}

// ---------- Workspace listing ----------

/**
 * List all workspaces for a given environment.
 * Returns an empty array if the environment doesn't exist or has no workspaces.
 */
export function listWorkspacesForEnvironment(environmentId: string): WorkspaceRecord[] {
  if (!isNonEmptyString(environmentId)) {
    log(`[workspace-repo] listWorkspacesForEnvironment: invalid environmentId`);
    return [];
  }
  log(`[workspace-repo] listWorkspacesForEnvironment environmentId=${environmentId}`);
  // Use direct SQL for efficiency — workspace has environment_id FK index
  const rows = db
    .prepare("SELECT * FROM workspaces WHERE environment_id = ? ORDER BY created_at ASC")
    .all(environmentId) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as string,
    sessionId: row.session_id as string,
    environmentId: (row.environment_id as string | null) ?? null,
    sourceRoot: row.source_root as string,
    repoRoot: (row.repo_root as string | null) ?? null,
    baseRef: (row.base_ref as string | null) ?? null,
    branch: (row.branch as string | null) ?? null,
    strategy: row.strategy as WorkspaceRecord["strategy"],
    workspacePath: row.workspace_path as string,
    cleanupPolicy: row.cleanup_policy as WorkspaceRecord["cleanupPolicy"],
    lifecyclePolicy: (row.lifecycle_policy as WorkspaceRecord["lifecyclePolicy"] | null) ?? null,
    materializationStrategy:
      (row.materialization_strategy as WorkspaceRecord["materializationStrategy"] | null) ?? null,
    parentWorkspaceId: (row.parent_workspace_id as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }));
}

// ---------- Workspace path resolution ----------

/**
 * Get the resolved absolute workspace path for a workspace.
 * Returns null if workspace doesn't exist or has no workspace_path set.
 */
export function resolveWorkspacePath(workspaceId: string): string | null {
  if (!isNonEmptyString(workspaceId)) {
    log(`[workspace-repo] resolveWorkspacePath: invalid workspaceId`);
    return null;
  }
  log(`[workspace-repo] resolveWorkspacePath workspaceId=${workspaceId}`);
  const workspace = storeGetWorkspace(workspaceId);
  if (!workspace || !workspace.workspacePath) {
    return null;
  }
  return workspace.workspacePath;
}

// ---------- Workspace materialization check ----------

/**
 * Check if a workspace has been materialized.
 *
 * A workspace is considered materialized when:
 * - It has a non-empty workspacePath, AND
 * - It has a non-default strategy (not "same-dir" with empty path)
 *
 * Returns false for non-existent workspaces.
 */
export function workspaceHasMaterialization(workspaceId: string): boolean {
  if (!isNonEmptyString(workspaceId)) {
    log(`[workspace-repo] workspaceHasMaterialization: invalid workspaceId`);
    return false;
  }
  log(`[workspace-repo] workspaceHasMaterialization workspaceId=${workspaceId}`);
  const workspace = storeGetWorkspace(workspaceId);
  if (!workspace) {
    return false;
  }

  const hasPath = workspace.workspacePath?.length > 0;
  if (!hasPath) {
    return false;
  }

  // Materialized if either non-same-dir strategy OR has path (same-dir with path is ok)
  return workspace.strategy !== "same-dir" || hasPath;
}