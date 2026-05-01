import { log } from "../logger";
import { db } from "../db";
import { storeGetWorkspace } from "../store";

export interface WorkspaceRepoMembership {
  workspaceId: string;
  repoRoot: string;
  addedAt: Date;
}

function assertWorkspaceExists(workspaceId: string): void {
  if (!storeGetWorkspace(workspaceId)) {
    throw new Error(`[workspace-repo-membership] workspace ${workspaceId} does not exist`);
  }
}

export function addRepoToWorkspace(workspaceId: string, repoRoot: string): boolean {
  log(`[workspace-repo-membership] addRepoToWorkspace workspaceId=${workspaceId} repoRoot=${repoRoot}`);
  assertWorkspaceExists(workspaceId);

  const result = db.prepare(`
    INSERT OR IGNORE INTO workspace_repo_membership (workspace_id, repo_root)
    VALUES (?, ?)
  `).run(workspaceId, repoRoot);

  const added = result.changes > 0;
  log(`[workspace-repo-membership] addRepoToWorkspace workspaceId=${workspaceId} repoRoot=${repoRoot} added=${added}`);
  return added;
}

export function removeRepoFromWorkspace(workspaceId: string, repoRoot: string): boolean {
  log(`[workspace-repo-membership] removeRepoFromWorkspace workspaceId=${workspaceId} repoRoot=${repoRoot}`);

  const result = db.prepare(`
    DELETE FROM workspace_repo_membership WHERE workspace_id = ? AND repo_root = ?
  `).run(workspaceId, repoRoot);

  const removed = result.changes > 0;
  log(`[workspace-repo-membership] removeRepoFromWorkspace workspaceId=${workspaceId} repoRoot=${repoRoot} removed=${removed}`);
  return removed;
}

export function listReposForWorkspace(workspaceId: string): WorkspaceRepoMembership[] {
  log(`[workspace-repo-membership] listReposForWorkspace workspaceId=${workspaceId}`);

  const rows = db.prepare(`
    SELECT workspace_id, repo_root, added_at
    FROM workspace_repo_membership
    WHERE workspace_id = ?
    ORDER BY added_at ASC
  `).all(workspaceId) as Record<string, unknown>[];

  const repos = rows.map((row) => ({
    workspaceId: row.workspace_id as string,
    repoRoot: row.repo_root as string,
    addedAt: new Date(row.added_at as string),
  }));

  log(`[workspace-repo-membership] listReposForWorkspace workspaceId=${workspaceId} count=${repos.length}`);
  return repos;
}

export function getWorkspaceByRepo(repoRoot: string): string | null {
  log(`[workspace-repo-membership] getWorkspaceByRepo repoRoot=${repoRoot}`);

  const row = db.prepare(`
    SELECT workspace_id FROM workspace_repo_membership WHERE repo_root = ? LIMIT 1
  `).get(repoRoot) as Record<string, unknown> | null;

  const workspaceId = (row?.workspace_id as string) ?? null;
  log(`[workspace-repo-membership] getWorkspaceByRepo repoRoot=${repoRoot} workspaceId=${workspaceId ?? "none"}`);
  return workspaceId;
}

export function repoBelongsToWorkspace(workspaceId: string, repoRoot: string): boolean {
  log(`[workspace-repo-membership] repoBelongsToWorkspace workspaceId=${workspaceId} repoRoot=${repoRoot}`);

  const row = db.prepare(`
    SELECT 1 FROM workspace_repo_membership WHERE workspace_id = ? AND repo_root = ? LIMIT 1
  `).get(workspaceId, repoRoot) as Record<string, unknown> | null;

  const belongs = row !== null;
  log(`[workspace-repo-membership] repoBelongsToWorkspace workspaceId=${workspaceId} repoRoot=${repoRoot} belongs=${belongs}`);
  return belongs;
}