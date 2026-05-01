import { db } from "../db";

db.exec(`
  ALTER TABLE sessions ADD COLUMN workspace_id TEXT
    REFERENCES workspaces(id) ON DELETE SET NULL;

  CREATE INDEX IF NOT EXISTS idx_sessions_workspace_id ON sessions(workspace_id);
`);