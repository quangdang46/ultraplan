/**
 * Migration: bd-3fg.1.1.1 — Workspace lifecycle and materialization schema
 *
 * Adds columns for:
 * - events.after_seq          — SSE replay from cursor position
 * - workspaces.lifecycle_policy — extended cleanup policy enum
 * - workspaces.materialization_strategy — git_worktree | copy | temp_clone
 * - workspaces.parent_workspace_id     — fork semantics (sibling workspaces)
 * - workspace_repo_membership junction — multi-repo workspace support
 *
 * Forward-only — no destructive changes.
 */
import {
  ensureColumn,
  ensureIndex,
  ensureTable,
} from "./utils";

export function runWorkspaceLifecycleMigration(): void {
  ensureColumn(
    "events",
    "after_seq",
    "ALTER TABLE events ADD COLUMN after_seq INTEGER",
  );
  ensureColumn(
    "workspaces",
    "lifecycle_policy",
    "ALTER TABLE workspaces ADD COLUMN lifecycle_policy TEXT",
  );
  ensureColumn(
    "workspaces",
    "materialization_strategy",
    "ALTER TABLE workspaces ADD COLUMN materialization_strategy TEXT",
  );
  ensureColumn(
    "workspaces",
    "parent_workspace_id",
    "ALTER TABLE workspaces ADD COLUMN parent_workspace_id TEXT",
  );

  ensureIndex(
    "idx_workspaces_parent",
    "CREATE INDEX IF NOT EXISTS idx_workspaces_parent ON workspaces(parent_workspace_id)",
  );

  ensureTable(
    "workspace_repo_membership",
    `
      CREATE TABLE workspace_repo_membership (
        workspace_id TEXT NOT NULL,
        repo_root TEXT NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (workspace_id, repo_root),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      )
    `,
  );

  ensureIndex(
    "idx_wrm_workspace",
    "CREATE INDEX IF NOT EXISTS idx_wrm_workspace ON workspace_repo_membership(workspace_id)",
  );
  ensureIndex(
    "idx_wrm_repo_root",
    "CREATE INDEX IF NOT EXISTS idx_wrm_repo_root ON workspace_repo_membership(repo_root)",
  );
}
