import { ensureColumn, ensureIndex } from "./utils";

export function runSessionWorkspaceBindingMigration(): void {
  ensureColumn(
    "sessions",
    "workspace_id",
    `
      ALTER TABLE sessions ADD COLUMN workspace_id TEXT
      REFERENCES workspaces(id) ON DELETE SET NULL
    `,
  );
  ensureIndex(
    "idx_sessions_workspace_id",
    "CREATE INDEX IF NOT EXISTS idx_sessions_workspace_id ON sessions(workspace_id)",
  );
}
