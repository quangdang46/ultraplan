import { Database } from "bun:sqlite";
import { join } from "node:path";
import { log } from "./logger";

const DB_PATH = process.env.DATABASE_URL || join(process.cwd(), "rcs.sqlite");

export let db: Database;

export function initDb() {
  if (db) {
    return db;
  }

  log(`[DB] Initializing database at ${DB_PATH}`);
  db = new Database(DB_PATH, { create: true });

  // Enable WAL mode for better concurrency
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tokens (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (username) REFERENCES users(username)
    );

    CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY,
      secret TEXT NOT NULL,
      machine_name TEXT,
      directory TEXT,
      branch TEXT,
      git_repo_url TEXT,
      max_sessions INTEGER DEFAULT 1,
      worker_type TEXT DEFAULT 'claude_code',
      bridge_id TEXT,
      capabilities TEXT, -- JSON
      status TEXT DEFAULT 'active',
      username TEXT,
      last_poll_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      environment_id TEXT,
      title TEXT,
      status TEXT DEFAULT 'idle',
      source TEXT DEFAULT 'remote-control',
      permission_mode TEXT,
      worker_epoch INTEGER DEFAULT 0,
      username TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (environment_id) REFERENCES environments(id)
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      environment_id TEXT,
      source_root TEXT NOT NULL,
      repo_root TEXT,
      base_ref TEXT,
      branch TEXT,
      strategy TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      cleanup_policy TEXT NOT NULL DEFAULT 'keep',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS session_state (
      session_id TEXT PRIMARY KEY,
      model TEXT,
      permission_mode TEXT,
      thinking_effort TEXT,
      selected_repos TEXT,
      command_profile TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session_owners (
      session_id TEXT NOT NULL,
      owner_uuid TEXT NOT NULL,
      PRIMARY KEY (session_id, owner_uuid),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session_workers (
      session_id TEXT PRIMARY KEY,
      worker_status TEXT,
      external_metadata TEXT,
      requires_action_details TEXT,
      last_heartbeat_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS work_items (
      id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      state TEXT NOT NULL,
      secret TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL, -- JSON
      direction TEXT NOT NULL, -- 'inbound' | 'outbound'
      seq_num INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, seq_num);
    CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
    CREATE INDEX IF NOT EXISTS idx_session_owners_uuid ON session_owners(owner_uuid);
    CREATE INDEX IF NOT EXISTS idx_environments_worker_type ON environments(worker_type);
    CREATE INDEX IF NOT EXISTS idx_workspaces_environment_id ON workspaces(environment_id);
    CREATE INDEX IF NOT EXISTS idx_workspaces_source_root ON workspaces(source_root);
    CREATE INDEX IF NOT EXISTS idx_workspaces_workspace_path ON workspaces(workspace_path);

    CREATE TABLE IF NOT EXISTS pending_permissions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pending_permissions_session ON pending_permissions(session_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_permissions_session_request ON pending_permissions(session_id, request_id);
  `);

  return db;
}

initDb();
