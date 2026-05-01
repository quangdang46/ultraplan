import { randomUUID } from "node:crypto";
import { db } from "./db";

// ---------- Types ----------

export interface UserRecord {
  username: string;
  createdAt: Date;
}

export interface EnvironmentRecord {
  id: string;
  secret: string;
  machineName: string | null;
  directory: string | null;
  branch: string | null;
  gitRepoUrl: string | null;
  maxSessions: number;
  workerType: string;
  bridgeId: string | null;
  capabilities: Record<string, unknown> | null;
  status: string;
  username: string | null;
  lastPollAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRecord {
  id: string;
  environmentId: string | null;
  workspaceId: string | null;
  title: string | null;
  status: string;
  source: string;
  permissionMode: string | null;
  workerEpoch: number;
  username: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type WorkspaceStrategy = "worktree" | "copy" | "temp-clone" | "same-dir";

export type WorkspaceCleanupPolicy = "keep" | "delete-on-close" | "delete-if-clean";

export type LifecyclePolicy = "keep" | "delete_on_close" | "delete_if_clean";

export type MaterializationStrategy = "git_worktree" | "copy" | "temp_clone";

export interface WorkspaceRecord {
  id: string;
  sessionId: string;
  environmentId: string | null;
  sourceRoot: string;
  repoRoot: string | null;
  baseRef: string | null;
  branch: string | null;
  strategy: WorkspaceStrategy;
  workspacePath: string;
  cleanupPolicy: WorkspaceCleanupPolicy;
  lifecyclePolicy: LifecyclePolicy | null;
  materializationStrategy: MaterializationStrategy | null;
  parentWorkspaceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionStateRecord {
  sessionId: string;
  model: string | null;
  permissionMode: string | null;
  thinkingEffort: string | null;
  selectedRepos: string[];
  commandProfile: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkItemRecord {
  id: string;
  environmentId: string;
  sessionId: string;
  state: string;
  secret: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionWorkerRecord {
  sessionId: string;
  workerStatus: string | null;
  externalMetadata: Record<string, unknown> | null;
  requiresActionDetails: Record<string, unknown> | null;
  lastHeartbeatAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------- Row mappers ----------

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    username: row.username as string,
    createdAt: new Date(row.created_at as string),
  };
}

function rowToStringArray(value: unknown): string[] {
  if (!value) return [];
  const parsed = JSON.parse(value as string);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is string => typeof entry === "string");
}

function rowToEnvironment(row: Record<string, unknown>): EnvironmentRecord {
  return {
    id: row.id as string,
    secret: row.secret as string,
    machineName: (row.machine_name as string | null) ?? null,
    directory: (row.directory as string | null) ?? null,
    branch: (row.branch as string | null) ?? null,
    gitRepoUrl: (row.git_repo_url as string | null) ?? null,
    maxSessions: row.max_sessions as number,
    workerType: row.worker_type as string,
    bridgeId: (row.bridge_id as string | null) ?? null,
    capabilities: row.capabilities ? JSON.parse(row.capabilities as string) : null,
    status: row.status as string,
    username: (row.username as string | null) ?? null,
    lastPollAt: row.last_poll_at ? new Date(row.last_poll_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function rowToSession(row: Record<string, unknown>): SessionRecord {
  return {
    id: row.id as string,
    environmentId: (row.environment_id as string | null) ?? null,
    workspaceId: (row.workspace_id as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    status: row.status as string,
    source: row.source as string,
    permissionMode: (row.permission_mode as string | null) ?? null,
    workerEpoch: row.worker_epoch as number,
    username: (row.username as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function rowToWorkspace(row: Record<string, unknown>): WorkspaceRecord {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    environmentId: (row.environment_id as string | null) ?? null,
    sourceRoot: row.source_root as string,
    repoRoot: (row.repo_root as string | null) ?? null,
    baseRef: (row.base_ref as string | null) ?? null,
    branch: (row.branch as string | null) ?? null,
    strategy: row.strategy as WorkspaceStrategy,
    workspacePath: row.workspace_path as string,
    cleanupPolicy: row.cleanup_policy as WorkspaceCleanupPolicy,
    lifecyclePolicy: (row.lifecycle_policy as LifecyclePolicy | null) ?? null,
    materializationStrategy: (row.materialization_strategy as MaterializationStrategy | null) ?? null,
    parentWorkspaceId: (row.parent_workspace_id as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function rowToSessionState(row: Record<string, unknown>): SessionStateRecord {
  return {
    sessionId: row.session_id as string,
    model: (row.model as string | null) ?? null,
    permissionMode: (row.permission_mode as string | null) ?? null,
    thinkingEffort: (row.thinking_effort as string | null) ?? null,
    selectedRepos: rowToStringArray(row.selected_repos),
    commandProfile: (row.command_profile as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function rowToSessionWorker(row: Record<string, unknown>): SessionWorkerRecord {
  return {
    sessionId: row.session_id as string,
    workerStatus: (row.worker_status as string | null) ?? null,
    externalMetadata: row.external_metadata ? JSON.parse(row.external_metadata as string) : null,
    requiresActionDetails: row.requires_action_details ? JSON.parse(row.requires_action_details as string) : null,
    lastHeartbeatAt: row.last_heartbeat_at ? new Date(row.last_heartbeat_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function rowToWorkItem(row: Record<string, unknown>): WorkItemRecord {
  return {
    id: row.id as string,
    environmentId: row.environment_id as string,
    sessionId: row.session_id as string,
    state: row.state as string,
    secret: row.secret as string,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

// ---------- User ----------

export function storeCreateUser(username: string): UserRecord {
  db.prepare("INSERT OR IGNORE INTO users (username) VALUES (?)").run(username);
  return rowToUser(db.prepare("SELECT * FROM users WHERE username = ?").get(username) as Record<string, unknown>);
}

export function storeGetUser(username: string): UserRecord | undefined {
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as Record<string, unknown> | undefined;
  return row ? rowToUser(row) : undefined;
}

export function storeCreateToken(username: string, token: string): void {
  db.prepare("INSERT OR REPLACE INTO tokens (token, username) VALUES (?, ?)").run(token, username);
}

export function storeGetUserByToken(token: string): { username: string; createdAt: Date } | undefined {
  const row = db.prepare("SELECT * FROM tokens WHERE token = ?").get(token) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return { username: row.username as string, createdAt: new Date(row.created_at as string) };
}

export function storeDeleteToken(token: string): boolean {
  const result = db.prepare("DELETE FROM tokens WHERE token = ?").run(token);
  return result.changes > 0;
}

// ---------- Environment ----------

export function storeCreateEnvironment(req: {
  secret: string;
  machineName?: string;
  directory?: string;
  branch?: string;
  gitRepoUrl?: string;
  maxSessions?: number;
  workerType?: string;
  bridgeId?: string;
  username?: string;
  capabilities?: Record<string, unknown>;
}): EnvironmentRecord {
  const id = `env_${randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO environments (id, secret, machine_name, directory, branch, git_repo_url,
      max_sessions, worker_type, bridge_id, capabilities, status, username, last_poll_at,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `).run(
    id, req.secret,
    req.machineName ?? null, req.directory ?? null, req.branch ?? null, req.gitRepoUrl ?? null,
    req.maxSessions ?? 1, req.workerType ?? "claude_code", req.bridgeId ?? null,
    req.capabilities ? JSON.stringify(req.capabilities) : null,
    req.username ?? null, now, now, now,
  );
  return rowToEnvironment(db.prepare("SELECT * FROM environments WHERE id = ?").get(id) as Record<string, unknown>);
}

export function storeGetEnvironment(id: string): EnvironmentRecord | undefined {
  const row = db.prepare("SELECT * FROM environments WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToEnvironment(row) : undefined;
}

export function storeUpdateEnvironment(
  id: string,
  patch: Partial<Pick<EnvironmentRecord, "status" | "lastPollAt" | "updatedAt" | "capabilities" | "machineName" | "maxSessions" | "bridgeId">>,
): boolean {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
  if (patch.lastPollAt !== undefined) { sets.push("last_poll_at = ?"); values.push(patch.lastPollAt?.toISOString() ?? null); }
  if (patch.capabilities !== undefined) { sets.push("capabilities = ?"); values.push(patch.capabilities ? JSON.stringify(patch.capabilities) : null); }
  if (patch.machineName !== undefined) { sets.push("machine_name = ?"); values.push(patch.machineName); }
  if (patch.maxSessions !== undefined) { sets.push("max_sessions = ?"); values.push(patch.maxSessions); }
  if (patch.bridgeId !== undefined) { sets.push("bridge_id = ?"); values.push(patch.bridgeId); }
  if (sets.length === 0) return false;
  sets.push("updated_at = ?"); values.push(new Date().toISOString());
  values.push(id);
  const result = db.prepare(`UPDATE environments SET ${sets.join(", ")} WHERE id = ?`).run(...(values as import("bun:sqlite").SQLQueryBindings[]));
  return result.changes > 0;
}

export function storeListActiveEnvironments(): EnvironmentRecord[] {
  return (db.prepare("SELECT * FROM environments WHERE status = 'active'").all() as Record<string, unknown>[]).map(rowToEnvironment);
}

export function storeListActiveEnvironmentsByUsername(username: string): EnvironmentRecord[] {
  return (db.prepare("SELECT * FROM environments WHERE status = 'active' AND username = ?").all(username) as Record<string, unknown>[]).map(rowToEnvironment);
}

// ---------- Session ----------

export function storeCreateSession(req: {
  environmentId?: string | null;
  title?: string | null;
  source?: string;
  permissionMode?: string | null;
  idPrefix?: string;
  username?: string | null;
  cwd?: string | null;
}): SessionRecord {
  const id = `${req.idPrefix || "session_"}${randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sessions (id, environment_id, title, status, source, permission_mode, worker_epoch, username, created_at, updated_at)
    VALUES (?, ?, ?, 'idle', ?, ?, 0, ?, ?, ?)
  `).run(
    id, req.environmentId ?? null, req.title ?? null,
    req.source ?? "remote-control", req.permissionMode ?? null,
    req.username ?? null, now, now,
  );
  const session = rowToSession(db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown>);
  const workspaceId = `workspace_${randomUUID().replace(/-/g, "")}`;
  const strategy = req.cwd ? "materialized" : "same-dir";
  const workspacePath = req.cwd ?? "";
  db.prepare(`
    INSERT INTO workspaces (id, session_id, environment_id, source_root, strategy, workspace_path, cleanup_policy, created_at, updated_at)
    VALUES (?, ?, ?, '', ?, ?, 'keep', ?, ?)
  `).run(
    workspaceId, id, req.environmentId ?? null, strategy, workspacePath, now, now,
  );
  db.prepare(`UPDATE sessions SET workspace_id = ? WHERE id = ?`).run(workspaceId, id);
  return rowToSession(db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown>);
}

export function storeGetSession(id: string): SessionRecord | undefined {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : undefined;
}

export function storeUpdateSession(
  id: string,
  patch: Partial<Pick<SessionRecord, "title" | "status" | "workerEpoch" | "workspaceId" | "updatedAt">>,
): boolean {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) { sets.push("title = ?"); values.push(patch.title); }
  if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
  if (patch.workerEpoch !== undefined) { sets.push("worker_epoch = ?"); values.push(patch.workerEpoch); }
  if (patch.workspaceId !== undefined) { sets.push("workspace_id = ?"); values.push(patch.workspaceId); }
  sets.push("updated_at = ?");
  values.push((patch.updatedAt ?? new Date()).toISOString());
  values.push(id);
  const result = db.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`).run(...(values as import("bun:sqlite").SQLQueryBindings[]));
  return result.changes > 0;
}

export function storeListSessions(): SessionRecord[] {
  return (db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map(rowToSession);
}

export function storeListSessionsByUsername(username: string): SessionRecord[] {
  return (db.prepare("SELECT * FROM sessions WHERE username = ? ORDER BY updated_at DESC").all(username) as Record<string, unknown>[]).map(rowToSession);
}

export function storeListSessionsByEnvironment(envId: string): SessionRecord[] {
  return (db.prepare("SELECT * FROM sessions WHERE environment_id = ? ORDER BY updated_at DESC").all(envId) as Record<string, unknown>[]).map(rowToSession);
}

export function storeDeleteSession(id: string): boolean {
  const result = db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------- Workspace ----------

export function storeGetWorkspace(id: string): WorkspaceRecord | undefined {
  const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToWorkspace(row) : undefined;
}

export function storeGetSessionByWorkspace(workspaceId: string): SessionRecord | undefined {
  const row = db.prepare("SELECT * FROM sessions WHERE workspace_id = ?").get(workspaceId) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : undefined;
}

export function storeGetWorkspaceBySession(sessionId: string): WorkspaceRecord | undefined {
  const row = db.prepare("SELECT * FROM workspaces WHERE session_id = ?").get(sessionId) as Record<string, unknown> | undefined;
  return row ? rowToWorkspace(row) : undefined;
}

export function storeUpsertWorkspace(
  sessionId: string,
  patch: {
    environmentId?: string | null;
    sourceRoot?: string;
    repoRoot?: string | null;
    baseRef?: string | null;
    branch?: string | null;
    strategy?: WorkspaceStrategy;
    workspacePath?: string;
    cleanupPolicy?: WorkspaceCleanupPolicy;
    lifecyclePolicy?: LifecyclePolicy | null;
    materializationStrategy?: MaterializationStrategy | null;
    parentWorkspaceId?: string | null;
  },
): WorkspaceRecord {
  const now = new Date().toISOString();
  const existing = storeGetWorkspaceBySession(sessionId);

  if (!existing) {
    if (!patch.sourceRoot || !patch.strategy || !patch.workspacePath) {
      throw new Error(
        "sourceRoot, strategy, and workspacePath are required when creating a workspace",
      );
    }

    const id = `workspace_${randomUUID().replace(/-/g, "")}`;
    db.prepare(`
      INSERT INTO workspaces (
        id, session_id, environment_id, source_root, repo_root, base_ref, branch,
        strategy, workspace_path, cleanup_policy, lifecycle_policy, materialization_strategy,
        parent_workspace_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionId,
      patch.environmentId ?? null,
      patch.sourceRoot,
      patch.repoRoot ?? null,
      patch.baseRef ?? null,
      patch.branch ?? null,
      patch.strategy,
      patch.workspacePath,
      patch.cleanupPolicy ?? "keep",
      patch.lifecyclePolicy ?? null,
      patch.materializationStrategy ?? null,
      patch.parentWorkspaceId ?? null,
      now,
      now,
    );
  } else {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (patch.environmentId !== undefined) {
      sets.push("environment_id = ?");
      values.push(patch.environmentId);
    }
    if (patch.sourceRoot !== undefined) {
      sets.push("source_root = ?");
      values.push(patch.sourceRoot);
    }
    if (patch.repoRoot !== undefined) {
      sets.push("repo_root = ?");
      values.push(patch.repoRoot);
    }
    if (patch.baseRef !== undefined) {
      sets.push("base_ref = ?");
      values.push(patch.baseRef);
    }
    if (patch.branch !== undefined) {
      sets.push("branch = ?");
      values.push(patch.branch);
    }
    if (patch.strategy !== undefined) {
      sets.push("strategy = ?");
      values.push(patch.strategy);
    }
    if (patch.workspacePath !== undefined) {
      sets.push("workspace_path = ?");
      values.push(patch.workspacePath);
    }
    if (patch.cleanupPolicy !== undefined) {
      sets.push("cleanup_policy = ?");
      values.push(patch.cleanupPolicy);
    }
    if (patch.lifecyclePolicy !== undefined) {
      sets.push("lifecycle_policy = ?");
      values.push(patch.lifecyclePolicy);
    }
    if (patch.materializationStrategy !== undefined) {
      sets.push("materialization_strategy = ?");
      values.push(patch.materializationStrategy);
    }
    if (patch.parentWorkspaceId !== undefined) {
      sets.push("parent_workspace_id = ?");
      values.push(patch.parentWorkspaceId);
    }

    if (sets.length > 0) {
      sets.push("updated_at = ?");
      values.push(now);
      values.push(sessionId);
      db.prepare(`UPDATE workspaces SET ${sets.join(", ")} WHERE session_id = ?`).run(
        ...(values as import("bun:sqlite").SQLQueryBindings[]),
      );
    }
  }

  return rowToWorkspace(
    db.prepare("SELECT * FROM workspaces WHERE session_id = ?").get(sessionId) as Record<string, unknown>,
  );
}

// ---------- Session State ----------

export function storeGetSessionState(sessionId: string): SessionStateRecord | undefined {
  const row = db.prepare("SELECT * FROM session_state WHERE session_id = ?").get(sessionId) as Record<string, unknown> | undefined;
  return row ? rowToSessionState(row) : undefined;
}

export function storeUpsertSessionState(
  sessionId: string,
  patch: {
    model?: string | null;
    permissionMode?: string | null;
    thinkingEffort?: string | null;
    selectedRepos?: string[] | null;
    commandProfile?: string | null;
  },
): SessionStateRecord {
  const now = new Date().toISOString();
  const existing = storeGetSessionState(sessionId);

  if (!existing) {
    db.prepare(`
      INSERT INTO session_state (
        session_id, model, permission_mode, thinking_effort, selected_repos,
        command_profile, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      patch.model ?? null,
      patch.permissionMode ?? null,
      patch.thinkingEffort ?? null,
      JSON.stringify(patch.selectedRepos ?? []),
      patch.commandProfile ?? null,
      now,
      now,
    );
  } else {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (patch.model !== undefined) {
      sets.push("model = ?");
      values.push(patch.model);
    }
    if (patch.permissionMode !== undefined) {
      sets.push("permission_mode = ?");
      values.push(patch.permissionMode);
    }
    if (patch.thinkingEffort !== undefined) {
      sets.push("thinking_effort = ?");
      values.push(patch.thinkingEffort);
    }
    if (patch.selectedRepos !== undefined) {
      sets.push("selected_repos = ?");
      values.push(JSON.stringify(patch.selectedRepos ?? []));
    }
    if (patch.commandProfile !== undefined) {
      sets.push("command_profile = ?");
      values.push(patch.commandProfile);
    }

    if (sets.length > 0) {
      sets.push("updated_at = ?");
      values.push(now);
      values.push(sessionId);
      db.prepare(`UPDATE session_state SET ${sets.join(", ")} WHERE session_id = ?`).run(
        ...(values as import("bun:sqlite").SQLQueryBindings[]),
      );
    }
  }

  return rowToSessionState(
    db.prepare("SELECT * FROM session_state WHERE session_id = ?").get(sessionId) as Record<string, unknown>,
  );
}

// ---------- Session Worker ----------

export function storeGetSessionWorker(sessionId: string): SessionWorkerRecord | undefined {
  const row = db.prepare("SELECT * FROM session_workers WHERE session_id = ?").get(sessionId) as Record<string, unknown> | undefined;
  return row ? rowToSessionWorker(row) : undefined;
}

export function storeClearSessionRequiresAction(sessionId: string): void {
  storeUpsertSessionWorker(sessionId, { requiresActionDetails: null });
}

export function storeUpsertSessionWorker(
  sessionId: string,
  patch: {
    workerStatus?: string | null;
    externalMetadata?: Record<string, unknown> | null;
    requiresActionDetails?: Record<string, unknown> | null;
    lastHeartbeatAt?: Date | null;
  },
): SessionWorkerRecord {
  const now = new Date().toISOString();
  const existing = storeGetSessionWorker(sessionId);

  if (!existing) {
    db.prepare(`
      INSERT INTO session_workers (session_id, worker_status, external_metadata, requires_action_details, last_heartbeat_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      patch.workerStatus ?? null,
      patch.externalMetadata ? JSON.stringify(patch.externalMetadata) : null,
      patch.requiresActionDetails ? JSON.stringify(patch.requiresActionDetails) : null,
      patch.lastHeartbeatAt?.toISOString() ?? null,
      now, now,
    );
  } else {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.workerStatus !== undefined) { sets.push("worker_status = ?"); values.push(patch.workerStatus); }
    if (patch.externalMetadata !== undefined) {
      sets.push("external_metadata = ?");
      if (patch.externalMetadata === null) {
        values.push(null);
      } else {
        const merged = { ...(existing.externalMetadata ?? {}), ...patch.externalMetadata };
        values.push(JSON.stringify(merged));
      }
    }
    if (patch.requiresActionDetails !== undefined) {
      sets.push("requires_action_details = ?");
      values.push(patch.requiresActionDetails ? JSON.stringify(patch.requiresActionDetails) : null);
    }
    if (patch.lastHeartbeatAt !== undefined) {
      sets.push("last_heartbeat_at = ?");
      values.push(patch.lastHeartbeatAt?.toISOString() ?? null);
    }
    if (sets.length > 0) {
      sets.push("updated_at = ?"); values.push(now);
      values.push(sessionId);
      db.prepare(`UPDATE session_workers SET ${sets.join(", ")} WHERE session_id = ?`).run(...(values as import("bun:sqlite").SQLQueryBindings[]));
    }
  }

  return rowToSessionWorker(db.prepare("SELECT * FROM session_workers WHERE session_id = ?").get(sessionId) as Record<string, unknown>);
}

// ---------- Work Items ----------

export function storeCreateWorkItem(req: {
  environmentId: string;
  sessionId: string;
  secret: string;
}): WorkItemRecord {
  const id = `work_${randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO work_items (id, environment_id, session_id, state, secret, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?)
  `).run(id, req.environmentId, req.sessionId, req.secret, now, now);
  return rowToWorkItem(db.prepare("SELECT * FROM work_items WHERE id = ?").get(id) as Record<string, unknown>);
}

export function storeGetWorkItem(id: string): WorkItemRecord | undefined {
  const row = db.prepare("SELECT * FROM work_items WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToWorkItem(row) : undefined;
}

export function storeGetPendingWorkItem(environmentId: string): WorkItemRecord | undefined {
  const row = db.prepare(
    "SELECT * FROM work_items WHERE environment_id = ? AND state = 'pending' LIMIT 1"
  ).get(environmentId) as Record<string, unknown> | undefined;
  return row ? rowToWorkItem(row) : undefined;
}

export function storeUpdateWorkItem(
  id: string,
  patch: Partial<Pick<WorkItemRecord, "state" | "updatedAt">>,
): boolean {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.state !== undefined) { sets.push("state = ?"); values.push(patch.state); }
  if (sets.length === 0) return false;
  sets.push("updated_at = ?"); values.push(new Date().toISOString());
  values.push(id);
  const result = db.prepare(`UPDATE work_items SET ${sets.join(", ")} WHERE id = ?`).run(...(values as import("bun:sqlite").SQLQueryBindings[]));
  return result.changes > 0;
}

// ---------- Session Ownership (UUID-based) ----------

export function storeBindSession(sessionId: string, uuid: string): void {
  db.prepare("INSERT OR IGNORE INTO session_owners (session_id, owner_uuid) VALUES (?, ?)").run(sessionId, uuid);
}

export function storeIsSessionOwner(sessionId: string, uuid: string): boolean {
  const row = db.prepare("SELECT 1 FROM session_owners WHERE session_id = ? AND owner_uuid = ?").get(sessionId, uuid);
  return !!row;
}

export function storeGetSessionOwners(sessionId: string): Set<string> {
  const rows = db.prepare("SELECT owner_uuid FROM session_owners WHERE session_id = ?").all(sessionId) as Record<string, unknown>[];
  return new Set(rows.map((r) => r.owner_uuid as string));
}

export function storeListSessionsByOwnerUuid(uuid: string): SessionRecord[] {
  const owned = (db.prepare(`
    SELECT s.* FROM sessions s
    INNER JOIN session_owners so ON s.id = so.session_id
    WHERE so.owner_uuid = ?
    ORDER BY s.updated_at DESC
  `).all(uuid) as Record<string, unknown>[]).map(rowToSession);

  const ownedIds = new Set(owned.map((s) => s.id));

  // Auto-bind orphaned sessions (no owners)
  const orphans = (db.prepare(`
    SELECT s.* FROM sessions s
    LEFT JOIN session_owners so ON s.id = so.session_id
    WHERE so.session_id IS NULL
    ORDER BY s.updated_at DESC
  `).all() as Record<string, unknown>[]).map(rowToSession);

  for (const session of orphans) {
    if (!ownedIds.has(session.id)) {
      storeBindSession(session.id, uuid);
      owned.push(session);
    }
  }

  return owned;
}

// ---------- ACP Agent (reuses EnvironmentRecord with workerType="acp") ----------

export function storeListAcpAgents(): EnvironmentRecord[] {
  return (db.prepare("SELECT * FROM environments WHERE worker_type = 'acp'").all() as Record<string, unknown>[]).map(rowToEnvironment);
}

export function storeListAcpAgentsByChannelGroup(channelGroupId: string): EnvironmentRecord[] {
  return (db.prepare("SELECT * FROM environments WHERE worker_type = 'acp' AND bridge_id = ?").all(channelGroupId) as Record<string, unknown>[]).map(rowToEnvironment);
}

export function storeListOnlineAcpAgents(): EnvironmentRecord[] {
  return (db.prepare("SELECT * FROM environments WHERE worker_type = 'acp' AND status = 'active'").all() as Record<string, unknown>[]).map(rowToEnvironment);
}

export function storeMarkAcpAgentOffline(id: string): boolean {
  const result = db.prepare(
    "UPDATE environments SET status = 'offline', updated_at = ? WHERE id = ? AND worker_type = 'acp'"
  ).run(new Date().toISOString(), id);
  return result.changes > 0;
}

export function storeMarkAcpAgentOnline(id: string): boolean {
  const now = new Date().toISOString();
  const result = db.prepare(
    "UPDATE environments SET status = 'active', last_poll_at = ?, updated_at = ? WHERE id = ? AND worker_type = 'acp'"
  ).run(now, now, id);
  return result.changes > 0;
}

// ---------- Pending Permissions ----------

export interface PendingPermissionRecord {
  id: string;
  sessionId: string;
  requestId: string;
  payload: unknown;
  createdAt: Date;
}

function rowToPendingPermission(row: Record<string, unknown>): PendingPermissionRecord {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    requestId: row.request_id as string,
    payload: JSON.parse(row.payload as string),
    createdAt: new Date(row.created_at as string),
  };
}

export function storeAddPendingPermission(sessionId: string, requestId: string, payload: unknown): PendingPermissionRecord {
  const id = `perm_${randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO pending_permissions (id, session_id, request_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, sessionId, requestId, JSON.stringify(payload), now);
  return rowToPendingPermission(db.prepare("SELECT * FROM pending_permissions WHERE id = ?").get(id) as Record<string, unknown>);
}

export function storeListPendingPermissions(sessionId: string): PendingPermissionRecord[] {
  return (db
    .prepare("SELECT * FROM pending_permissions WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as Record<string, unknown>[])
    .map(rowToPendingPermission);
}

export function storeRemovePendingPermission(sessionId: string, requestId: string): boolean {
  const result = db
    .prepare("DELETE FROM pending_permissions WHERE session_id = ? AND request_id = ?")
    .run(sessionId, requestId);
  return result.changes > 0;
}

export function storeClearPendingPermissions(sessionId: string): void {
  db.prepare("DELETE FROM pending_permissions WHERE session_id = ?").run(sessionId);
}

// ---------- Reset (for tests) ----------

export function storeReset() {
  db.exec(`
    DELETE FROM events;
    DELETE FROM pending_permissions;
    DELETE FROM session_owners;
    DELETE FROM session_state;
    DELETE FROM workspaces;
    DELETE FROM session_workers;
    DELETE FROM work_items;
    DELETE FROM sessions;
    DELETE FROM environments;
    DELETE FROM tokens;
    DELETE FROM users;
  `);
}
